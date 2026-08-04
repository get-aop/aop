import { createRoot } from "react-dom/client";
import { App } from "./App";
import { tauriBackend } from "./backend/tauri-backend";
import "@fontsource-variable/jura";
import "@fontsource-variable/instrument-sans";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("AOP desktop root element is missing.");
}

createRoot(root).render(<App backend={tauriBackend} />);
