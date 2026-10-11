"use strict";
const el = id => document.getElementById(id);
const pad = el("pad");
let token = "", active = false, events = [], flushing = false, pairing = false;
let serial = Promise.resolve(), drag = null, wheel = 0;
const supported = new Set([
  ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", letter => "Key" + letter),
  ...Array.from("0123456789", digit => "Digit" + digit),
  ...Array.from("0123456789", digit => "Numpad" + digit),
  ...Array.from({length: 12}, (_, index) => "F" + (index + 1)),
  "Escape", "Minus", "Equal", "Backspace", "Tab", "BracketLeft", "BracketRight", "Enter",
  "ControlLeft", "ControlRight", "Semicolon", "Quote", "Backquote", "ShiftLeft", "ShiftRight",
  "Backslash", "Comma", "Period", "Slash", "AltLeft", "AltRight", "Space", "CapsLock", "NumLock",
  "ScrollLock", "NumpadEnter", "NumpadDivide", "NumpadMultiply", "NumpadSubtract", "NumpadAdd",
  "NumpadDecimal", "Home", "ArrowUp", "PageUp", "ArrowLeft", "ArrowRight", "End", "ArrowDown",
  "PageDown", "Insert", "Delete", "MetaLeft", "MetaRight", "ContextMenu",
]);

function status(message, error = false) { el("status").textContent = message; el("status").classList.toggle("error", error); }
function setCapture(value) {
  active = value && !!token;
  pad.classList.toggle("active", active);
  el("capture").textContent = active ? "Pause control" : "Start control";
  el("captureHint").textContent = active ? "Keys go to the Legion while the pad has focus. Escape pauses control." : "Start control to send keys. Drag inside the pad to move the cursor.";
  if (active) pad.focus();
  else {
    drag = null;
    events = token ? [{type:"release"}] : [];
    if (document.pointerLockElement === pad) document.exitPointerLock();
  }
}
function ended(message) {
  token = ""; events = []; setCapture(false);
  el("controller").hidden = true; el("pairPanel").hidden = false;
  status(message, true);
}
function api(path, data, {fatal = true, keepalive = false} = {}) {
  const credential = token;
  const work = async () => {
    if (path !== "/api/pair" && credential !== token) throw new Error("Session changed");
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 1500);
    try {
      const response = await fetch(path, {method:"POST", credentials:"omit", cache:"no-store",
        headers:{"Content-Type":"application/json", ...(credential ? {Authorization:"Bearer " + credential} : {})},
        body:JSON.stringify(data), signal:timeout.signal, keepalive});
      const result = await response.json();
      if (!response.ok) {
        if (fatal && response.status !== 400) ended(result.error || "Connection lost. Pair again in Decky.");
        throw new Error(result.error || "Request failed");
      }
      return result;
    } catch (error) {
      if (fatal && token && (error.name === "AbortError" || error instanceof TypeError)) ended("Connection lost. Check Wi-Fi and pair again in Decky.");
      throw error;
    } finally { clearTimeout(timer); }
  };
  const result = serial.then(work);
  serial = result.catch(() => {});
  return result;
}
function queue(event) {
  if (!token) return;
  if (events.length >= 256) { setCapture(false); status("Input paused because the connection is too slow.", true); return; }
  if (event.type === "move") {
    const previous = events.at(-1);
    if (previous?.type === "move") {
      previous.dx = Math.max(-1000, Math.min(1000, previous.dx + event.dx));
      previous.dy = Math.max(-1000, Math.min(1000, previous.dy + event.dy));
      return;
    }
  }
  events.push(event);
}
async function flush() {
  if (!token || flushing || !events.length) return;
  flushing = true;
  const batch = events.splice(0, 64);
  try { await api("/api/events", {events:batch}); }
  catch (error) { status(error.message, true); setCapture(false); }
  finally { flushing = false; }
}
setInterval(() => { void flush(); }, 25);
let heartbeatBusy = false;
setInterval(async () => {
  if (!token || heartbeatBusy) return;
  heartbeatBusy = true;
  try { await api("/api/heartbeat", {}); } catch (error) { status(error.message, true); }
  finally { heartbeatBusy = false; }
}, 1000);

el("pairForm").addEventListener("submit", async event => {
  event.preventDefault(); if (pairing) return;
  pairing = true; el("pairButton").disabled = true;
  try {
    const result = await api("/api/pair", {pin:el("pin").value}, {fatal:false});
    token = result.token; el("pin").value = "";
    el("pairPanel").hidden = true; el("controller").hidden = false;
    status("Paired with your Legion. Start control or send text.");
  } catch (error) { status(error.message, true); }
  finally { pairing = false; el("pairButton").disabled = false; }
});
// Preserve pad focus until click, so the blur handler cannot reverse Pause.
el("capture").addEventListener("pointerdown", event => event.preventDefault());
el("capture").addEventListener("click", () => setCapture(!active));
pad.addEventListener("click", () => { if (!active && token) setCapture(true); });
for (const kind of ["keydown", "keyup"]) pad.addEventListener(kind, event => {
  if (!active || event.isComposing) return;
  if (event.code === "Escape") { event.preventDefault(); setCapture(false); return; }
  if (!supported.has(event.code)) return;
  event.preventDefault();
  queue({type:"key", code:event.code, value:kind === "keyup" ? 0 : event.repeat ? 2 : 1});
});
pad.addEventListener("blur", () => setCapture(false));
window.addEventListener("blur", () => setCapture(false));
document.addEventListener("visibilitychange", () => {
  if (document.hidden && token) {
    setCapture(false);
    events = [];
    void api("/api/events", {events:[{type:"release"}]}, {keepalive:true}).catch(() => {});
  }
});
window.addEventListener("pagehide", () => {
  if (token) void api("/api/disconnect", {}, {keepalive:true}).catch(() => {});
});

const buttonName = index => ["left", "middle", "right"][index];
pad.addEventListener("pointerdown", event => {
  if (!token) return;
  setCapture(true);
  if (document.pointerLockElement === pad) {
    const button = buttonName(event.button);
    if (button) queue({type:"button", button, value:1});
  } else if (event.button === 0) {
    drag = {id:event.pointerId, x:event.clientX, y:event.clientY};
    pad.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
});
pad.addEventListener("pointermove", event => {
  if (!active) return;
  let dx = 0, dy = 0;
  if (document.pointerLockElement === pad) { dx = event.movementX; dy = event.movementY; }
  else if (drag?.id === event.pointerId) {
    dx = event.clientX - drag.x; dy = event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY;
  }
  dx = Math.max(-1000, Math.min(1000, Math.round(dx)));
  dy = Math.max(-1000, Math.min(1000, Math.round(dy)));
  if (dx || dy) queue({type:"move", dx, dy});
});
pad.addEventListener("pointerup", event => {
  if (document.pointerLockElement === pad) {
    const button = buttonName(event.button);
    if (button) queue({type:"button", button, value:0});
  }
  if (drag?.id === event.pointerId) drag = null;
});
pad.addEventListener("pointercancel", () => setCapture(false));
pad.addEventListener("contextmenu", event => { if (active) event.preventDefault(); });
pad.addEventListener("wheel", event => {
  if (!active) return;
  event.preventDefault();
  wheel += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
  const steps = Math.max(-10, Math.min(10, Math.trunc(wheel / 80)));
  if (steps) { queue({type:"wheel", delta:-steps}); wheel -= steps * 80; }
}, {passive:false});
el("mouseLock").addEventListener("click", async () => {
  setCapture(true);
  try { await pad.requestPointerLock(); }
  catch { status("Mouse capture is unavailable. Drag in the pad and use the click buttons.", true); }
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== pad) setCapture(false);
});
document.addEventListener("pointerlockerror", () => status("Mouse capture is unavailable. Use the touchpad and click buttons.", true));
for (const button of document.querySelectorAll("[data-click]")) button.addEventListener("click", () => {
  queue({type:"button", button:button.dataset.click, value:1});
  queue({type:"button", button:button.dataset.click, value:0});
});
for (const button of document.querySelectorAll("[data-key]")) button.addEventListener("click", () => {
  queue({type:"key", code:button.dataset.key, value:1});
  queue({type:"key", code:button.dataset.key, value:0});
});
el("showDesktop").addEventListener("click", () => {
  for (const [code, value] of [["MetaLeft",1],["KeyD",1],["KeyD",0],["MetaLeft",0]]) queue({type:"key",code,value});
});
el("sendText").addEventListener("click", async () => {
  const text = el("text").value;
  if (!text.length || /[^\x09\x0a\x20-\x7e]/.test(text)) { status("Enter 1–128 US English characters. Unicode text is not supported yet.", true); return; }
  setCapture(false); await flush();
  el("sendText").disabled = true;
  try { await api("/api/text", {text}); el("text").value = ""; status("Text sent. Check the selected field on the Legion."); }
  catch (error) { status(error.message, true); }
  finally { el("sendText").disabled = false; }
});
el("disconnect").addEventListener("click", async () => {
  setCapture(false); events = [];
  try { await api("/api/disconnect", {}); } catch {}
  ended("Disconnected. Pair again using the new code in Decky.");
});
