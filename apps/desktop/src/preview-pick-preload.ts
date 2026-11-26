import { ipcRenderer, webFrame } from "electron";

import {
  PASSKEY_BRIDGE_ARGUMENT,
  PRIMARY_PASTE_DISABLED_ARGUMENT,
} from "./preview/GuestProtocol.ts";
import { installIsolatedPasskeyBridge } from "./preview/PasskeyBridge.ts";
import "./preview/PickPreload.ts";

// Electron hands webPreferences.additionalArguments to sandboxed preloads in process.argv.
// Under contextIsolation: true, ipcRenderer never enters the untrusted page's main world:
// passkey ceremonies cross worlds exclusively over a nonce-verified MessageChannel.
if (process.argv.includes(PASSKEY_BRIDGE_ARGUMENT)) {
  installIsolatedPasskeyBridge({
    executeInMainWorld: (script) => webFrame.executeJavaScript(script),
    invoke: (channel, publicKey) => ipcRenderer.invoke(channel, publicKey),
  });
}

if (process.argv.includes(PRIMARY_PASTE_DISABLED_ARGUMENT)) {
  // Same guard as the app preload: Blink pastes PRIMARY on an uncancelled middle mouseup.
  window.addEventListener(
    "mouseup",
    (event) => {
      if (event.button === 1) event.preventDefault();
    },
    true,
  );
}
