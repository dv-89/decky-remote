import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function harness({pointerLock="promise"}={}) {
  let doc, completeRequest;
  let lockRequests=0;
  class Element {
    constructor(id) { this.id=id; this.handlers={}; this.value=""; this.hidden=false; this.dataset={}; this.classes=new Set(); this.classList={toggle:(name,on)=>on ? this.classes.add(name) : this.classes.delete(name)}; }
    addEventListener(kind, callback) { (this.handlers[kind] ??= []).push(callback); }
    async emit(kind, data={}) { for (const callback of this.handlers[kind] ?? []) await callback({preventDefault(){},...data}); }
    focus() { doc.activeElement=this; }
    setPointerCapture() {}
    requestPointerLock() {
      lockRequests++;
      if(pointerLock==="reject")return Promise.reject(new Error("Capture blocked"));
      if(pointerLock==="error"){void doc.emit("pointerlockerror");return;}
      if(pointerLock==="pending")return new Promise(resolve=>{completeRequest=resolve;});
      doc.pointerLockElement=this;
      const notification=doc.emit("pointerlockchange");
      return pointerLock==="legacy" ? undefined : notification;
    }
  }
  const ids=["pad","padTitle","padHint","mode","status","capture","captureHint","controller","pairPanel","pin","pairButton","pairForm","showDesktop","text","sendText","disconnect"];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  elements.mode.value="mouse";
  if(pointerLock==="unsupported")elements.pad.requestPointerLock=undefined;
  const left=new Element("left"); left.dataset.click="left";
  const enter=new Element("enter"); enter.dataset.key="Enter";
  doc=new Element("document");
  doc.getElementById=id=>elements[id];
  doc.querySelectorAll=selector=>selector==="[data-click]" ? [left] : [enter];
  doc.exitPointerLock=()=>{doc.pointerLockElement=null;void doc.emit("pointerlockchange");}; doc.pointerLockElement=null; doc.hidden=false;
  const window=new Element("window");
  const intervals=[], calls=[];
  let reject=false;
  const context=vm.createContext({document:doc,window,AbortController,console,setTimeout,clearTimeout, setInterval:fn=>intervals.push(fn),fetch:async(path,opts)=>{
    calls.push({path,data:JSON.parse(opts.body),headers:opts.headers});
    return {ok:!reject,status:reject?401:200,json:async()=>reject?{error:"Session ended"}:path==="/api/pair"?{token:"test-token"}:{ok:true}};
  }});
  vm.runInContext(readFileSync(new URL("../web/client.js",import.meta.url),"utf8"),context);
  return {elements,left,enter,doc,window,intervals,calls, reject:()=>{reject=true;},
    get lockRequests(){return lockRequests;},
    async completeLock(){doc.pointerLockElement=elements.pad;await doc.emit("pointerlockchange");completeRequest?.();await new Promise(resolve=>setTimeout(resolve,0));},
    async pair(){elements.pin.value="00123456";await elements.pairForm.emit("submit");},
    async flush(){await intervals[0]();await new Promise(resolve=>setTimeout(resolve,0));}};
}

test("Start control captures mouse and keyboard, including physical clicks and button chords", async()=>{
  const h=harness(); await h.pair();
  assert.equal(h.elements.controller.hidden,false);
  assert.equal(h.elements.pin.value,"");
  await h.elements.capture.emit("click");
  assert.equal(h.lockRequests,1);
  assert.equal(h.doc.pointerLockElement,h.elements.pad);
  assert.equal(h.elements.mode.disabled,true);
  await h.doc.emit("keydown",{code:"KeyW",repeat:false});
  await h.doc.emit("keyup",{code:"KeyW"});
  // Browsers may emit both pointer and mouse events; do not duplicate movement.
  await h.elements.pad.emit("pointerdown",{button:0,pointerId:1,clientX:10,clientY:10});
  await h.elements.pad.emit("pointermove",{pointerId:1,clientX:20,clientY:15,movementX:10,movementY:5});
  await h.elements.pad.emit("pointerup",{pointerId:1});
  await h.doc.emit("mousemove",{movementX:10,movementY:5});
  await h.doc.emit("wheel",{deltaY:80,deltaMode:0});
  for(const [kind,button] of [["mousedown",0],["mousedown",2],["mousedown",1],["mouseup",0],["mouseup",2],["mouseup",1]])await h.doc.emit(kind,{button});
  await h.flush();
  const request=h.calls.find(item=>item.path==="/api/events");
  assert.equal(request.headers.Authorization,"Bearer test-token");
  assert.deepEqual(request.data.events,[{type:"key",code:"KeyW",value:1},{type:"key",code:"KeyW",value:0},{type:"move",dx:10,dy:5},{type:"wheel",delta:-1},{type:"button",button:"left",value:1},{type:"button",button:"right",value:1},{type:"button",button:"middle",value:1},{type:"button",button:"left",value:0},{type:"button",button:"right",value:0},{type:"button",button:"middle",value:0}]);
});

test("Escape and loss of window focus discard pending presses and release input",async()=>{
  for (const action of ["escape","blur","hidden","unlock"]) {
    const h=harness(); await h.pair();await h.elements.capture.emit("click");
    await h.doc.emit("keydown",{code:"KeyA",repeat:false});
    await h.doc.emit("mousedown",{button:0});
    if(action==="escape")await h.doc.emit("keydown",{code:"Escape"});
    if(action==="blur")await h.window.emit("blur");
    if(action==="hidden"){h.doc.hidden=true;await h.doc.emit("visibilitychange");}
    if(action==="unlock"){h.doc.pointerLockElement=null;await h.doc.emit("pointerlockchange");}
    await h.flush();
    assert.deepEqual(h.calls.filter(item=>item.path==="/api/events").at(-1).data.events,[{type:"release"}]);
    assert.equal(h.elements.capture.textContent,"Start control");
    assert.equal(h.doc.pointerLockElement,null);
    assert.equal(h.elements.mode.disabled,false);
  }
});

test("unsupported text stays local; supported text and disconnect use authenticated requests",async()=>{
  const h=harness();await h.pair();
  h.elements.text.value="é";await h.elements.sendText.emit("click");
  assert.equal(h.calls.filter(item=>item.path==="/api/text").length,0);
  h.elements.text.value="Hello, Legion!";await h.elements.sendText.emit("click");
  assert.deepEqual(h.calls.find(item=>item.path==="/api/text").data,{text:"Hello, Legion!"});
  assert.equal(h.elements.text.value,"");
  await h.elements.disconnect.emit("click");
  assert.equal(h.calls.at(-1).path,"/api/disconnect");
  assert.equal(h.elements.controller.hidden,true);
});

test("expired credentials return the browser to pairing and discard input",async()=>{
  const h=harness();await h.pair();await h.elements.capture.emit("click");
  h.reject();await h.doc.emit("keydown",{code:"KeyA",repeat:false});await h.flush();
  assert.equal(h.elements.controller.hidden,true);
  assert.equal(h.elements.pairPanel.hidden,false);
  assert.equal(h.elements.status.textContent,"Session ended");
  const count=h.calls.length;await h.doc.emit("keydown",{code:"KeyB"});await h.doc.emit("mousedown",{button:0});await h.flush();
  assert.equal(h.calls.length,count);
});

test("Pause preserves capture state until click and releases all pending input",async()=>{
  const h=harness();await h.pair();await h.elements.capture.emit("click");
  let prevented=false;
  await h.elements.capture.emit("pointerdown",{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  await h.doc.emit("keydown",{code:"KeyW",repeat:false});
  await h.elements.capture.emit("click");await h.flush();
  assert.equal(h.elements.capture.textContent,"Start control");
  assert.equal(h.elements.status.textContent,"Control paused. Start control to resume.");
  assert.deepEqual(h.calls.at(-1).data.events,[{type:"release"}]);
});

test("touchpad fallback keeps manual controls and forwards keys only while the pad has focus",async()=>{
  const h=harness();await h.pair();h.elements.mode.value="touchpad";await h.elements.mode.emit("change");await h.elements.capture.emit("click");
  assert.equal(h.lockRequests,0);assert.equal(h.doc.pointerLockElement,null);
  await h.elements.pad.emit("pointerdown",{button:0,pointerId:1,clientX:10,clientY:10});
  await h.elements.pad.emit("pointermove",{pointerId:1,clientX:20,clientY:15});
  await h.elements.pad.emit("pointerup",{pointerId:1});
  await h.doc.emit("keydown",{code:"KeyA",repeat:false});await h.doc.emit("keyup",{code:"KeyA"});
  await h.elements.pad.emit("wheel",{deltaY:80,deltaMode:0});
  await h.left.emit("click");await h.enter.emit("click");await h.flush();
  assert.deepEqual(h.calls.find(item=>item.path==="/api/events").data.events,[{type:"release"},{type:"move",dx:10,dy:5},{type:"key",code:"KeyA",value:1},{type:"key",code:"KeyA",value:0},{type:"wheel",delta:-1},{type:"button",button:"left",value:1},{type:"button",button:"left",value:0},{type:"key",code:"Enter",value:1},{type:"key",code:"Enter",value:0}]);
  const count=h.calls.length;h.elements.text.focus();await h.doc.emit("keydown",{code:"KeyB"});await h.flush();assert.equal(h.calls.length,count);
});

test("legacy pointer lock waits for its change event; denial leaves input paused",async()=>{
  const legacy=harness({pointerLock:"legacy"});await legacy.pair();await legacy.elements.capture.emit("click");
  assert.equal(legacy.elements.capture.textContent,"Pause control");
  await legacy.doc.emit("keydown",{code:"Escape"});
  for(const mode of ["reject","error","unsupported"]){
    const h=harness({pointerLock:mode});await h.pair();await h.elements.capture.emit("click");await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(h.elements.capture.textContent,"Start control");assert.equal(h.elements.mode.disabled,false);
    assert.match(h.elements.status.textContent,/Touchpad mode/);
    await h.doc.emit("mousemove",{movementX:10,movementY:5});await h.doc.emit("mousedown",{button:0});await h.doc.emit("keydown",{code:"KeyA"});await h.flush();
    assert.deepEqual(h.calls.at(-1).data.events,[{type:"release"}]);
  }
});

test("cancelled or expired pending capture cannot become active when a late lock arrives",async()=>{
  for(const action of ["cancel","escape","disconnect"]){
    const h=harness({pointerLock:"pending"});await h.pair();await h.elements.capture.emit("click");
    assert.equal(h.elements.capture.textContent,"Cancel control");
    await h.doc.emit("mousemove",{movementX:10,movementY:5});await h.doc.emit("mousedown",{button:0});await h.doc.emit("keydown",{code:"KeyA"});
    if(action==="cancel")await h.elements.capture.emit("click");
    if(action==="escape")await h.doc.emit("keydown",{code:"Escape"});
    if(action==="disconnect")await h.elements.disconnect.emit("click");
    await h.completeLock();await h.flush();
    assert.equal(h.doc.pointerLockElement,null);assert.equal(h.elements.capture.textContent,"Start control");
    assert.equal(h.calls.some(call=>call.data.events?.some(event=>event.type!=="release")),false);
  }
});
