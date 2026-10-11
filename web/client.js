"use strict";
const el = id => document.getElementById(id);
const pad = el("pad");
let token = "", active = false, events = [], flushing = false, pairing = false;
let serial = Promise.resolve(), drag = null, wheel = 0, wheelX = 0;
let lockPending = false, lockTimer = null, captureRequest = 0;
let backspaceKey = null;
el("mode").value = window.matchMedia?.("(pointer: coarse)").matches ? "touchpad" : "mouse";
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
function fullControl() { return active && document.pointerLockElement === pad; }
function keyboardControl() { return fullControl() || (active && document.activeElement === pad); }
function renderCapture() {
  pad.classList.toggle("active", active);
  el("capture").textContent = lockPending ? "Cancel control" : active ? "Pause control" : "Start control";
  el("mode").disabled = active || lockPending;
  el("captureHint").textContent = lockPending ? "Waiting for mouse capture. Escape or Cancel control stops the request." : (el("mode").value === "mouse" ? "Move and click freely. " : "Drag the pad to move. ") + "Backspace sends Esc/Back to Steam. Shift + Backspace deletes text. Escape releases control.";
  el("padTitle").textContent = active ? "You’re controlling the handheld" : "Ready to control";
  el("padHint").textContent = active ? "Backspace: Back · Shift + Backspace: delete · Esc: release" : "Press Start control to begin";
}
function setCapture(value) {
  active = value && !!token;
  lockPending = false;
  clearTimeout(lockTimer);
  lockTimer = null;
  if (active) pad.focus();
  else {
    captureRequest++;
    drag = null;
    wheel = wheelX = 0;
    backspaceKey = null;
    events = token ? [{type:"release"}] : [];
    if (document.pointerLockElement === pad) document.exitPointerLock();
  }
  renderCapture();
}
function lockFailed() {
  if (!lockPending) return;
  setCapture(false);
  status("The browser could not capture your mouse. Choose Touchpad mode, or try Start control again.", true);
}
function pauseControl() {
  setCapture(false);
  status("Control paused. Start control to resume.");
}
function captureReady() {
  if (!lockPending || !token || document.hidden || document.pointerLockElement !== pad) return;
  setCapture(true);
  status("Control is active. Backspace goes back; Escape releases control.");
}
async function startControl() {
  if (!token || active || lockPending) return;
  if (el("mode").value === "touchpad") { setCapture(true); status("Touchpad is active. Backspace goes back; Escape pauses."); return; }
  const request = ++captureRequest;
  lockPending = true;
  renderCapture();
  lockTimer = setTimeout(lockFailed, 10000);
  try {
    // Request directly within the click gesture. Legacy browsers return
    // undefined and report the result through pointerlockchange instead.
    await pad.requestPointerLock();
    if (request !== captureRequest || !token || document.hidden) {
      // A late completion must not revive a cancelled request. Avoid undoing
      // a newer request's locks if the user has already started again.
      if (!active && !lockPending) setCapture(false);
      return;
    }
    captureReady();
  } catch {
    if (request === captureRequest) lockFailed();
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
    status("Paired with your handheld. Start control or send text.");
  } catch (error) { status(error.message, true); }
  finally { pairing = false; el("pairButton").disabled = false; }
});
// Preserve pad focus until click, so the blur handler cannot reverse Pause.
el("capture").addEventListener("pointerdown", event => event.preventDefault());
el("capture").addEventListener("click", () => {
  if (active || lockPending) pauseControl();
  else void startControl();
});
el("mode").addEventListener("change", pauseControl);
pad.addEventListener("click", () => { if (!active && !lockPending) void startControl(); });
for (const kind of ["keydown", "keyup"]) document.addEventListener(kind, event => {
  if (event.code === "Escape" && (lockPending || keyboardControl())) {
    event.preventDefault();
    if (kind === "keydown") pauseControl();
    return;
  }
  if (!active || event.isComposing) return;
  if (!keyboardControl()) return;
  if (!supported.has(event.code)) return;
  event.preventDefault();
  if (event.code === "Backspace") {
    // Choose once per physical press so changing Shift while held cannot
    // change the release key. Holding Back must not repeat Steam navigation.
    if (kind === "keydown" && !event.repeat) backspaceKey = event.shiftKey ? "Backspace" : "Escape";
    const code = backspaceKey;
    if (kind === "keyup") backspaceKey = null;
    if (code === "Escape") {
      if (kind === "keydown" && !event.repeat) {
        queue({type:"key", code:"Escape", value:1});
        queue({type:"key", code:"Escape", value:0});
      }
    } else if (code === "Backspace") {
      queue({type:"key", code, value:kind === "keyup" ? 0 : event.repeat ? 2 : 1});
    }
    return;
  }
  queue({type:"key", code:event.code, value:kind === "keyup" ? 0 : event.repeat ? 2 : 1});
});
pad.addEventListener("blur", () => { if (active && !fullControl()) pauseControl(); });
window.addEventListener("blur", () => { if (active || lockPending) pauseControl(); else setCapture(false); });
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
// Mouse events report every button transition, including multiple held buttons.
// Pointer events alone omit pointerdown/up for some mouse button chords.
for (const kind of ["mousedown", "mouseup"]) document.addEventListener(kind, event => {
  if (!fullControl()) return;
  event.preventDefault();
  const button = buttonName(event.button);
  if (button) queue({type:"button", button, value:kind === "mousedown" ? 1 : 0});
});
function move(dx, dy) {
  dx = Math.max(-1000, Math.min(1000, Math.round(dx)));
  dy = Math.max(-1000, Math.min(1000, Math.round(dy)));
  if (dx || dy) queue({type:"move", dx, dy});
}
document.addEventListener("mousemove", event => { if (fullControl()) move(event.movementX, event.movementY); });
pad.addEventListener("pointerdown", event => {
  if (!token || el("mode").value !== "touchpad") return;
  setCapture(true);
  if (event.button === 0) {
    drag = {id:event.pointerId, x:event.clientX, y:event.clientY};
    pad.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
});
pad.addEventListener("pointermove", event => {
  if (!active || el("mode").value !== "touchpad") return;
  if (drag?.id === event.pointerId) {
    move(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX; drag.y = event.clientY;
  }
});
pad.addEventListener("pointerup", event => {
  if (drag?.id === event.pointerId) drag = null;
});
pad.addEventListener("pointercancel", () => setCapture(false));
pad.addEventListener("contextmenu", event => { if (active) event.preventDefault(); });
document.addEventListener("contextmenu", event => { if (fullControl()) event.preventDefault(); });
document.addEventListener("auxclick", event => { if (fullControl()) event.preventDefault(); });
function scroll(event) {
  event.preventDefault();
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1;
  wheel += (event.deltaY || 0) * scale;
  wheelX += (event.deltaX || 0) * scale;
  const steps = Math.max(-10, Math.min(10, Math.trunc(wheel / 80)));
  const stepsX = Math.max(-10, Math.min(10, Math.trunc(wheelX / 80)));
  if (steps || stepsX) {
    // Linux vertical wheel values are positive up; horizontal values are positive right.
    queue({type:"wheel", delta:steps ? -steps : 0, ...(stepsX ? {deltaX:stepsX} : {})});
    wheel -= steps * 80;
    wheelX -= stepsX * 80;
  }
}
document.addEventListener("wheel", event => { if (fullControl()) scroll(event); }, {passive:false});
pad.addEventListener("wheel", event => { if (active && !fullControl()) scroll(event); }, {passive:false});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === pad) {
    if (lockPending && token && !document.hidden) {
      captureReady();
    } else if (!active || el("mode").value === "touchpad") document.exitPointerLock();
  } else if ((active || lockPending) && el("mode").value === "mouse") {
    pauseControl();
  }
});
document.addEventListener("pointerlockerror", () => lockFailed());
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
  try { await api("/api/text", {text}); el("text").value = ""; status("Text sent. Check the selected field on the handheld."); }
  catch (error) { status(error.message, true); }
  finally { el("sendText").disabled = false; }
});
el("disconnect").addEventListener("click", async () => {
  setCapture(false); events = [];
  try { await api("/api/disconnect", {}); } catch {}
  ended("Disconnected. Pair again using the new code in Decky.");
});
for (const name of ["remote", "text"]) el(name + "Tab").addEventListener("click", () => {
  if (active || lockPending) pauseControl();
  for (const pane of ["remote", "text"]) {
    el(pane + "Pane").hidden = pane !== name;
    el(pane + "Tab").setAttribute("aria-selected", String(pane === name));
  }
});
renderCapture();
