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
  const shortcuts = new Map(), details = new Map(), calls = [], registrations = [], storage = new Map();
  let nextId = -123456789;
  const host = {
    App: { m_CurrentUser: { strSteamID: "76561198000000001" } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    collectionStore: { deckDesktopApps: { apps: shortcuts } },
    appStore: { GetAppOverviewByAppID: id => shortcuts.get(id) }, SteamClient: { Apps: {
      async AddShortcut(title, exe, dir, options) {
        calls.push(["add", title, exe, dir, options]);
        const id = nextId++;
        shortcuts.set(id >>> 0, { appid: id >>> 0, display_name: title });
        // Model Steam's own quoting rather than echoing the API input verbatim.
        details.set(id >>> 0, { strShortcutExe: `"${exe}"` }); return id;
      },
      SetShortcutExe(id, exe) { calls.push(["exe", id, exe]); details.get(id).strShortcutExe = `"${exe}"`; },
      SetShortcutName(id, title) { calls.push(["name", id, title]); shortcuts.get(id).display_name = title; },
      SetShortcutStartDir(id, dir) { calls.push(["dir", id, dir]); details.get(id).strShortcutStartDir = `"${dir}"`; },
      SetShortcutLaunchOptions(id, options) { calls.push(["options", id, options]); details.get(id).strShortcutLaunchOptions = options; },
      SetAppLaunchOptions(id, options) { calls.push(["general-options", id, options]); details.get(id).strLaunchOptions = options; },
      RegisterForAppDetails(id, callback) { callback({}); callback(details.get(id)); const record = { unregister() { record.closed = true; } }; registrations.push(record); return record; },
      RunGame(...args) { calls.push(["run", ...args]); },
    } },
  };
  const reload = () => createDolphinLauncher(host, async () => info, () => calls.push(["close"]));
  const seed = (id, title = name, exe = '"/usr/bin/dolphin"') => {
    shortcuts.set(id, { appid: id, display_name: title }); details.set(id, { strShortcutExe: exe });
  };
  return { host, shortcuts, details, calls, registrations, storage, seed, reload, open: reload() };
}
const count = (s, action) => s.calls.filter(call => call[0] === action).length;

test("passes raw paths to Steam and configures the assigned unsigned ID before RunGame", async () => {
  const s = setup(); await s.open();
  assert.deepEqual(s.calls.map(c => c[0]), ["add", "exe", "name", "dir", "options", "close", "run"]);
  assert.deepEqual(s.calls[0], ["add", name, "/usr/bin/dolphin", "", ""]);
  assert.deepEqual(s.calls[1], ["exe", -123456789 >>> 0, "/usr/bin/dolphin"]);
  assert.deepEqual(s.calls[3], ["dir", -123456789 >>> 0, "/home/deck"]);
  assert.deepEqual(s.calls[6].slice(1), [((BigInt(-123456789 >>> 0) << 32n) | 0x02000000n).toString(), "", -1, 100]);
});

test("repairs legacy double-quoted targets and reuses that shortcut", async () => {
  const s = setup(); s.seed(42, name, '  ""/usr/bin/dolphin""  '); await s.open();
  assert.equal(count(s, "add"), 0); assert.equal(s.details.get(42).strShortcutExe, '"/usr/bin/dolphin"');
  assert.equal(s.calls.find(c => c[0] === "run")[1], ((42n << 32n) | 0x02000000n).toString());
});

test("known working plugin shortcut launches even when Steam omits target/options metadata", async () => {
  const s = setup(); s.seed(42); s.details.set(42, { strDisplayName: name }); await s.open();
  assert.equal(count(s, "add"), 0); assert.equal(count(s, "run"), 1);
  assert.ok(s.registrations.every(r => r.closed));
});

test("known plugin shortcut launches even when the details callback never arrives", async () => {
  const s = setup(); s.seed(42);
  s.host.SteamClient.Apps.RegisterForAppDetails = () => { const record = { unregister() { record.closed = true; } }; s.registrations.push(record); return record; };
  await s.open(); assert.equal(count(s, "add"), 0); assert.equal(count(s, "run"), 1);
  assert.ok(s.registrations.every(r => r.closed));
});

test("uses collection map IDs even if Steam omits overview.appid", async () => {
  const s = setup(); s.seed(42); delete s.shortcuts.get(42).appid; await s.open();
  assert.equal(count(s, "add"), 0); assert.equal(s.calls.find(c => c[0] === "exe")[1], 42);
});

test("several old plugin entries are reused without creating another", async () => {
  const s = setup(); s.seed(42); s.seed(43); await s.open(); await s.reload()();
  assert.equal(count(s, "add"), 0); assert.equal(s.shortcuts.size, 2); assert.equal(count(s, "run"), 2);
});

test("plugin reinstall reuses its remembered ID even if Steam did not save the name", async () => {
  const s = setup(); s.host.SteamClient.Apps.SetShortcutName = () => {};
  await s.open(); const id = s.calls.find(c => c[0] === "exe")[1];
  s.shortcuts.get(id).display_name = "unsaved shortcut name"; s.details.set(id, { strDisplayName: "unsaved shortcut name" });
  await s.reload()(); assert.equal(count(s, "add"), 1); assert.equal(count(s, "run"), 2);
});

test("a failed first configuration remembers the ID so retries do not add duplicates", async () => {
  const s = setup(); const configure = s.host.SteamClient.Apps.SetShortcutExe;
  s.host.SteamClient.Apps.SetShortcutExe = () => { throw new Error("Steam is busy"); };
  await assert.rejects(s.open(), /Steam is busy/);
  const id = s.shortcuts.keys().next().value;
  s.shortcuts.get(id).display_name = "unsaved shortcut name"; s.details.set(id, { strDisplayName: "unsaved shortcut name" });
  s.host.SteamClient.Apps.SetShortcutExe = configure; await s.reload()();
  assert.equal(count(s, "add"), 1); assert.equal(count(s, "run"), 1);
});

test("bindings are per Steam account", async () => {
  const s = setup(); await s.open(); const firstId = s.shortcuts.keys().next().value;
  s.host.App.m_CurrentUser.strSteamID = "76561198000000002"; s.shortcuts.clear(); s.details.clear(); await s.open();
  assert.equal(count(s, "add"), 2); assert.equal(s.storage.size, 2);
  assert.notEqual(s.shortcuts.keys().next().value, firstId);
});

test("deleting a shortcut from Steam allows one replacement", async () => {
  const s = setup(); await s.open(); s.shortcuts.clear(); s.details.clear(); await s.open(); await s.reload()();
  assert.equal(count(s, "add"), 2); assert.equal(count(s, "run"), 3);
});

test("explicit foreign targets with the plugin's name remain untouched", async () => {
  const s = setup(); s.seed(42, name, '"/usr/bin/another-app"'); await s.open();
  assert.equal(s.details.get(42).strShortcutExe, '"/usr/bin/another-app"');
  assert.equal(count(s, "add"), 1); assert.ok(s.calls.filter(c => ["exe", "name", "dir", "options"].includes(c[0])).every(c => c[1] !== 42));
});

test("a same-name Dolphin emulator is not changed or launched", async () => {
  const s = setup(); s.seed(42, "Dolphin", "/usr/bin/dolphin-emu"); await s.open();
  assert.equal(count(s, "add"), 1); assert.equal(s.shortcuts.get(42).display_name, "Dolphin");
});

test("unnamed legacy file-manager entries can be adopted by their actual executable", async () => {
  const s = setup(); s.seed(42, "dolphin", '""/usr/bin/dolphin""'); await s.open();
  assert.equal(count(s, "add"), 0); assert.equal(s.shortcuts.get(42).display_name, name);
});

test("generic Dolphin name without executable evidence is not adopted", async () => {
  const s = setup(); s.seed(42, "Dolphin"); s.details.set(42, { strDisplayName: "Dolphin" }); await s.open();
  assert.equal(count(s, "add"), 1); assert.equal(s.shortcuts.get(42).display_name, "Dolphin");
});

test("overlapping button presses create and launch once", async () => {
  const s = setup(); await Promise.all([s.open(), s.open(), s.open()]); assert.equal(count(s, "add"), 1); assert.equal(count(s, "run"), 1);
});

test("storage errors do not prevent reuse through the live library", async () => {
  const s = setup(); s.host.localStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  await s.open(); await s.reload()(); assert.equal(count(s, "add"), 1); assert.equal(count(s, "run"), 2);
});

test("missing Dolphin and unavailable library fail without changing shortcuts", async () => {
  const s = setup(); const missing = createDolphinLauncher(s.host, async () => ({ ok: false, error: "Dolphin not installed" }), () => {});
  await assert.rejects(missing(), /not installed/); s.host.collectionStore = undefined;
  await assert.rejects(s.open(), /library is not ready/); assert.deepEqual(s.calls, []);
});

test("failed creation cannot launch and can be retried", async () => {
  const s = setup(); const create = s.host.SteamClient.Apps.AddShortcut;
  s.host.SteamClient.Apps.AddShortcut = async () => 0; await assert.rejects(s.open(), /could not create/);
  assert.equal(count(s, "run"), 0); s.host.SteamClient.Apps.AddShortcut = create; await s.open(); assert.equal(count(s, "run"), 1);
});

test("waits for Steam to register the created app before configuring it", async () => {
  const s = setup(); const create = s.host.SteamClient.Apps.AddShortcut;
  s.host.SteamClient.Apps.AddShortcut = async (...args) => {
    const id = await create(...args); const overview = s.shortcuts.get(id >>> 0);
    s.shortcuts.delete(id >>> 0); setTimeout(() => s.shortcuts.set(id >>> 0, overview), 50); return id;
  };
  await s.open(); assert.equal(count(s, "run"), 1);
});

test("older Steam API can use the general launch-options setter", async () => {
  const s = setup(); delete s.host.SteamClient.Apps.SetShortcutLaunchOptions; await s.open();
  assert.equal(count(s, "general-options"), 1); assert.equal(count(s, "run"), 1);
});
