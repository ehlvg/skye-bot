import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Provider } from "./components/ui/provider";
import { Toaster } from "./components/ui/toaster";
import { App } from "./App.tsx";

window.Telegram.WebApp.ready();
window.Telegram.WebApp.expand();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider defaultTheme={window.Telegram.WebApp.colorScheme}>
      <App />
      <Toaster />
    </Provider>
  </StrictMode>
);
