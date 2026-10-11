// Adapted from Steam Deck Homebrew's BSD-3-Clause @decky/rollup preset.
// Keep Decky's globals and manifest injection, without its glob/delete dependency.
import { readFileSync } from "node:fs";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import externalGlobals from "rollup-plugin-external-globals";

const manifest = JSON.parse(readFileSync(new URL("./plugin.json", import.meta.url), "utf8"));
export default {
  input: "src/index.tsx",
  context: "window",
  external: ["react", "react-dom", "@decky/ui"],
  plugins: [
    typescript({ noEmit: false, include: ["src/**/*"] }),
    commonjs(),
    nodeResolve({ browser: true }),
    externalGlobals({ react: "SP_REACT", "react/jsx-runtime": "SP_JSX", "react-dom": "SP_REACTDOM", "@decky/ui": "DFL", "@decky/manifest": JSON.stringify(manifest) }),
    replace({ preventAssignment: true, "process.env.NODE_ENV": JSON.stringify("production") }),
  ],
  treeshake: { preset: "smallest" },
  output: { file: "dist/index.js", format: "esm", sourcemap: true, exports: "default" },
};
