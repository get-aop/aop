import { createRoot } from "react-dom/client";
import { App } from "./App";
import { electronBackend } from "./backend/electron-backend";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("AOP desktop root element is missing.");
}

createRoot(root).render(<App backend={electronBackend()} />);
