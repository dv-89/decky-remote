import { useEffect, useState } from "react";
import { callable } from "@decky/api";
import { DialogButton, Focusable, Navigation, TextField } from "@decky/ui";

type Entry = { name: string; path: string; kind: "folder" | "file" | "link" | "other"; size: number };
type Folder = { path: string; parent: string; roots: { name: string; path: string }[]; entries: Entry[]; truncated: boolean };
type Listing = { ok: boolean; folder?: Folder; error?: string };
const listFiles = callable<[string, boolean], Listing>("list_files");
const copyFile = callable<[string, string], { ok: boolean; path?: string; error?: string }>("copy_file");
const sizeLabel = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

export default function FileBrowser() {
  const [folder, setFolder] = useState<Folder>();
  const [location, setLocation] = useState("");
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<Entry>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const load = async (path = "", showHidden = hidden) => {
    setBusy(true); setMessage("");
    try {
      const result = await listFiles(path, showHidden);
      if (!result.ok || !result.folder) throw new Error(result.error || "Cannot open this folder");
      setFolder(result.folder); setLocation(result.folder.path); setFilter(""); setPage(0);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cannot open this folder"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const copy = async () => {
    if (!selected || !folder) return;
    setBusy(true); setMessage(`Copying ${selected.name}…`);
    try {
      const result = await copyFile(selected.path, folder.path);
      if (!result.ok) throw new Error(result.error || "Copy failed");
      await load(folder.path);
      setMessage(`Copied to ${result.path}`); setSelected(undefined);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Copy failed"); }
    finally { setBusy(false); }
  };
  const entries = folder?.entries.filter(entry => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) || [];
  return <Focusable onCancel={() => Navigation.NavigateBack()} style={{ height: "100%", overflowY: "auto", boxSizing: "border-box", padding: "32px 36px", color: "#e6edf7", background: "#101a28" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 16 }}>
      <h1 style={{ margin: 0, fontSize: 28, flex: 1 }}>Files</h1>
      <DialogButton style={{ width: 150 }} disabled={busy} onClick={() => Navigation.NavigateBack()}>Back to Steam</DialogButton>
    </div>
    <p style={{ color: "#b8c2ce", margin: "0 0 16px" }}>Browse Home and mounted storage in Gaming Mode. Select a file, open its destination folder, then choose Copy here.</p>
    <Focusable style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      {folder?.roots.map(root => <DialogButton key={root.path} style={{ width: "auto", minWidth: 120 }} disabled={busy} onClick={() => { void load(root.path); }}>{root.name}</DialogButton>)}
      <DialogButton style={{ width: 100 }} disabled={busy || !folder?.parent} onClick={() => { void load(folder?.parent); }}>Up</DialogButton>
      <DialogButton style={{ width: 120 }} disabled={busy} onClick={() => { void load(folder?.path); }}>Refresh</DialogButton>
      <DialogButton style={{ width: 170 }} disabled={busy} onClick={() => { setHidden(!hidden); void load(folder?.path, !hidden); }}>{hidden ? "Hide hidden files" : "Show hidden files"}</DialogButton>
    </Focusable>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 12, alignItems: "end", marginBottom: 12 }}>
      <TextField label="Folder path" value={location} bShowCopyAction onChange={event => setLocation(event.target.value)} />
      <DialogButton disabled={busy} onClick={() => { void load(location); }}>Go</DialogButton>
    </div>
    {selected && <div style={{ padding: 16, borderRadius: 10, background: "#253748", margin: "16px 0" }}>
      <TextField label="File selected for copying · path can be copied to clipboard" value={selected.path} bShowCopyAction />
      <Focusable style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <DialogButton disabled={busy || !folder} onClick={() => { void copy(); }}>Copy here</DialogButton>
        <DialogButton disabled={busy} onClick={() => setSelected(undefined)}>Cancel selection</DialogButton>
      </Focusable>
      <p style={{ marginBottom: 0, fontSize: 13, color: "#b8c2ce" }}>Destination: {folder?.path}. Existing files are never replaced.</p>
    </div>}
    <TextField label="Filter this folder" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }} />
    <p role="status" style={{ color: "#ffc993", overflowWrap: "anywhere" }}>{message || (busy ? "Loading…" : `${entries.length} items`)}{folder?.truncated && " · First 500 entries shown. Open a more specific path to find other files."}</p>
    <Focusable style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.slice(page * 40, (page + 1) * 40).map(entry => <DialogButton key={entry.path} disabled={busy || entry.kind === "link" || entry.kind === "other"} style={{ textAlign: "left", minHeight: 44, width: "100%" }} onClick={() => {
        if (entry.kind === "folder") void load(entry.path);
        else { setSelected(entry); setMessage(`Selected ${entry.name}. Open a destination folder to copy it.`); }
      }}><span style={{ display: "flex", gap: 12, justifyContent: "space-between" }}><span style={{ overflowWrap: "anywhere", minWidth: 0 }}>{entry.kind === "folder" ? "▸ " : ""}{entry.name}</span><span style={{ color: "#b8c2ce", whiteSpace: "nowrap", fontSize: 13 }}>{entry.kind === "file" ? sizeLabel(entry.size) : entry.kind}</span></span></DialogButton>)}
    </Focusable>
    <Focusable style={{ display: "flex", gap: 12, alignItems: "center", margin: "16px 0" }}>
      <DialogButton disabled={busy || page === 0} onClick={() => setPage(page - 1)}>Previous</DialogButton>
      <span>{page + 1} / {Math.max(1, Math.ceil(entries.length / 40))}</span>
      <DialogButton disabled={busy || (page + 1) * 40 >= entries.length} onClick={() => setPage(page + 1)}>Next</DialogButton>
    </Focusable>
    <p style={{ color: "#b8c2ce", fontSize: 13 }}>File copies only. Links, special files, folder copies, deleting and moving are not available.</p>
  </Focusable>;
}
