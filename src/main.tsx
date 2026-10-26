import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./hooks/useTheme";
import { ToastProvider } from "./hooks/useToast";
import { ConfirmProvider } from "./hooks/useConfirm";
import { ensureDefaultDocTypes } from "./db/docTypes";
import "./styles/global.css";

/** GitHub Pages serves under /customer2/ — the router base follows Vite's base. */
const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, "");

// Seed the built-in document slots once (idempotent, guarded by a prefs flag).
void ensureDefaultDocTypes();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
