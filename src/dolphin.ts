export type LaunchInfo = { ok: boolean; error?: string; executable: string; start_dir: string; launch_options: string };
type Details = { strShortcutExe?: string; strShortcutStartDir?: string; strLaunchOptions?: string; strShortcutLaunchOptions?: string };
type Overview = { appid: number; display_name: string };
type Registration = { unregister(): void };
export type SteamHost = {
  SteamClient: { Apps: {
    AddShortcut(name: string, exe: string, dir: string, options: string): Promise<number>;
    SetShortcutName(id: number, name: string): void;
    SetShortcutStartDir(id: number, dir: string): void;
    SetShortcutLaunchOptions?(id: number, options: string): void;
    SetAppLaunchOptions(id: number, options: string): void;
    RegisterForAppDetails(id: number, callback: (details: Details) => void): Registration;
    RunGame(id: string, options: string, flag: number, source: number): void;
  } };
  appStore: { GetAppOverviewByAppID(id: number): Overview | null };
  collectionStore: { deckDesktopApps: { apps: Map<number, Overview> } };
};
const NAME = "Dolphin (Decky Remote)";
const unquote = (value = "") => value.replace(/^"|"$/g, "");
const validId = (id: number) => Number.isInteger(id) && id !== 0 && id >= -2147483648 && id <= 4294967295;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function readDetails(host: SteamHost, id: number, accepts: (details: Details) => boolean, timeout = 4000): Promise<Details | null> {
  return new Promise((resolve, reject) => {
    let done = false;
    let registration: Registration | undefined;
    const finish = (details: Details | null) => {
      if (done) return;
      done = true; clearTimeout(timer); registration?.unregister(); resolve(details);
    };
    const timer = setTimeout(() => finish(null), timeout);
    try {
      registration = host.SteamClient.Apps.RegisterForAppDetails(id, details => {
        if (details && accepts(details)) finish(details);
      });
      if (done) registration.unregister(); // Steam can invoke the callback synchronously.
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}

async function waitForSettings(host: SteamHost, id: number, info: LaunchInfo, shortcutApi: boolean): Promise<boolean> {
  const deadline = Date.now() + 4000;
  do {
    // Some Steam builds deliver a snapshot on registration but never notify
    // that subscription when a Set* call finishes. Re-register to refresh it.
    const details = await readDetails(host, id, value => Boolean(value.strShortcutExe), Math.min(750, deadline - Date.now()));
    if (details) {
      if (unquote(details.strShortcutExe) !== info.executable) throw new Error("Dolphin's shortcut target changed. Reopen Decky and try again.");
      if (details.strShortcutLaunchOptions === info.launch_options || details.strLaunchOptions === info.launch_options) return true;
      // The shortcut setter and general app setter store different properties.
      // An absent shortcut field cannot disprove a successful native setter.
      // An explicitly reported shortcut value must still match before launch.
      if (shortcutApi && typeof details.strShortcutLaunchOptions !== "string") return true;
    }
    if (Date.now() < deadline) await delay(150);
  } while (Date.now() < deadline);
  return false;
}

export function createDolphinLauncher(host: SteamHost, getInfo: () => Promise<LaunchInfo>, closeMenus: () => void) {
  let pending: Promise<void> | undefined;
  const launch = async () => {
    const info = await getInfo();
    if (!info.ok) throw new Error(info.error || "Cannot find Dolphin.");
    const apps = host.SteamClient?.Apps;
    const shortcuts = host.collectionStore?.deckDesktopApps?.apps;
    if (!apps || !shortcuts || !host.appStore) throw new Error("Steam's library is not ready. Reopen Decky and try again.");
    let id: number | undefined;
    // Use the active account's live library instead of editing shortcuts.vdf or
    // keeping an app ID that could belong to another Steam account.
    for (const overview of shortcuts.values()) {
      if (overview.display_name !== NAME || !validId(overview.appid)) continue;
      const details = await readDetails(host, overview.appid >>> 0, details => Boolean(details.strShortcutExe));
      if (!details) throw new Error("Steam could not read the Dolphin shortcut. Reopen Decky and try again.");
      if (unquote(details.strShortcutExe) === info.executable) { id = overview.appid >>> 0; break; }
    }
    if (id === undefined) {
      id = await apps.AddShortcut(NAME, `"${info.executable}"`, "", "");
      if (!validId(id)) throw new Error("Steam could not create the Dolphin shortcut.");
      id >>>= 0;
    }
    // Steam registers newly created shortcuts asynchronously. Wait before Set*.
    const deadline = Date.now() + 4000;
    while (!host.appStore.GetAppOverviewByAppID(id)) {
      if (Date.now() >= deadline) throw new Error("Steam is still adding Dolphin. Try Open Dolphin again in a moment.");
      await delay(100);
    }
    // Load the details first: Steam can ignore settings writes while a new
    // shortcut's details are not yet initialized, even if its overview exists.
    const initial = await readDetails(host, id, details => Boolean(details.strShortcutExe));
    if (!initial || unquote(initial.strShortcutExe) !== info.executable) throw new Error("Steam could not load Dolphin's shortcut. Reopen Decky and try again.");
    // AddShortcut does not reliably apply its name argument on current Steam.
    apps.SetShortcutName(id, NAME);
    apps.SetShortcutStartDir(id, `"${info.start_dir}"`);
    const shortcutApi = typeof apps.SetShortcutLaunchOptions === "function";
    if (shortcutApi) apps.SetShortcutLaunchOptions!(id, info.launch_options);
    else apps.SetAppLaunchOptions(id, info.launch_options);
    // The working directory is advisory for this absolute executable. Steam
    // may omit it or normalize quotes/trailing slashes; do not block on it.
    if (!await waitForSettings(host, id, info, shortcutApi)) throw new Error("Steam has not applied Dolphin's launch options. Restart Steam and try again.");
    closeMenus();
    // Non-Steam shortcuts require the full 64-bit game ID, not the 32-bit app ID.
    const gameId = ((BigInt(id >>> 0) << 32n) | 0x02000000n).toString();
    apps.RunGame(gameId, "", -1, 100);
  };
  return () => {
    if (!pending) pending = launch().finally(() => { pending = undefined; });
    return pending;
  };
}
