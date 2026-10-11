import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function harness() {
  class Element {
    constructor(id) { this.id=id; this.handlers={}; this.value=""; this.hidden=false; this.dataset={}; this.classes=new Set(); this.classList={toggle:(name,on)=>on ? this.classes.add(name) : this.classes.delete(name)}; }
    addEventListener(kind, callback) { (this.handlers[kind] ??= []).push(callback); }
    async emit(kind, data={}) { for (const callback of this.handlers[kind] ?? []) await callback({preventDefault(){},...data}); }
    focus() {} setPointerCapture() {} requestPointerLock() { return Promise.resolve(); }
  }
  const ids=["pad","status","capture","captureHint","controller","pairPanel","pin","pairButton","pairForm","mouseLock","showDesktop","text","sendText","disconnect"];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  const left=new Element("left"); left.dataset.click="left";
  const enter=new Element("enter"); enter.dataset.key="Enter";
  const doc=new Element("document");
  doc.getElementById=id=>elements[id];
  doc.querySelectorAll=selector=>selector==="[data-click]" ? [left] : [enter];
  doc.exitPointerLock=()=>{}; doc.pointerLockElement=null; doc.hidden=false;
  const window=new Element("window");
  const intervals=[], calls=[];
  let reject=false;
  const context=vm.createContext({document:doc,window,AbortController,console,setTimeout,clearTimeout, setInterval:fn=>intervals.push(fn),fetch:async(path,opts)=>{
    calls.push({path,data:JSON.parse(opts.body),headers:opts.headers});
    return {ok:!reject,status:reject?401:200,json:async()=>reject?{error:"Session ended"}:path==="/api/pair"?{token:"test-token"}:{ok:true}};
  }});
  vm.runInContext(readFileSync(new URL("../web/client.js",import.meta.url),"utf8"),context);
  return {elements,left,enter,doc,window,intervals,calls, reject:()=>{reject=true;},
    async pair(){elements.pin.value="00123456";await elements.pairForm.emit("submit");},
    async flush(){await intervals[0]();await new Promise(resolve=>setTimeout(resolve,0));}};
}

test("browser pairs without storing credentials and sends keys, mouse, wheel and buttons", async()=>{
  const h=harness(); await h.pair();
  assert.equal(h.elements.controller.hidden,false);
  assert.equal(h.elements.pin.value,"");
  await h.elements.capture.emit("click");
  await h.elements.pad.emit("keydown",{code:"KeyW",repeat:false});
  await h.elements.pad.emit("keyup",{code:"KeyW"});
  await h.elements.pad.emit("pointerdown",{button:0,pointerId:1,clientX:10,clientY:10});
  await h.elements.pad.emit("pointermove",{pointerId:1,clientX:20,clientY:15});
  await h.elements.pad.emit("pointerup",{pointerId:1});
  await h.elements.pad.emit("wheel",{deltaY:80,deltaMode:0});
  await h.left.emit("click"); await h.enter.emit("click"); await h.flush();
  const request=h.calls.find(item=>item.path==="/api/events");
  assert.equal(request.headers.Authorization,"Bearer test-token");
  assert.deepEqual(request.data.events,[{type:"key",code:"KeyW",value:1},{type:"key",code:"KeyW",value:0},{type:"move",dx:10,dy:5},{type:"wheel",delta:-1},{type:"button",button:"left",value:1},{type:"button",button:"left",value:0},{type:"key",code:"Enter",value:1},{type:"key",code:"Enter",value:0}]);
});

test("Escape and loss of window focus discard pending presses and release input",async()=>{
  for (const action of ["escape","blur","hidden"]) {
    const h=harness(); await h.pair();await h.elements.capture.emit("click");
    await h.elements.pad.emit("keydown",{code:"KeyA",repeat:false});
    if(action==="escape")await h.elements.pad.emit("keydown",{code:"Escape"});
    if(action==="blur")await h.window.emit("blur");
    if(action==="hidden"){h.doc.hidden=true;await h.doc.emit("visibilitychange");}
    await h.flush();
    assert.deepEqual(h.calls.filter(item=>item.path==="/api/events").at(-1).data.events,[{type:"release"}]);
    assert.equal(h.elements.capture.textContent,"Start control");
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
  h.reject();await h.elements.pad.emit("keydown",{code:"KeyA",repeat:false});await h.flush();
  assert.equal(h.elements.controller.hidden,true);
  assert.equal(h.elements.pairPanel.hidden,false);
  assert.equal(h.elements.status.textContent,"Session ended");
  const count=h.calls.length;await h.elements.pad.emit("keydown",{code:"KeyB"});await h.flush();
  assert.equal(h.calls.length,count);
});

test("Pause preserves capture state until click and releases all pending input",async()=>{
  const h=harness();await h.pair();await h.elements.capture.emit("click");
  let prevented=false;
  await h.elements.capture.emit("pointerdown",{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  await h.elements.pad.emit("keydown",{code:"KeyW",repeat:false});
  await h.elements.capture.emit("click");await h.flush();
  assert.equal(h.elements.capture.textContent,"Start control");
  assert.deepEqual(h.calls.at(-1).data.events,[{type:"release"}]);
});
