import "@prismux/appearance/styles.css";
import "@prismux/wallpaper/styles.css";

import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { I18nProvider } from "./i18n/I18nProvider";
import { PrismuxRuntimeProvider } from "./prismux/PrismuxRuntimeProvider";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

// Keep webviews outside the router but inside its atom registry so route changes preserve them.
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <I18nProvider>
      <AppAtomRegistryProvider>
        <PrismuxRuntimeProvider router={router}>
          <RouterProvider router={router} />
          <ElectronBrowserHost />
          <QuitHoldOverlay />
        </PrismuxRuntimeProvider>
      </AppAtomRegistryProvider>
    </I18nProvider>
  );
}
