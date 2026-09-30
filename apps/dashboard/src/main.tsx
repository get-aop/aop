import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootstrapDesktopHost } from "./api/desktop-host";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

// The desktop app names the host before anything asks it a question; a browser has no bridge and starts at once.
void bootstrapDesktopHost().then(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
