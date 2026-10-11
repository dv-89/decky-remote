import React from "react";
import { createRoot } from "react-dom/client";
import FileBrowser from "../src/FileBrowser";
createRoot(document.getElementById("root")!).render(<React.StrictMode><FileBrowser /></React.StrictMode>);
