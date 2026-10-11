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
const routerHook = api.routerHook;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

const listFiles = callable("list_files");
const copyFile = callable("copy_file");
const sizeLabel = (size) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
function FileBrowser() {
    const [folder, setFolder] = SP_REACT.useState();
    const [location, setLocation] = SP_REACT.useState("");
    const [hidden, setHidden] = SP_REACT.useState(false);
    const [selected, setSelected] = SP_REACT.useState();
    const [busy, setBusy] = SP_REACT.useState(false);
    const [message, setMessage] = SP_REACT.useState("");
    const [filter, setFilter] = SP_REACT.useState("");
    const [page, setPage] = SP_REACT.useState(0);
    const load = async (path = "", showHidden = hidden) => {
        setBusy(true);
        setMessage("");
        try {
            const result = await listFiles(path, showHidden);
            if (!result.ok || !result.folder)
                throw new Error(result.error || "Cannot open this folder");
            setFolder(result.folder);
            setLocation(result.folder.path);
            setFilter("");
            setPage(0);
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Cannot open this folder");
        }
        finally {
            setBusy(false);
        }
    };
    SP_REACT.useEffect(() => { void load(); }, []);
    const copy = async () => {
        if (!selected || !folder)
            return;
        setBusy(true);
        setMessage(`Copying ${selected.name}…`);
        try {
            const result = await copyFile(selected.path, folder.path);
            if (!result.ok)
                throw new Error(result.error || "Copy failed");
            await load(folder.path);
            setMessage(`Copied to ${result.path}`);
            setSelected(undefined);
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Copy failed");
        }
        finally {
            setBusy(false);
        }
    };
    const entries = folder?.entries.filter(entry => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) || [];
    return SP_JSX.jsxs(DFL.Focusable, { onCancel: () => DFL.Navigation.NavigateBack(), style: { height: "100%", overflowY: "auto", boxSizing: "border-box", padding: "32px 36px", color: "#e6edf7", background: "#101a28" }, children: [SP_JSX.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 20, marginBottom: 16 }, children: [SP_JSX.jsx("h1", { style: { margin: 0, fontSize: 28, flex: 1 }, children: "Files" }), SP_JSX.jsx(DFL.DialogButton, { style: { width: 150 }, disabled: busy, onClick: () => DFL.Navigation.NavigateBack(), children: "Back to Steam" })] }), SP_JSX.jsx("p", { style: { color: "#b8c2ce", margin: "0 0 16px" }, children: "Browse Home and mounted storage in Gaming Mode. Select a file, open its destination folder, then choose Copy here." }), SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }, children: [folder?.roots.map(root => SP_JSX.jsx(DFL.DialogButton, { style: { width: "auto", minWidth: 120 }, disabled: busy, onClick: () => { void load(root.path); }, children: root.name }, root.path)), SP_JSX.jsx(DFL.DialogButton, { style: { width: 100 }, disabled: busy || !folder?.parent, onClick: () => { void load(folder?.parent); }, children: "Up" }), SP_JSX.jsx(DFL.DialogButton, { style: { width: 120 }, disabled: busy, onClick: () => { void load(folder?.path); }, children: "Refresh" }), SP_JSX.jsx(DFL.DialogButton, { style: { width: 170 }, disabled: busy, onClick: () => { setHidden(!hidden); void load(folder?.path, !hidden); }, children: hidden ? "Hide hidden files" : "Show hidden files" })] }), SP_JSX.jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 100px", gap: 12, alignItems: "end", marginBottom: 12 }, children: [SP_JSX.jsx(DFL.TextField, { label: "Folder path", value: location, bShowCopyAction: true, onChange: event => setLocation(event.target.value) }), SP_JSX.jsx(DFL.DialogButton, { disabled: busy, onClick: () => { void load(location); }, children: "Go" })] }), selected && SP_JSX.jsxs("div", { style: { padding: 16, borderRadius: 10, background: "#253748", margin: "16px 0" }, children: [SP_JSX.jsx(DFL.TextField, { label: "File selected for copying \u00B7 path can be copied to clipboard", value: selected.path, bShowCopyAction: true }), SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", gap: 12, marginTop: 12 }, children: [SP_JSX.jsx(DFL.DialogButton, { disabled: busy || !folder, onClick: () => { void copy(); }, children: "Copy here" }), SP_JSX.jsx(DFL.DialogButton, { disabled: busy, onClick: () => setSelected(undefined), children: "Cancel selection" })] }), SP_JSX.jsxs("p", { style: { marginBottom: 0, fontSize: 13, color: "#b8c2ce" }, children: ["Destination: ", folder?.path, ". Existing files are never replaced."] })] }), SP_JSX.jsx(DFL.TextField, { label: "Filter this folder", value: filter, onChange: event => { setFilter(event.target.value); setPage(0); } }), SP_JSX.jsxs("p", { role: "status", style: { color: "#ffc993", overflowWrap: "anywhere" }, children: [message || (busy ? "Loading…" : `${entries.length} items`), folder?.truncated && " · First 500 entries shown. Open a more specific path to find other files."] }), SP_JSX.jsx(DFL.Focusable, { style: { display: "flex", flexDirection: "column", gap: 6 }, children: entries.slice(page * 40, (page + 1) * 40).map(entry => SP_JSX.jsx(DFL.DialogButton, { disabled: busy || entry.kind === "link" || entry.kind === "other", style: { textAlign: "left", minHeight: 44, width: "100%" }, onClick: () => {
                        if (entry.kind === "folder")
                            void load(entry.path);
                        else {
                            setSelected(entry);
                            setMessage(`Selected ${entry.name}. Open a destination folder to copy it.`);
                        }
                    }, children: SP_JSX.jsxs("span", { style: { display: "flex", gap: 12, justifyContent: "space-between" }, children: [SP_JSX.jsxs("span", { style: { overflowWrap: "anywhere", minWidth: 0 }, children: [entry.kind === "folder" ? "▸ " : "", entry.name] }), SP_JSX.jsx("span", { style: { color: "#b8c2ce", whiteSpace: "nowrap", fontSize: 13 }, children: entry.kind === "file" ? sizeLabel(entry.size) : entry.kind })] }) }, entry.path)) }), SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", gap: 12, alignItems: "center", margin: "16px 0" }, children: [SP_JSX.jsx(DFL.DialogButton, { disabled: busy || page === 0, onClick: () => setPage(page - 1), children: "Previous" }), SP_JSX.jsxs("span", { children: [page + 1, " / ", Math.max(1, Math.ceil(entries.length / 40))] }), SP_JSX.jsx(DFL.DialogButton, { disabled: busy || (page + 1) * 40 >= entries.length, onClick: () => setPage(page + 1), children: "Next" })] }), SP_JSX.jsx("p", { style: { color: "#b8c2ce", fontSize: 13 }, children: "File copies only. Links, special files, folder copies, deleting and moving are not available." })] });
}

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
    return SP_JSX.jsxs(DFL.PanelSection, { title: "Laptop keyboard & mouse", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: 13, lineHeight: 1.6 }, children: [status?.enabled ? (status.paired ? `Connected: ${status.client}` : "Ready to pair") : "Remote input is off", SP_JSX.jsx("p", { children: "Keep both devices on the same trusted Wi-Fi. Look at the handheld\u2019s screen while controlling it." }), status?.enabled && SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("p", { children: "On your laptop, open:" }), status.urls.map(url => SP_JSX.jsx("div", { style: { overflowWrap: "anywhere", fontWeight: 600 }, children: url }, url)), !status.urls.length && SP_JSX.jsx("p", { children: "No LAN address found. Connect Wi-Fi, then stop and enable again." }), !status.paired && SP_JSX.jsxs("p", { children: ["Pairing code: ", SP_JSX.jsx("strong", { style: { fontSize: 24, letterSpacing: 2 }, children: status.pin })] })] }), (error || status?.error) && SP_JSX.jsx("p", { style: { color: "#ffbd89" }, children: error || status?.error })] }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy || !status, onClick: () => { void run(status?.enabled ? stop : start); }, children: busy ? "Please wait…" : status?.enabled ? "Stop remote input" : "Enable remote input" }) }), status?.enabled && status.paired && SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: () => { void run(disconnect); }, children: "Disconnect laptop" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: 12, lineHeight: 1.5, color: "#b8c2ce" }, children: "Control is off after every plugin restart. Only one laptop can pair. This local HTTP connection is unencrypted; use trusted Wi-Fi and stop it when finished." }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => { DFL.Navigation.CloseSideMenus(); DFL.Navigation.Navigate("/decky-remote/files"); }, children: "Open file browser" }) })] });
}
var index = definePlugin(() => {
    routerHook.addRoute("/decky-remote/files", FileBrowser);
    return {
        name: "Decky Remote",
        titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "Decky Remote" }),
        icon: SP_JSX.jsxs("svg", { viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", strokeWidth: "2", children: [SP_JSX.jsx("rect", { x: "2", y: "5", width: "15", height: "11", rx: "2" }), SP_JSX.jsx("path", { d: "M1 19h17m3-10v10m-2-2 2 2 2-2" })] }),
        content: SP_JSX.jsx(RemotePanel, {}),
        onDismount() { routerHook.removeRoute("/decky-remote/files"); },
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
