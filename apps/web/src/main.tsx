import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (sw) sw.addEventListener("statechange", () => { if (sw.state === "installed" && navigator.serviceWorker.controller) void reg.update(); });
      });
    });
  });
}
