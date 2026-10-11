const manifest = {"name":"Legion Remote"};
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

const getStatus = callable("get_status");
const start = callable("start_remote");
const stop = callable("stop_remote");
const disconnect = callable("disconnect_client");
function RemotePanel() {
    const [status, setStatus] = SP_REACT.useState();
    const [busy, setBusy] = SP_REACT.useState(false);
    const [error, setError] = SP_REACT.useState("");
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
    return SP_JSX.jsxs(DFL.PanelSection, { title: "Laptop keyboard & mouse", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: 13, lineHeight: 1.6 }, children: [status?.enabled ? (status.paired ? `Connected: ${status.client}` : "Ready to pair") : "Remote input is off", SP_JSX.jsx("p", { children: "Keep both devices on the same trusted Wi-Fi. Look at the Legion\u2019s screen while controlling it." }), status?.enabled && SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("p", { children: "On your laptop, open:" }), status.urls.map(url => SP_JSX.jsx("div", { style: { overflowWrap: "anywhere", fontWeight: 600 }, children: url }, url)), !status.urls.length && SP_JSX.jsx("p", { children: "No LAN address found. Connect Wi-Fi, then stop and enable again." }), !status.paired && SP_JSX.jsxs("p", { children: ["Pairing code: ", SP_JSX.jsx("strong", { style: { fontSize: 24, letterSpacing: 2 }, children: status.pin })] })] }), (error || status?.error) && SP_JSX.jsx("p", { style: { color: "#ffbd89" }, children: error || status?.error })] }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy || !status, onClick: () => { void run(status?.enabled ? stop : start); }, children: busy ? "Please wait…" : status?.enabled ? "Stop remote input" : "Enable remote input" }) }), status?.enabled && status.paired && SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: () => { void run(disconnect); }, children: "Disconnect laptop" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: 12, lineHeight: 1.5, color: "#b8c2ce" }, children: "Control is off after every plugin restart. Only one laptop can pair. This local HTTP connection is unencrypted; use trusted Wi-Fi and stop it when finished." }) })] });
}
var index = definePlugin(() => ({
    name: "Legion Remote",
    titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "Legion Remote" }),
    icon: SP_JSX.jsxs("svg", { viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", strokeWidth: "2", children: [SP_JSX.jsx("rect", { x: "2", y: "5", width: "15", height: "11", rx: "2" }), SP_JSX.jsx("path", { d: "M1 19h17m3-10v10m-2-2 2 2 2-2" })] }),
    content: SP_JSX.jsx(RemotePanel, {}),
    onDismount() { },
}));

export { index as default };
//# sourceMappingURL=index.js.map
