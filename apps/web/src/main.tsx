import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./recovery.css";
import "./responsive-workspace.css";
import "./responsive-workspace-polish.css";

if (import.meta.env.DEV) {
  void import("./dev/phase0AuditBridge").then(({ installPhase0AuditBridge }) =>
    installPhase0AuditBridge(),
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Elemento #root não encontrado.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
