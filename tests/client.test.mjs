import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function harness({pointerLock="promise", mode="mouse", coarse=false}={}) {
  let doc, completeRequest;
  let now=10000;
  let lockRequests=0;
  const lockCalls=[], timers=new Map(); let nextTimer=0;
  class Element {
    constructor(id) { this.id=id; this.handlers={}; this.value=""; this.hidden=false; this.dataset={}; this.classes=new Set(); this.classList={toggle:(name,on)=>on ? this.classes.add(name) : this.classes.delete(name)}; }
    addEventListener(kind, callback) { (this.handlers[kind] ??= []).push(callback); }
    async emit(kind, data={}) { for (const callback of this.handlers[kind] ?? []) await callback({preventDefault(){},...data}); await new Promise(resolve=>setTimeout(resolve,0)); }
    focus() { doc.activeElement=this; }
    contains(target) { return target===this; }
    setAttribute(name,value) { this[name]=value; }
    setPointerCapture() {}
    requestPointerLock() {
      lockRequests++;lockCalls.push("pointer");
      if(pointerLock==="reject")return Promise.reject(new Error("Capture blocked"));
      if(pointerLock==="error"){void doc.emit("pointerlockerror");return;}
      if(pointerLock==="pending")return new Promise(resolve=>{completeRequest=resolve;});
      doc.pointerLockElement=this;
      const notification=doc.emit("pointerlockchange");
      return pointerLock==="legacy" ? undefined : notification;
    }
  }
  const ids=["pad","padTitle","padHint","mode","status","capture","captureHint","controller","pairPanel","pin","pairButton","pairForm","showDesktop","text","sendText","disconnect","remoteTab","textTab","filesTab","remotePane","textPane","filesPane"];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  elements.mode.value=mode;
  if(pointerLock==="unsupported")elements.pad.requestPointerLock=undefined;
  const left=new Element("left"); left.dataset.click="left";
  const enter=new Element("enter"); enter.dataset.key="Enter";
  const back=new Element("back"); back.dataset.key="Escape";
  const deleteKey=new Element("delete"); deleteKey.dataset.key="Backspace";
  doc=new Element("document");
  doc.getElementById=id=>elements[id];
  doc.querySelectorAll=selector=>selector==="[data-click]" ? [left] : [enter,back,deleteKey];
  doc.exitPointerLock=()=>{doc.pointerLockElement=null;void doc.emit("pointerlockchange");}; doc.pointerLockElement=null; doc.hidden=false;
  const window=new Element("window");
  window.matchMedia=()=>({matches:coarse});
  const intervals=[], calls=[];
  const uploads=[];
  class XHR {
    constructor(){this.upload={};this.headers={};uploads.push(this);}
    open(method,path){this.method=method;this.path=path;}
    setRequestHeader(key,value){this.headers[key]=value;}
    send(body){this.body=body;}
    abort(){this.aborted=true;this.onabort?.();}
    progress(loaded){this.upload.onprogress?.({loaded});}
    complete(status=200,response={name:"saved.bin"}){this.status=status;this.response=response;this.onload();}
  }
  let reject=false, pairs=0;
  // Deliberately omit navigator.keyboard and fullscreen: ordinary handheld
  // HTTP pages must capture without either privileged browser feature.
  const context=vm.createContext({document:doc,window,Date:{now:()=>now},AbortController,DOMException,XMLHttpRequest:XHR,console,
    setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:fn=>intervals.push(fn),fetch:async(path,opts)=>{
    calls.push({path,data:JSON.parse(opts.body),headers:opts.headers});
    return {ok:!reject,status:reject?401:200,json:async()=>reject?{error:"Session ended"}:path==="/api/pair"?{token:++pairs===1?"test-token":"test-token-"+pairs}:{ok:true}};
  }});
  vm.runInContext(readFileSync(new URL("../web/client.js",import.meta.url),"utf8"),context);
  if(!coarse)elements.mode.value=mode;
  return {elements,left,enter,back,deleteKey,doc,window,intervals,calls,lockCalls,uploads, reject:()=>{reject=true;},
    upload(body,options={}){context.uploadBody=body;context.uploadOptions=options;return vm.runInContext('fileRequest("/api/files/upload", null, {body:uploadBody,upload:true,headers:{"Content-Type":"application/octet-stream","X-Upload-ID":"id"},...uploadOptions})',context);},
    advance(ms){now+=ms;for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.fn();}},
    get lockRequests(){return lockRequests;},
    async completeLock(){doc.pointerLockElement=elements.pad;await doc.emit("pointerlockchange");completeRequest?.();await new Promise(resolve=>setTimeout(resolve,0));},
    async pair(){elements.pin.value="00123456";await elements.pairForm.emit("submit");},
    async flush(){await intervals[0]();await new Promise(resolve=>setTimeout(resolve,0));}};
}

test("native upload sends the original Blob once and remains active with ongoing progress",async()=>{
  const h=harness();await h.pair();
  const body=new Blob(["abcdef"]), progress=[];
  const pending=h.upload(body,{onProgress:loaded=>progress.push(loaded)});
  const xhr=h.uploads[0];
  assert.equal(xhr.body,body);assert.equal(xhr.path,"/api/files/upload");
  assert.equal(xhr.withCredentials,false);assert.equal(xhr.responseType,"json");
  assert.deepEqual(xhr.headers,{"Content-Type":"application/octet-stream","X-Upload-ID":"id",Authorization:"Bearer test-token"});
  for(let i=1;i<=5;i++){h.advance(20000);xhr.progress(i);assert.equal(xhr.aborted,undefined);}
  xhr.upload.onload();assert.deepEqual(progress,[1,2,3,4,5,6]);
  xhr.complete();assert.equal((await pending).name,"saved.bin");
  h.advance(60000);assert.equal(xhr.aborted,undefined);
});

test("upload cancellation, pre-abort, inactivity and network failure settle and clear timers",async()=>{
  for(const action of ["cancel","preabort","idle","network"]){
    const h=harness();await h.pair();const abort=new AbortController();
    if(action==="preabort")abort.abort();
    const pending=h.upload(new Blob(["a"]),{signal:abort.signal});
    const rejected=assert.rejects(pending,action==="idle"?/Upload stalled/:action==="network"?/connection lost/:{name:"AbortError"});
    const xhr=h.uploads[0];
    if(action==="cancel")abort.abort();
    if(action==="idle")h.advance(30001);
    if(action==="network")xhr.onerror();
    await rejected;h.advance(60000);
    if(action==="network"||action==="preabort")assert.equal(xhr.aborted,undefined);
    else assert.equal(xhr.aborted,true);
  }
});

test("upload errors and expired credentials are handled; stale replies cannot end a newer pairing",async()=>{
  for(const status of [507,401,200]){
    const h=harness();await h.pair();const pending=h.upload(new Blob(["a"]));
    const rejected=assert.rejects(pending,status===200?/Invalid upload response/:/failure/);
    h.uploads[0].complete(status,status===200?null:{error:"failure"});await rejected;
    assert.equal(h.elements.controller.hidden,status===401);
  }
  const h=harness();await h.pair();let updates=0;
  const pending=h.upload(new Blob(["a"]),{onProgress:()=>updates++});
  const rejected=assert.rejects(pending,/Session changed/);
  await h.elements.disconnect.emit("click");await h.pair();
  h.uploads[0].progress(1);h.uploads[0].complete(401,{error:"old session"});
  await rejected;assert.equal(updates,0);assert.equal(h.elements.controller.hidden,false);
});

test("Start control captures mouse and keyboard, including physical clicks and button chords", async()=>{
  const h=harness(); await h.pair();
  assert.equal(h.elements.controller.hidden,false);
  assert.equal(h.elements.pin.value,"");
  await h.elements.capture.emit("click");
  assert.equal(h.lockRequests,1);
  assert.equal(h.doc.pointerLockElement,h.elements.pad);
  assert.deepEqual(h.lockCalls,["pointer"]);
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

test("one Escape, pointer unlock and loss of window focus discard pending presses and release input",async()=>{
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

test("one physical Escape pauses immediately; the Back button sends Escape to the handheld",async()=>{
  for(const mode of ["mouse","touchpad"]){
    const h=harness({mode});await h.pair();await h.elements.capture.emit("click");
    assert.equal(h.lockRequests,mode==="mouse"?1:0);
    await h.back.emit("click");await h.flush();
    assert.deepEqual(h.calls.at(-1).data.events,[{type:"key",code:"Escape",value:1},{type:"key",code:"Escape",value:0}]);
    assert.equal(h.elements.capture.textContent,"Pause control");
    await h.doc.emit("keydown",{code:"KeyW"});
    await h.doc.emit("keydown",{code:"Escape",repeat:false});
    await h.doc.emit("keydown",{code:"Escape",repeat:true});
    await h.doc.emit("keyup",{code:"Escape"});await h.flush();
    assert.equal(h.elements.capture.textContent,"Start control");
    assert.deepEqual(h.calls.at(-1).data.events,[{type:"release"}]);
    assert.equal(h.doc.pointerLockElement,null);
    h.advance(3000);await h.flush();assert.equal(h.elements.capture.textContent,"Start control");
    await h.elements.capture.emit("click");assert.equal(h.elements.capture.textContent,"Pause control");
  }
});

test("Backspace sends one Escape per press without unlocking; the Delete button still deletes",async()=>{
  for(const mode of ["mouse","touchpad"]){
    const h=harness({mode});await h.pair();await h.elements.capture.emit("click");
    for(let i=0;i<2;i++){
      await h.doc.emit("keydown",{code:"Backspace",repeat:false});
      await h.doc.emit("keydown",{code:"Backspace",repeat:true});
      await h.doc.emit("keyup",{code:"Backspace"});await h.flush();
      assert.deepEqual(h.calls.at(-1).data.events,[{type:"key",code:"Escape",value:1},{type:"key",code:"Escape",value:0}]);
      assert.equal(h.elements.capture.textContent,"Pause control");
      assert.equal(h.doc.pointerLockElement,mode==="mouse"?h.elements.pad:null);
    }
    await h.deleteKey.emit("click");await h.flush();
    assert.deepEqual(h.calls.at(-1).data.events,[{type:"key",code:"Backspace",value:1},{type:"key",code:"Backspace",value:0}]);
  }
});

test("Shift+Backspace deletes with repeat and keeps its chosen mapping when Shift changes",async()=>{
  for(const mode of ["mouse","touchpad"]){
    const h=harness({mode});await h.pair();await h.elements.capture.emit("click");
    await h.doc.emit("keydown",{code:"ShiftLeft",shiftKey:true});
    await h.doc.emit("keydown",{code:"Backspace",shiftKey:true});
    await h.doc.emit("keydown",{code:"Backspace",shiftKey:true,repeat:true});
    await h.doc.emit("keyup",{code:"ShiftLeft",shiftKey:false});
    await h.doc.emit("keydown",{code:"Backspace",shiftKey:false,repeat:true});
    await h.doc.emit("keyup",{code:"Backspace",shiftKey:false});await h.flush();
    assert.deepEqual(h.calls.at(-1).data.events,[
      {type:"key",code:"ShiftLeft",value:1},{type:"key",code:"Backspace",value:1},
      {type:"key",code:"Backspace",value:2},{type:"key",code:"ShiftLeft",value:0},
      {type:"key",code:"Backspace",value:2},{type:"key",code:"Backspace",value:0},
    ]);
    await h.doc.emit("keydown",{code:"Backspace"});await h.flush();
    await h.doc.emit("keydown",{code:"ShiftRight",shiftKey:true});
    await h.doc.emit("keydown",{code:"Backspace",shiftKey:true,repeat:true});
    await h.doc.emit("keyup",{code:"Backspace",shiftKey:true});
    await h.doc.emit("keyup",{code:"ShiftRight",shiftKey:false});await h.flush();
    assert.deepEqual(h.calls.at(-1).data.events,[{type:"key",code:"ShiftRight",value:1},{type:"key",code:"ShiftRight",value:0}]);
    assert.equal(h.elements.capture.textContent,"Pause control");
  }
});

test("Backspace stays local outside capture and pause clears its held mapping",async()=>{
  for(const action of ["pause","blur","hidden","text"]){
    const h=harness();await h.pair();
    await h.doc.emit("keydown",{code:"Backspace"});await h.doc.emit("keyup",{code:"Backspace"});await h.flush();
    assert.equal(h.calls.length,1);
    await h.elements.capture.emit("click");
    await h.doc.emit("keydown",{code:"Backspace",shiftKey:true});
    if(action==="pause")await h.elements.capture.emit("click");
    if(action==="blur")await h.window.emit("blur");
    if(action==="hidden"){h.doc.hidden=true;await h.doc.emit("visibilitychange");h.doc.hidden=false;}
    if(action==="text"){await h.elements.textTab.emit("click");h.elements.text.focus();}
    await h.flush();assert.deepEqual(h.calls.at(-1).data.events,[{type:"release"}]);
    let prevented=false;const count=h.calls.length;
    await h.doc.emit("keydown",{code:"Backspace",preventDefault(){prevented=true;}});await h.flush();
    assert.equal(prevented,false);assert.equal(h.calls.length,count);
    if(action==="text")await h.elements.remoteTab.emit("click");
    await h.elements.capture.emit("click");await h.doc.emit("keyup",{code:"Backspace"});await h.flush();
    assert.equal(h.calls.length,count);
    await h.doc.emit("keydown",{code:"Backspace"});await h.doc.emit("keyup",{code:"Backspace"});await h.flush();
    assert.deepEqual(h.calls.at(-1).data.events,[{type:"key",code:"Escape",value:1},{type:"key",code:"Escape",value:0}]);
  }
});

test("desktop defaults to Unlimited capture and the removed Pad control option is absent",async()=>{
  const html=readFileSync(new URL("../web/index.html",import.meta.url),"utf8");
  assert.doesNotMatch(html,/value="window"|Pad control|three quick presses|helper|Keyboard Lock|hold Esc/i);
  assert.match(html,/Unlimited capture — Esc to release/);
  const h=harness();assert.equal(h.elements.mode.value,"mouse");
  await h.pair();await h.elements.capture.emit("click");
  await h.elements.pad.emit("mouseleave");assert.equal(h.elements.capture.textContent,"Pause control");
});

test("mobile chooses touchpad and changing tools pauses input before text entry",async()=>{
  const h=harness({coarse:true});await h.pair();
  assert.equal(h.elements.mode.value,"touchpad");await h.elements.capture.emit("click");
  await h.doc.emit("keydown",{code:"KeyW"});await h.elements.textTab.emit("click");await h.flush();
  assert.deepEqual(h.calls.at(-1).data.events,[{type:"release"}]);
  assert.equal(h.elements.remotePane.hidden,true);assert.equal(h.elements.textPane.hidden,false);
  assert.equal(h.elements.textTab["aria-selected"],"true");
  const count=h.calls.length;await h.doc.emit("keydown",{code:"KeyA"});await h.flush();assert.equal(h.calls.length,count);
  await h.elements.remoteTab.emit("click");assert.equal(h.elements.textPane.hidden,true);
  await h.elements.capture.emit("click");await h.doc.emit("keydown",{code:"KeyA"});
  await h.elements.filesTab.emit("click");await h.flush();
  assert.equal(h.elements.filesPane.hidden,false);assert.equal(h.elements.remotePane.hidden,true);
  assert.equal(h.elements.capture.textContent,"Start control");
  assert.deepEqual(h.calls.at(-1).data.events,[{type:"release"}]);
});

test("horizontal and diagonal scrolling forwards both axes in full control and touchpad modes",async()=>{
  for (const mode of ["mouse", "touchpad"]) {
    const h=harness();await h.pair();h.elements.mode.value=mode;await h.elements.capture.emit("click");
    const target=mode==="mouse" ? h.doc : h.elements.pad;
    // Fractional trackpad deltas must accumulate, independently on each axis.
    await target.emit("wheel",{deltaX:30.5,deltaY:0,deltaMode:0});
    await target.emit("wheel",{deltaX:49.5,deltaY:0,deltaMode:0});
    await target.emit("wheel",{deltaX:-160,deltaY:80,deltaMode:0});
    await target.emit("wheel",{deltaX:5,deltaY:-5,deltaMode:1});
    await target.emit("wheel",{deltaX:-0.4,deltaY:0.4,deltaMode:2});
    await target.emit("wheel",{deltaX:800,deltaY:-800,deltaMode:0});
    await h.flush();
    assert.deepEqual(h.calls.at(-1).data.events,[
      {type:"wheel",delta:0,deltaX:1},
      {type:"wheel",delta:-1,deltaX:-2},
      {type:"wheel",delta:1,deltaX:1},
      {type:"wheel",delta:-1,deltaX:-1},
      {type:"wheel",delta:10,deltaX:10},
    ]);
  }
});

test("pausing clears fractional scrolling and ignores gestures while paused",async()=>{
  const h=harness();await h.pair();await h.elements.capture.emit("click");
  await h.doc.emit("wheel",{deltaX:40,deltaY:40,deltaMode:0});
  await h.elements.capture.emit("click");await h.flush();
  const count=h.calls.length;
  await h.doc.emit("wheel",{deltaX:800,deltaY:800,deltaMode:0});await h.flush();
  assert.equal(h.calls.length,count);
  await h.elements.capture.emit("click");
  await h.doc.emit("wheel",{deltaX:40,deltaY:40,deltaMode:0});await h.flush();
  assert.equal(h.calls.length,count);
  await h.doc.emit("wheel",{deltaX:40,deltaY:40,deltaMode:0});await h.flush();
  assert.deepEqual(h.calls.at(-1).data.events,[{type:"wheel",delta:-1,deltaX:1}]);
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
  for(const action of ["cancel","escape","disconnect","hidden","timeout"]){
    const h=harness({pointerLock:"pending"});await h.pair();await h.elements.capture.emit("click");
    assert.equal(h.elements.capture.textContent,"Cancel control");
    await h.doc.emit("mousemove",{movementX:10,movementY:5});await h.doc.emit("mousedown",{button:0});await h.doc.emit("keydown",{code:"KeyA"});
    if(action==="cancel")await h.elements.capture.emit("click");
    if(action==="escape")await h.doc.emit("keydown",{code:"Escape"});
    if(action==="disconnect")await h.elements.disconnect.emit("click");
    if(action==="hidden"){h.doc.hidden=true;await h.doc.emit("visibilitychange");}
    if(action==="timeout")h.advance(10000);
    await h.completeLock();await h.flush();
    assert.equal(h.doc.pointerLockElement,null);assert.equal(h.elements.capture.textContent,"Start control");
    assert.equal(h.calls.some(call=>call.data.events?.some(event=>event.type!=="release")),false);
  }
});
