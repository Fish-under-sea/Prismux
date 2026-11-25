import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import "./index.css";

import { startAppServices } from "./appInit";
import { AppRoot } from "./AppRoot";
import { whenLocaleReady } from "./i18n/runtime";
import { chunkLoadState } from "./lib/chunkReloadGuard";
import {
  dismissPrismuxBootSplash,
  installPrismuxBootSplashLifecycle,
} from "./prismux/PrismuxBootSplash";

const router = startAppServices();
const app = <AppRoot router={router} />;

export const startup = router
  .load()
  .then(whenLocaleReady)
  .then(() => {
    // Route chunk failures resolve router.load() and surface later through the error boundary.
    if (chunkLoadState.reloadScheduled) return;
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>{app}</React.StrictMode>,
    );
    installPrismuxBootSplashLifecycle();
  })
  .catch((error: unknown) => {
    void dismissPrismuxBootSplash({ immediate: true });
    if (chunkLoadState.reloadScheduled) return;
    throw error;
  });
