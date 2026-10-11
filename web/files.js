"use strict";
window.createFileSharing = ({request, paired}) => {
  const el = id => document.getElementById(id);
  let busy = false, controller = null, generation = 0;
  let chunkSize = 256 * 1024;
  function message(value, error = false) {
    el("fileStatus").textContent = value;
    el("fileStatus").classList.toggle("error", error);
  }
  function size(value) {
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
  }
  function showSpace(value) {
    el("fileSpace").textContent = `${size(value.usableBytes)} available for uploads · ${size(value.reserveBytes)} kept free`;
  }
  function setBusy(value) {
    busy = value;
    el("fileInput").disabled = value;
    el("refreshFiles").disabled = value;
    el("cancelUpload").hidden = !value;
    for (const button of el("fileList").querySelectorAll("button")) button.disabled = value;
  }
  function render(files, truncated) {
    el("fileList").replaceChildren();
    if (!files.length) {
      const empty = document.createElement("p");
      empty.textContent = "No shared files yet. Upload here, or move a file into this folder with Dolphin.";
      el("fileList").append(empty);
    }
    for (const file of files) {
      const row = document.createElement("div"); row.className = "file-row";
      const details = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = file.name;
      const metadata = document.createElement("small"); metadata.textContent = size(file.size);
      const download = document.createElement("button"); download.textContent = "Download"; download.disabled = busy;
      download.setAttribute("aria-label", "Download " + file.name);
      download.addEventListener("click", async () => {
        const current = generation;
        download.disabled = true;
        try {
          const result = await request("/api/files/download", {name: file.name});
          if (current !== generation || !paired()) return;
          if (!/^\/download\/[0-9a-f]{48}$/.test(result.url)) throw new Error("Invalid download link");
          const link = document.createElement("a");
          link.href = result.url; link.download = file.name;
          document.body.append(link); link.click(); link.remove();
          message("Download started: " + file.name + ". Check your browser’s downloads for progress.");
        } catch (error) { if (current === generation) message(error.message, true); }
        finally { if (current === generation) download.disabled = busy; }
      });
      details.append(name, metadata); row.append(details, download); el("fileList").append(row);
    }
    el("fileCount").textContent = truncated ? "Showing the first 500 files. Move files out with Dolphin to see more." : `${files.length} shared ${files.length === 1 ? "file" : "files"}`;
  }
  async function refresh({announce = true} = {}) {
    if (!paired() || busy) return;
    const current = generation;
    el("refreshFiles").disabled = true;
    if (announce) message("Loading shared files…");
    try {
      const result = await request("/api/files/list", {});
      if (current !== generation || !paired()) return;
      chunkSize = result.chunkSize;
      showSpace(result);
      el("sharedFolder").value = result.folder;
      render(result.files, result.truncated);
      if (announce) message("Ready to share files. Available space is checked before uploading.");
    } catch (error) { if (current === generation) message(error.message, true); }
    finally { if (current === generation) el("refreshFiles").disabled = busy; }
  }
  async function upload(selection) {
    const files = Array.from(selection);
    if (!paired() || !files.length) return;
    if (busy) { message("Finish or cancel the current upload first.", true); return; }
    const totalSize = files.reduce((total, file) => total + file.size, 0);
    if (files.some(file => !Number.isSafeInteger(file.size) || file.size < 0) || !Number.isSafeInteger(totalSize)) {
      message("This selection exceeds the browser’s exact byte-size range.", true); return;
    }
    const current = generation;
    const abort = new AbortController(); controller = abort;
    const check = () => { if (abort.signal.aborted || current !== generation || !paired()) throw new DOMException("Cancelled", "AbortError"); };
    setBusy(true); el("fileProgress").hidden = true;
    let pending = false, completed = 0, outcome = "", failed = false;
    try {
      message(`Checking space for ${files.length} ${files.length === 1 ? "file" : "files"} (${size(totalSize)})…`);
      const checked = await request("/api/files/preflight", {totalSize, fileCount: files.length}, {signal: abort.signal});
      check(); showSpace(checked); chunkSize = checked.chunkSize;
      if (!checked.fits) throw new Error(`Not enough space: selected files need ${size(totalSize)}; ${size(checked.usableBytes)} is available after keeping ${size(checked.reserveBytes)} free.`);
      el("fileProgress").hidden = false;
      for (const file of files) {
        if (abort.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        el("fileProgress").value = 0;
        message(`Uploading ${file.name} (${completed + 1}/${files.length}) — 0%`);
        // Begin may succeed even if its response is lost. Cancel the session's
        // one pending upload on failure, including that uncertain response.
        pending = true;
        const started = await request("/api/files/begin", {name: file.name, size: file.size}, {signal: abort.signal});
        check();
        for (let offset = 0; offset < file.size;) {
          const end = Math.min(offset + Math.min(chunkSize, started.chunkSize), file.size);
          const part = file.slice(offset, end);
          const result = await request("/api/files/chunk", null, {signal: abort.signal, body: part,
            headers: {"Content-Type": "application/octet-stream", "X-Upload-ID": started.id, "X-Upload-Offset": String(offset)}});
          check();
          if (result.offset !== end) throw new Error("Upload progress did not match; send the file again");
          offset = end;
          const progress = Math.round(offset / file.size * 100);
          el("fileProgress").value = progress;
          message(`Uploading ${file.name} (${completed + 1}/${files.length}) — ${progress}%`);
        }
        const saved = await request("/api/files/finish", {id: started.id}, {signal: abort.signal});
        check();
        pending = false; completed++;
        el("fileProgress").value = 100;
        outcome = files.length === 1 ? "Uploaded " + saved.name + ". Open the shared folder in Dolphin to use it." : `Uploaded ${completed} files. Open the shared folder in Dolphin to use them.`;
      }
    } catch (error) {
      failed = error.name !== "AbortError";
      outcome = error.name === "AbortError" ? "Upload cancelled." : error.message;
      if (completed) outcome += ` ${completed} completed ${completed === 1 ? "file remains" : "files remain"} in the shared folder.`;
    } finally {
      if (pending && current === generation && paired()) {
        try { await request("/api/files/cancel", {}); }
        catch { outcome += " An unfinished upload will be cleaned up automatically."; }
      }
      if (current === generation) {
        controller = null; setBusy(false); el("fileInput").value = ""; el("fileProgress").hidden = true;
        await refresh({announce: false});
        message(outcome, failed);
      }
    }
  }
  el("fileInput").addEventListener("change", () => { void upload(el("fileInput").files); });
  el("refreshFiles").addEventListener("click", () => { void refresh(); });
  el("cancelUpload").addEventListener("click", () => { controller?.abort(); message("Cancelling upload…"); });
  el("sharedFolder").addEventListener("click", () => el("sharedFolder").select());
  for (const kind of ["dragover", "drop"]) el("fileDrop").addEventListener(kind, event => {
    event.preventDefault();
    if (kind === "drop") {
      if (Array.from(event.dataTransfer.items || []).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        message("Choose individual files. Folder uploads are not supported yet.", true); return;
      }
      void upload(event.dataTransfer.files);
    }
  });
  return {refresh, reset() {
    generation++; controller?.abort(); controller = null; setBusy(false);
    el("fileInput").value = ""; el("sharedFolder").value = ""; el("fileList").replaceChildren();
    el("fileSpace").textContent = "Available space is checked before uploading.";
    el("fileCount").textContent = ""; el("fileProgress").hidden = true;
    message("Pair with the Legion to share files.");
  }};
};
