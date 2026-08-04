import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RuntimeConfigurationProvider } from "./hooks/runtime-configuration";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <RuntimeConfigurationProvider>
      <App />
    </RuntimeConfigurationProvider>
  </StrictMode>,
);
