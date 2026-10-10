import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { git } from "./lib/git";
import { splashStep } from "./lib/splash";
import "./index.css";

// Anything blocked by the Content Security Policy (tauri.conf.json) is logged and kept,
// so a missing source shows up in the console and the end-to-end tests fail on it
declare global {
  interface Window {
    __cspViolations: string[];
  }
}
window.__cspViolations = [];
document.addEventListener("securitypolicyviolation", (e) => {
  const v = `${e.effectiveDirective} bloqueou ${e.blockedURI || "inline"}`;
  window.__cspViolations.push(v);
  console.error(`[CSP] ${v}`);
});

// Startup while the splash is on screen: check git, then mount the app.
// Each view calls splashDone() once its first data is loaded.
splashStep("Verificando o git", 0.2);
git.version().then(
  () => start(null),
  (e) => start(String(e)),
);

function start(gitError: string | null) {
  splashStep("Carregando a interface", 0.4);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App gitError={gitError} />
    </React.StrictMode>,
  );
}
