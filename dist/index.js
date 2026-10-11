const manifest = {"name":"Decky Remote"};
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const callable = api.callable;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

const NAME = "Dolphin (Decky Remote)";
const unquote = (value = "") => value.replace(/^"|"$/g, "");
const validId = (id) => Number.isInteger(id) && id !== 0 && id >= -2147483648 && id <= 4294967295;
function readDetails(host, id, accepts, timeout = 4000) {
    return new Promise((resolve, reject) => {
        let done = false;
        let registration;
        const finish = (details) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            registration?.unregister();
            resolve(details);
        };
        const timer = setTimeout(() => finish(null), timeout);
        try {
            registration = host.SteamClient.Apps.RegisterForAppDetails(id, details => {
                if (details && accepts(details))
                    finish(details);
            });
            if (done)
                registration.unregister(); // Steam can invoke the callback synchronously.
        }
        catch (error) {
            clearTimeout(timer);
            reject(error);
        }
    });
}
function createDolphinLauncher(host, getInfo, closeMenus) {
    let pending;
    const launch = async () => {
        const info = await getInfo();
        if (!info.ok)
            throw new Error(info.error || "Cannot find Dolphin.");
        const apps = host.SteamClient?.Apps;
        const shortcuts = host.collectionStore?.deckDesktopApps?.apps;
        if (!apps || !shortcuts || !host.appStore)
            throw new Error("Steam's library is not ready. Reopen Decky and try again.");
        let id;
        // Use the active account's live library instead of editing shortcuts.vdf or
        // keeping an app ID that could belong to another Steam account.
        for (const overview of shortcuts.values()) {
            if (overview.display_name !== NAME || !validId(overview.appid))
                continue;
            const details = await readDetails(host, overview.appid, details => Boolean(details.strShortcutExe));
            if (!details)
                throw new Error("Steam could not read the Dolphin shortcut. Reopen Decky and try again.");
            if (unquote(details.strShortcutExe) === info.executable) {
                id = overview.appid;
                break;
            }
        }
        if (id === undefined) {
            id = await apps.AddShortcut(NAME, `"${info.executable}"`, "", "");
            if (!validId(id))
                throw new Error("Steam could not create the Dolphin shortcut.");
        }
        // Steam registers newly created shortcuts asynchronously. Wait before Set*.
        const deadline = Date.now() + 4000;
        while (!host.appStore.GetAppOverviewByAppID(id)) {
            if (Date.now() >= deadline)
                throw new Error("Steam is still adding Dolphin. Try Open Dolphin again in a moment.");
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        apps.SetShortcutStartDir(id, `"${info.start_dir}"`);
        apps.SetAppLaunchOptions(id, info.launch_options);
        const ready = await readDetails(host, id, details => unquote(details.strShortcutExe) === info.executable &&
            unquote(details.strShortcutStartDir) === info.start_dir &&
            (details.strLaunchOptions === info.launch_options || details.strShortcutLaunchOptions === info.launch_options));
        if (!ready)
            throw new Error("Steam has not saved Dolphin's launch settings. Try Open Dolphin again.");
        closeMenus();
        // Non-Steam shortcuts require the full 64-bit game ID, not the 32-bit app ID.
        const gameId = ((BigInt(id >>> 0) << 32n) | 0x02000000n).toString();
        apps.RunGame(gameId, "", -1, 100);
    };
    return () => {
        if (!pending)
            pending = launch().finally(() => { pending = undefined; });
        return pending;
    };
}

const getStatus = callable("get_status");
const start = callable("start_remote");
const stop = callable("stop_remote");
const disconnect = callable("disconnect_client");
const getDolphinInfo = callable("get_dolphin_launch_info");
const openDolphin = createDolphinLauncher(window, getDolphinInfo, () => DFL.Navigation.CloseSideMenus());
function RemotePanel() {
    const [status, setStatus] = SP_REACT.useState();
    const [busy, setBusy] = SP_REACT.useState(false);
    const [error, setError] = SP_REACT.useState("");
    const [openingDolphin, setOpeningDolphin] = SP_REACT.useState(false);
    const [dolphinError, setDolphinError] = SP_REACT.useState("");
    const launchDolphin = async () => {
        setOpeningDolphin(true);
        setDolphinError("");
        try {
            await openDolphin();
        }
        catch (error) {
            setDolphinError(error instanceof Error ? error.message : "Cannot open Dolphin. Reopen Decky and try again.");
        }
        finally {
            setOpeningDolphin(false);
        }
    };
    SP_REACT.useEffect(() => {
        let mounted = true;
        let polling = false;
        const refresh = async () => {
            if (polling)
                return;
            polling = true;
            try {
                const value = await getStatus();
                if (mounted)
                    setStatus(value);
            }
            catch {
                if (mounted)
                    setError("Cannot reach the plugin. Reopen Decky or restart the plugin.");
            }
            finally {
                polling = false;
            }
        };
        void refresh();
        const timer = setInterval(() => { void refresh(); }, 1500);
        return () => { mounted = false; clearInterval(timer); };
    }, []);
    const run = async (action) => {
        setBusy(true);
        setError("");
        try {
            setStatus(await action());
        }
        catch {
            setError("The action failed. Reopen Decky and try again.");
        }
        finally {
            setBusy(false);
        }
    };
    return SP_JSX.jsxs(DFL.PanelSection, { title: "Laptop keyboard & mouse", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: 13, lineHeight: 1.6 }, children: [status?.enabled ? (status.paired ? `Connected: ${status.client}` : "Ready to pair") : "Remote input is off", SP_JSX.jsx("p", { children: "Keep both devices on the same trusted Wi-Fi. Look at the handheld\u2019s screen while controlling it." }), status?.enabled && SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("p", { children: "On your laptop, open:" }), status.urls.map(url => SP_JSX.jsx("div", { style: { overflowWrap: "anywhere", fontWeight: 600 }, children: url }, url)), !status.urls.length && SP_JSX.jsx("p", { children: "No LAN address found. Connect Wi-Fi, then stop and enable again." }), !status.paired && SP_JSX.jsxs("p", { children: ["Pairing code: ", SP_JSX.jsx("strong", { style: { fontSize: 24, letterSpacing: 2 }, children: status.pin })] })] }), (error || status?.error) && SP_JSX.jsx("p", { style: { color: "#ffbd89" }, children: error || status?.error })] }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy || !status, onClick: () => { void run(status?.enabled ? stop : start); }, children: busy ? "Please wait…" : status?.enabled ? "Stop remote input" : "Enable remote input" }) }), status?.enabled && status.paired && SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: () => { void run(disconnect); }, children: "Disconnect laptop" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: 12, lineHeight: 1.5, color: "#b8c2ce" }, children: "Control is off after every plugin restart. Only one laptop can pair. This local HTTP connection is unencrypted; use trusted Wi-Fi and stop it when finished." }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: openingDolphin, onClick: () => { void launchDolphin(); }, children: openingDolphin ? "Opening Dolphin…" : "Open Dolphin" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: 12, lineHeight: 1.5, color: "#b8c2ce" }, children: "Use the system file manager in Gaming Mode. Control it with your touchscreen or paired laptop. Steam adds a reusable Dolphin shortcut on first use." }) }), dolphinError && SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { role: "alert", style: { color: "#ffbd89" }, children: dolphinError }) })] });
}
var index = definePlugin(() => {
    return {
        name: "Decky Remote",
        titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "Decky Remote" }),
        icon: SP_JSX.jsxs("svg", { viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", strokeWidth: "2", children: [SP_JSX.jsx("rect", { x: "2", y: "5", width: "15", height: "11", rx: "2" }), SP_JSX.jsx("path", { d: "M1 19h17m3-10v10m-2-2 2 2 2-2" })] }),
        content: SP_JSX.jsx(RemotePanel, {}),
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
