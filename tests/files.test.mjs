import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 20; i++) await tick(); }
function file(name, data) { const blob = new Blob([data]); blob.name = name; return blob; }
function harness(handler) {
  const links = [], calls = [];
  class Element {
    constructor() { this.handlers = {}; this.children = []; this.classes = new Set(); this.classList = {toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name)}; }
    addEventListener(kind, fn) { (this.handlers[kind] ??= []).push(fn); }
    emit(kind, data = {}) { for (const fn of this.handlers[kind] || []) fn({preventDefault() {}, ...data}); }
    setAttribute(name, value) { this[name] = value; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    querySelectorAll() { return this.children.flatMap(child => child.children.slice(1)); }
    click() { links.push({href: this.href, download: this.download}); }
    remove() {}
    select() { this.selected = true; }
  }
  const ids = ["fileStatus", "fileSpace", "fileInput", "refreshFiles", "cancelUpload", "fileList", "fileCount", "sharedFolder", "fileProgress", "fileDrop"];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const document = {getElementById: id => elements[id], createElement: () => new Element(), body: new Element()};
  let paired = true;
  const context = vm.createContext({window: {}, document, AbortController, DOMException});
  vm.runInContext(readFileSync(new URL("../web/files.js", import.meta.url), "utf8"), context);
  const api = context.window.createFileSharing({paired: () => paired, request: async (path, data, options) => {
    calls.push({path, data, options});
    if (handler) { const result = await handler(path, data, options); if (result !== undefined) return result; }
    if (path.endsWith("list")) return {files: [], folder: "/home/deck/Downloads/Decky Remote", freeBytes: 100 * 1024 ** 3, usableBytes: 100 * 1024 ** 3 - 64 * 1024 ** 2, reserveBytes: 64 * 1024 ** 2, chunkSize: 4};
    if (path.endsWith("preflight")) return {fits: true, usableBytes: 100 * 1024 ** 3 - 64 * 1024 ** 2, reserveBytes: 64 * 1024 ** 2, chunkSize: 4};
    if (path.endsWith("begin")) return {id: "upload", chunkSize: 4};
    if (path.endsWith("chunk")) return {offset: Number(options.headers["X-Upload-Offset"]) + options.body.size};
    if (path.endsWith("finish")) return {name: "saved.txt"};
    if (path.endsWith("download")) return {url: "/download/" + "a".repeat(48)};
    return {ok: true};
  }});
  return {elements, api, calls, links, unpair() { paired = false; api.reset(); },
    async upload(files) { elements.fileInput.files = files; elements.fileInput.emit("change"); await settle(); }};
}

test("multiple file picker uploads are sequential, chunked, and show completion", async () => {
  const h = harness(); await h.api.refresh();
  await h.upload([file("first.txt", "123456789"), file("empty", "")]);
  assert.deepEqual(h.calls.filter(call => call.path.endsWith("begin")).map(call => call.data.name), ["first.txt", "empty"]);
  const chunks = h.calls.filter(call => call.path.endsWith("chunk"));
  assert.deepEqual(chunks.map(call => call.options.headers["X-Upload-Offset"]), ["0", "4", "8"]);
  assert.equal((await Promise.all(chunks.map(call => call.options.body.text()))).join(""), "123456789");
  assert.equal(h.calls.filter(call => call.path.endsWith("finish")).length, 2);
  assert.equal(h.calls.some(call => call.path.endsWith("cancel")), false);
  assert.match(h.elements.fileStatus.textContent, /Uploaded 2 files/);
  assert.equal(h.elements.fileInput.disabled, false);
  assert.equal(h.elements.fileProgress.hidden, true);
});

test("list renders filenames as text and downloads with a temporary same-origin link", async () => {
  const h = harness(path => path.endsWith("list") ? {files: [{name: "<img onerror=bad>.txt", size: 1200}], folder: "/home/deck/Downloads/Decky Remote", usableBytes: 1024 ** 3, reserveBytes: 64 * 1024 ** 2, chunkSize: 4} : undefined);
  await h.api.refresh();
  assert.match(h.elements.fileSpace.textContent, /1.0 GiB available.*64.0 MiB kept free/);
  assert.equal(h.elements.fileList.children[0].children[0].children[0].textContent, "<img onerror=bad>.txt");
  h.elements.fileList.children[0].children[1].emit("click"); await settle();
  assert.deepEqual(h.links, [{href: "/download/" + "a".repeat(48), download: "<img onerror=bad>.txt"}]);
  assert.match(h.elements.fileStatus.textContent, /Download started/);
  h.elements.sharedFolder.emit("click"); assert.equal(h.elements.sharedFolder.selected, true);
});

test("foreign download links are rejected", async () => {
  const h = harness(path => path.endsWith("list") ? {files: [{name: "a", size: 1}], usableBytes: 1024, reserveBytes: 64 * 1024 ** 2, chunkSize: 4} : path.endsWith("download") ? {url: "https://evil.example"} : undefined);
  await h.api.refresh(); h.elements.fileList.children[0].children[1].emit("click"); await settle();
  assert.equal(h.links.length, 0); assert.match(h.elements.fileStatus.textContent, /Invalid download link/);
});

test("imprecise file sizes and dropped directories do not start uploads", async () => {
  const h = harness(); await h.upload([{name: "big", size: Number.MAX_SAFE_INTEGER + 1}]);
  assert.equal(h.calls.length, 0); assert.match(h.elements.fileStatus.textContent, /exact byte-size range/);
  h.elements.fileDrop.emit("drop", {dataTransfer: {items: [{webkitGetAsEntry: () => ({isDirectory: true})}], files: [file("a", "a")]}});
  await settle(); assert.equal(h.calls.length, 0); assert.match(h.elements.fileStatus.textContent, /Folder uploads/);
});

test("whole selection is checked before any file begins and insufficient space is explained", async () => {
  const h = harness(path => path.endsWith("preflight") ? {fits: false, usableBytes: 6, reserveBytes: 64 * 1024 ** 2, chunkSize: 4} : undefined);
  await h.upload([file("first", "1234"), file("second", "5678")]);
  assert.equal(JSON.stringify(h.calls[0].data), JSON.stringify({totalSize: 8, fileCount: 2}));
  assert.equal(h.calls.some(call => /begin|chunk|finish|cancel/.test(call.path)), false);
  assert.match(h.elements.fileStatus.textContent, /need 8 B; 6 B is available/);
  assert.equal(h.elements.fileInput.disabled, false);
});

test("files above 2 GiB reach the server space check instead of being rejected locally", async () => {
  const h = harness(path => { if (path.endsWith("begin")) throw new Error("Test stops before sending large data"); });
  await h.upload([{name: "large.iso", size: 5 * 1024 ** 3}]);
  assert.equal(h.calls[0].path, "/api/files/preflight");
  assert.equal(h.calls[0].data.totalSize, 5 * 1024 ** 3);
  assert.equal(h.calls.find(call => call.path.endsWith("begin")).data.size, 5 * 1024 ** 3);
});

test("cancelling or resetting a pending space check never starts or cancels an upload", async () => {
  for (const reset of [false, true]) {
    let resolveCheck;
    const h = harness(path => path.endsWith("preflight") ? new Promise(resolve => { resolveCheck = resolve; }) : undefined);
    h.elements.fileInput.files = [file("a", "123")]; h.elements.fileInput.emit("change"); await settle();
    if (reset) h.unpair(); else h.elements.cancelUpload.emit("click");
    resolveCheck({fits: true, chunkSize: 4, usableBytes: 100, reserveBytes: 64}); await settle();
    assert.equal(h.calls.some(call => /begin|chunk|finish|cancel/.test(call.path)), false);
    assert.match(h.elements.fileStatus.textContent, reset ? /Pair with the Legion/ : /Upload cancelled/);
  }
});

test("lost begin response cancels the session's uncertain upload", async () => {
  const h = harness(path => { if (path.endsWith("begin")) throw new Error("Connection lost"); });
  await h.upload([file("a", "a")]);
  assert.equal(JSON.stringify(h.calls.find(call => call.path.endsWith("cancel")).data), "{}");
  assert.match(h.elements.fileStatus.textContent, /Connection lost/);
  assert.equal(h.elements.fileInput.disabled, false);
});

test("failed chunk cancels partial upload and preserves completed files in a batch", async () => {
  let begins = 0;
  const h = harness(path => { if (path.endsWith("begin")) begins++; if (path.endsWith("chunk") && begins === 2) throw new Error("Disk full"); });
  await h.upload([file("first", "a"), file("second", "b")]);
  assert.equal(h.calls.filter(call => call.path.endsWith("finish")).length, 1);
  assert.equal(h.calls.filter(call => call.path.endsWith("cancel")).length, 1);
  assert.match(h.elements.fileStatus.textContent, /Disk full.*1 completed file remains/);
});

test("cancel button aborts pending work, cleans upload, and restores controls", async () => {
  const h = harness((path, _, options) => {
    if (path.endsWith("chunk")) return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError"))));
  });
  h.elements.fileInput.files = [file("a", "123")]; h.elements.fileInput.emit("change"); await settle();
  assert.equal(h.elements.fileInput.disabled, true);
  h.elements.cancelUpload.emit("click"); await settle();
  assert.equal(h.calls.filter(call => call.path.endsWith("cancel")).length, 1);
  assert.equal(h.elements.cancelUpload.hidden, true);
  assert.match(h.elements.fileStatus.textContent, /Upload cancelled/);
});

test("session reset ignores late begin and list replies without cancelling a new session", async () => {
  let resolveBegin;
  const h = harness(path => path.endsWith("begin") ? new Promise(resolve => { resolveBegin = resolve; }) : undefined);
  h.elements.fileInput.files = [file("a", "123")]; h.elements.fileInput.emit("change"); await settle();
  h.unpair(); resolveBegin({id: "old", chunkSize: 4}); await settle();
  assert.equal(h.calls.some(call => /chunk|finish|cancel/.test(call.path)), false);
  assert.match(h.elements.fileStatus.textContent, /Pair with the Legion/);
  let resolveList;
  const second = harness(path => path.endsWith("list") ? new Promise(resolve => { resolveList = resolve; }) : undefined);
  const pending = second.api.refresh(); await tick(); second.unpair(); resolveList({files: [{name: "stale", size: 1}]}); await pending;
  assert.equal(second.elements.fileList.children.length, 0);
});
