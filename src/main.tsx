import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./hooks/useTheme";
import { ToastProvider } from "./hooks/useToast";
import { ConfirmProvider } from "./hooks/useConfirm";
import {
  ensureDefaultDocTypes,
  stripLegacyDocHints,
  purgeNationalIdDocTypes,
  scopeDocTypesToOwners,
} from "./db/docTypes";
import "./styles/global.css";

/** GitHub Pages serves under /customer2/ — the router base follows Vite's base. */
const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, "");

// Seed the built-in document slots once (idempotent, guarded by a prefs flag),
// strip the retired short-description (hint) field from existing rows, remove
// the bogus AI-created «کد ملی» slot, and re-scope older AI-created slots to
// the single profile their files belong to (per-profile slots).
// Chained: the purge must see the seeded «پشت تذکره» slot.
void (async () => {
  await ensureDefaultDocTypes();
  await stripLegacyDocHints();
  await purgeNationalIdDocTypes();
  await scopeDocTypesToOwners();
})();

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
