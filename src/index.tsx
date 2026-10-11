import { useEffect, useState } from "react";
import { ButtonItem, PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
import { callable, definePlugin } from "@decky/api";

type Status = { enabled: boolean; paired: boolean; pin: string; client: string; urls: string[]; error: string };
const getStatus = callable<[], Status>("get_status");
const start = callable<[], Status>("start_remote");
const stop = callable<[], Status>("stop_remote");
const disconnect = callable<[], Status>("disconnect_client");

function RemotePanel() {
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try { const value = await getStatus(); if (mounted) setStatus(value); }
      catch { if (mounted) setError("Cannot reach the plugin. Reopen Decky or restart the plugin."); }
      finally { polling = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 1500);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  const run = async (action: () => Promise<Status>) => {
    setBusy(true); setError("");
    try { setStatus(await action()); }
    catch { setError("The action failed. Reopen Decky and try again."); }
    finally { setBusy(false); }
  };
  return <PanelSection title="Laptop keyboard & mouse">
    <PanelSectionRow><div style={{ fontSize: 13, lineHeight: 1.6 }}>
      {status?.enabled ? (status.paired ? `Connected: ${status.client}` : "Ready to pair") : "Remote input is off"}
      <p>Keep both devices on the same trusted Wi-Fi. Look at the Legion’s screen while controlling it.</p>
      {status?.enabled && <>
        <p>On your laptop, open:</p>
        {status.urls.map(url => <div key={url} style={{ overflowWrap: "anywhere", fontWeight: 600 }}>{url}</div>)}
        {!status.urls.length && <p>No LAN address found. Connect Wi-Fi, then stop and enable again.</p>}
        {!status.paired && <p>Pairing code: <strong style={{ fontSize: 24, letterSpacing: 2 }}>{status.pin}</strong></p>}
      </>}
      {(error || status?.error) && <p style={{ color: "#ffbd89" }}>{error || status?.error}</p>}
    </div></PanelSectionRow>
    <PanelSectionRow><ButtonItem layout="below" disabled={busy || !status} onClick={() => { void run(status?.enabled ? stop : start); }}>
      {busy ? "Please wait…" : status?.enabled ? "Stop remote input" : "Enable remote input"}
    </ButtonItem></PanelSectionRow>
    {status?.enabled && status.paired && <PanelSectionRow><ButtonItem layout="below" disabled={busy} onClick={() => { void run(disconnect); }}>Disconnect laptop</ButtonItem></PanelSectionRow>}
    <PanelSectionRow><div style={{ fontSize: 12, lineHeight: 1.5, color: "#b8c2ce" }}>Control is off after every plugin restart. Only one laptop can pair. This local HTTP connection is unencrypted; use trusted Wi-Fi and stop it when finished.</div></PanelSectionRow>
  </PanelSection>;
}

export default definePlugin(() => ({
  name: "Legion Remote",
  titleView: <div className={staticClasses.Title}>Legion Remote</div>,
  icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="15" height="11" rx="2"/><path d="M1 19h17m3-10v10m-2-2 2 2 2-2"/></svg>,
  content: <RemotePanel />,
  onDismount() {},
}));
