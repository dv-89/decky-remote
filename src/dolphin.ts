export type LaunchInfo = { ok: boolean; error?: string; executable: string; start_dir: string; launch_options: string };
type Details = { strShortcutExe?: string };
type Overview = { appid: number; display_name: string };
type Registration = { unregister(): void };
export type SteamHost = {
  SteamClient: { Apps: {
    AddShortcut(name: string, exe: string, dir: string, options: string): Promise<number>;
    SetShortcutExe(id: number, exe: string): void;
    SetShortcutName(id: number, name: string): void;
    SetShortcutStartDir(id: number, dir: string): void;
    SetShortcutLaunchOptions?(id: number, options: string): void;
    SetAppLaunchOptions(id: number, options: string): void;
    RegisterForAppDetails(id: number, callback: (details: Details) => void): Registration;
    RunGame(id: string, options: string, flag: number, source: number): void;
  } };
  appStore: { GetAppOverviewByAppID(id: number): Overview | null };
  collectionStore: { deckDesktopApps: { apps: Map<number, Overview> } };
  App?: { m_CurrentUser?: { strSteamID?: string } };
  localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
};
const NAME = "Dolphin (Decky Remote)";
const validId = (id: number) => Number.isInteger(id) && id !== 0 && id >= -2147483648 && id <= 4294967295;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function targetPath(value?: string): string {
  let path = typeof value === "string" ? value.trim() : "";
  // Older plugin versions pre-quoted paths that Steam can quote again.
  while (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1).trim();
  return path;
}

function inspectShortcut(host: SteamHost, id: number): Promise<Details | null> {
  return new Promise(resolve => {
    let done = false;
    let registration: Registration | undefined;
    const finish = (details: Details | null) => {
      if (done) return;
      done = true; clearTimeout(timer); registration?.unregister(); resolve(details);
    };
    // Metadata helps reject a foreign target, but Steam need not report an
    // executable or send live details updates for a working shortcut.
    const timer = setTimeout(() => finish(null), 400);
    try {
      registration = host.SteamClient.Apps.RegisterForAppDetails(id, details => {
        if (details && Object.keys(details).length) finish(details);
      });
      if (done) registration.unregister();
    } catch { finish(null); }
  });
}

export function createDolphinLauncher(host: SteamHost, getInfo: () => Promise<LaunchInfo>, closeMenus: () => void) {
  let pending: Promise<void> | undefined;
  const launch = async () => {
    const info = await getInfo();
    if (!info.ok) throw new Error(info.error || "Cannot find Dolphin.");
    const apps = host.SteamClient?.Apps;
    const shortcuts = host.collectionStore?.deckDesktopApps?.apps;
    if (!apps || !shortcuts || !host.appStore) throw new Error("Steam's library is not ready. Reopen Decky and try again.");
    const account = host.App?.m_CurrentUser?.strSteamID;
    const key = account && /^\d+$/.test(account) ? `decky-remote:dolphin:${account}` : undefined;
    const remember = (id: number) => {
      try { if (key) host.localStorage?.setItem(key, String(id)); } catch { /* Steam library lookup still works. */ }
    };
    let remembered = 0;
    try { if (key) remembered = Number(host.localStorage?.getItem(key)); } catch { /* Storage may be unavailable. */ }
    const candidates = new Map<number, { owned: boolean }>();
    if (validId(remembered) && host.appStore.GetAppOverviewByAppID(remembered >>> 0)) candidates.set(remembered >>> 0, { owned: true });
    // Map keys are Steam's actual IDs. A partial overview need not repeat its
    // appid field. Bindings are scoped to the signed-in Steam account.
    for (const [appId, overview] of shortcuts) {
      if (!validId(appId)) continue;
      const named = overview.display_name === NAME;
      const pathName = targetPath(overview.display_name) === info.executable;
      const possibleDolphin = /^(?:dolphin|Dolphin)$/.test(overview.display_name);
      if (named || pathName || possibleDolphin) candidates.set(appId >>> 0, { owned: named || pathName || candidates.get(appId >>> 0)?.owned === true });
    }
    let id: number | undefined;
    for (const [candidate, identity] of candidates) {
      const details = await inspectShortcut(host, candidate);
      const target = targetPath(details?.strShortcutExe);
      if (target && target !== info.executable) continue; // Leave foreign apps unchanged.
      if (target === info.executable || identity.owned) { id = candidate; break; }
    }
    if (id === undefined) {
      // Steam handles quoting; pre-quoted paths can become double-quoted.
      id = await apps.AddShortcut(NAME, info.executable, "", "");
      if (!validId(id)) throw new Error("Steam could not create the Dolphin shortcut.");
      id >>>= 0;
    }
    // Persist before waiting/configuring: a failed first attempt must not add
    // another shortcut on the next press or after a plugin reinstall.
    remember(id);
    const deadline = Date.now() + 4000;
    while (!host.appStore.GetAppOverviewByAppID(id)) {
      if (Date.now() >= deadline) throw new Error("Steam is still adding Dolphin. Try Open Dolphin again in a moment.");
      await delay(100);
    }
    // Configure the known managed shortcut directly. Steam can omit details
    // for a launchable app; read-back is not a prerequisite for RunGame.
    apps.SetShortcutExe(id, info.executable);
    apps.SetShortcutName(id, NAME);
    apps.SetShortcutStartDir(id, info.start_dir);
    if (typeof apps.SetShortcutLaunchOptions === "function") apps.SetShortcutLaunchOptions(id, info.launch_options);
    else apps.SetAppLaunchOptions(id, info.launch_options);
    closeMenus();
    const gameId = ((BigInt(id) << 32n) | 0x02000000n).toString();
    apps.RunGame(gameId, "", -1, 100);
  };
  return () => {
    if (!pending) pending = launch().finally(() => { pending = undefined; });
    return pending;
  };
}
