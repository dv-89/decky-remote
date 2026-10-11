import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import * as jsx from "react/jsx-runtime";

test("compiled plugin connects as Legion Remote and exposes its Decky panel",async()=>{
  globalThis.window={__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit:{connect:(version,name)=>{
    assert.equal(version,2);assert.equal(name,"Legion Remote");
    return {_version:2,callable:method=>async()=>({method})};
  }}};
  globalThis.SP_REACT=React;globalThis.SP_JSX=jsx;
  globalThis.DFL={ButtonItem:"button",PanelSection:"section",PanelSectionRow:"div",staticClasses:{Title:"title"}};
  const {default:define}=await import("../dist/index.js");
  const plugin=define();
  assert.equal(plugin.name,"Legion Remote");
  assert.equal(plugin.titleView.props.children,"Legion Remote");
  assert.equal(typeof plugin.content.type,"function");
  plugin.onDismount();
});
