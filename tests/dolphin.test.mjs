import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/dolphin.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { createDolphinLauncher } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const info = { ok: true, executable: "/usr/bin/dolphin", start_dir: "/home/deck", launch_options: "QT_QPA_PLATFORM=xcb %command% --new-window" };
const name = "Dolphin (Decky Remote)";

function setup() {
  const shortcuts = new Map(), details = new Map(), calls = [], registrations = [];
  const host = { collectionStore: { deckDesktopApps: { apps: shortcuts } }, appStore: { GetAppOverviewByAppID: id => shortcuts.get(id) }, SteamClient: { Apps: {
    async AddShortcut(title, exe, dir, options) {
      calls.push(["add", title, exe, dir, options]);
      const id = -123456789; // Steam can deliver signed app IDs.
      shortcuts.set(id >>> 0, { appid: id >>> 0, display_name: title });
      details.set(id >>> 0, { strShortcutExe: exe, strShortcutLaunchOptions: "" }); return id;
    },
    SetShortcutName(id, title) { calls.push(["name", id, title]); shortcuts.get(id).display_name = title; },
    SetShortcutStartDir(id, dir) { calls.push(["dir", id, dir]); details.get(id).strShortcutStartDir = dir; },
    SetShortcutLaunchOptions(id, options) { calls.push(["options", id, options]); details.get(id).strShortcutLaunchOptions = options; },
    SetAppLaunchOptions(id, options) { calls.push(["general-options", id, options]); details.get(id).strLaunchOptions = options; },
    RegisterForAppDetails(id, callback) { callback({}); callback(details.get(id)); const record = { unregister() { record.closed = true; } }; registrations.push(record); return record; },
    RunGame(...args) { calls.push(["run", ...args]); },
  } } };
  const open = createDolphinLauncher(host, async () => info, () => calls.push(["close"]));
  return { host, shortcuts, details, calls, open, registrations };
}

test("creates a native shortcut, saves settings before launch and uses a full unsigned game ID", async () => {
  const s = setup(); await s.open();
  assert.deepEqual(s.calls.map(c => c[0]), ["add", "name", "dir", "options", "close", "run"]);
  assert.deepEqual(s.calls[0], ["add", name, '"/usr/bin/dolphin"', "", ""]);
  assert.deepEqual(s.calls[2].slice(2), ['"/home/deck"']);
  assert.equal(s.calls[2][1], -123456789 >>> 0, "Steam setters require an unsigned app ID");
  assert.equal(s.calls[3][2], info.launch_options);
  assert.deepEqual(s.calls[5].slice(1), [((BigInt(-123456789 >>> 0) << 32n) | 0x02000000n).toString(), "", -1, 100]);
  assert.ok(s.registrations.every(r => r.closed), "synchronous callbacks must unregister");
});

test("repeat presses and plugin reload reuse the active account's existing Dolphin", async () => {
  const s = setup(); await s.open(); await s.open();
  const reloaded = createDolphinLauncher(s.host, async () => info, () => {}); await reloaded();
  assert.equal(s.calls.filter(c => c[0] === "add").length, 1);
  assert.equal(s.calls.filter(c => c[0] === "run").length, 3);
});

test("overlapping clicks create and launch once", async () => {
  const s = setup(); await Promise.all([s.open(), s.open(), s.open()]);
  assert.equal(s.calls.filter(c => c[0] === "add").length, 1);
  assert.equal(s.calls.filter(c => c[0] === "run").length, 1);
});

test("does not modify or run a same-name shortcut for a different executable", async () => {
  const s = setup(); s.shortcuts.set(42, { appid: 42, display_name: name });
  s.details.set(42, { strShortcutExe: '"/usr/bin/another-app"' });
  await s.open();
  assert.equal(s.details.get(42).strShortcutStartDir, undefined);
  assert.equal(s.calls.filter(c => c[0] === "add").length, 1);
  assert.equal(s.calls.find(c => c[0] === "run")[1], ((BigInt(-123456789 >>> 0) << 32n) | 0x02000000n).toString());
});

test("does not carry another Steam account's shortcut across an account switch", async () => {
  const s = setup(); await s.open(); s.shortcuts.clear(); s.details.clear(); await s.open();
  assert.equal(s.calls.filter(c => c[0] === "add").length, 2);
});

test("missing Dolphin or unavailable Steam library makes no changes", async () => {
  const s = setup();
  const missing = createDolphinLauncher(s.host, async () => ({ ok: false, error: "Dolphin not installed" }), () => {});
  await assert.rejects(missing(), /not installed/);
  s.host.collectionStore = undefined;
  await assert.rejects(s.open(), /library is not ready/); assert.deepEqual(s.calls, []);
});

test("failed shortcut creation never launches and can be retried", async () => {
  const s = setup(); const create = s.host.SteamClient.Apps.AddShortcut;
  s.host.SteamClient.Apps.AddShortcut = async () => 0;
  await assert.rejects(s.open(), /could not create/); assert.deepEqual(s.calls, []);
  s.host.SteamClient.Apps.AddShortcut = create; await s.open();
  assert.equal(s.calls.filter(c => c[0] === "run").length, 1);
});

test("unconfirmed launch settings never launch a potentially wrong app", async () => {
  const s = setup(); s.host.SteamClient.Apps.SetShortcutLaunchOptions = () => {};
  await assert.rejects(s.open(), /has not applied/);
  assert.equal(s.calls.filter(c => c[0] === "run").length, 0);
  assert.ok(s.registrations.every(r => r.closed), "timeout must unregister");
});

test("waits for asynchronously registered shortcuts before configuring or running", async () => {
  const s = setup(); const create = s.host.SteamClient.Apps.AddShortcut;
  s.host.SteamClient.Apps.AddShortcut = async (...args) => {
    const id = await create(...args); const overview = s.shortcuts.get(id >>> 0);
    s.shortcuts.delete(id >>> 0); setTimeout(() => s.shortcuts.set(id >>> 0, overview), 50); return id;
  };
  await s.open(); assert.equal(s.calls.filter(c => c[0] === "run").length, 1);
});

test("supports asynchronous details and shortcut-specific launch-option fields", async () => {
  const s = setup();
  s.host.SteamClient.Apps.SetShortcutLaunchOptions = (id, options) => {
    const details = s.details.get(id); details.strLaunchOptions = ""; details.strShortcutLaunchOptions = options;
  };
  s.host.SteamClient.Apps.RegisterForAppDetails = (id, callback) => {
    callback(undefined); callback({}); const timer = setTimeout(() => callback(s.details.get(id)), 10);
    const record = { unregister() { clearTimeout(timer); record.closed = true; } }; s.registrations.push(record); return record;
  };
  await s.open(); await s.open();
  assert.equal(s.calls.filter(c => c[0] === "add").length, 1);
  assert.equal(s.calls.filter(c => c[0] === "run").length, 2);
  assert.ok(s.registrations.every(r => r.closed));
});

test("uses the native shortcut setter when the general app setter is a no-op", async () => {
  const s = setup(); s.host.SteamClient.Apps.SetAppLaunchOptions = () => { throw new Error("wrong API"); };
  await s.open(); assert.equal(s.calls.filter(c => c[0] === "run").length, 1);
});

test("loads details before writing and refreshes stale one-shot snapshots until native options arrive", async () => {
  const s = setup(); let loaded = false, reads = 0, nativeOptions = "";
  s.host.SteamClient.Apps.SetShortcutLaunchOptions = (id, options) => {
    assert.ok(loaded, "Steam details must be loaded before writes"); nativeOptions = options;
    // The registration that loaded the details receives no update event.
  };
  s.host.SteamClient.Apps.RegisterForAppDetails = (id, callback) => {
    loaded = true; reads++;
    callback({ strShortcutExe: s.details.get(id).strShortcutExe, strShortcutLaunchOptions: reads >= 4 ? nativeOptions : "" });
    const record = { unregister() { record.closed = true; } }; s.registrations.push(record); return record;
  };
  await s.open(); assert.ok(reads >= 4); assert.equal(s.calls.filter(c => c[0] === "run").length, 1);
  assert.ok(s.registrations.every(r => r.closed));
});

test("does not require an exact or present working-directory read-back", async () => {
  for (const dir of [undefined, "", "/home/deck/"]) {
    const s = setup(); s.host.SteamClient.Apps.SetShortcutStartDir = id => { s.details.get(id).strShortcutStartDir = dir; };
    await s.open(); assert.equal(s.calls.filter(c => c[0] === "run").length, 1);
  }
});

test("native setter remains usable when Steam omits the shortcut-options field", async () => {
  const s = setup(); s.host.SteamClient.Apps.SetShortcutLaunchOptions = id => {
    delete s.details.get(id).strShortcutLaunchOptions;
    s.details.get(id).strLaunchOptions = ""; // The separate general property is not the shortcut's value.
  };
  await s.open(); assert.equal(s.calls.filter(c => c[0] === "run").length, 1);
});

test("older Steam API falls back to general options and confirms its reported value", async () => {
  const s = setup(); delete s.host.SteamClient.Apps.SetShortcutLaunchOptions;
  await s.open(); assert.equal(s.calls.filter(c => c[0] === "general-options").length, 1);
  assert.equal(s.calls.filter(c => c[0] === "run").length, 1);
});

test("a changed shortcut executable is never launched", async () => {
  const s = setup(); s.host.SteamClient.Apps.SetShortcutLaunchOptions = id => { s.details.get(id).strShortcutExe = '"/usr/bin/foreign-app"'; };
  await assert.rejects(s.open(), /target changed/);
  assert.equal(s.calls.filter(c => c[0] === "run").length, 0);
});

test("sets the shortcut name explicitly when Steam ignores AddShortcut's name", async () => {
  const s = setup(); const create = s.host.SteamClient.Apps.AddShortcut;
  s.host.SteamClient.Apps.AddShortcut = async (...args) => {
    const id = await create(...args); s.shortcuts.get(id >>> 0).display_name = "/usr/bin/dolphin"; return id;
  };
  await s.open(); await s.open();
  assert.equal(s.calls.filter(c => c[0] === "add").length, 1);
  assert.equal(s.shortcuts.values().next().value.display_name, name);
});
