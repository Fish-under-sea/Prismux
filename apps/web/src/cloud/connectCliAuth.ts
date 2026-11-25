import type { ConnectAuthorizeRequest } from "@prismux/core-shared/connectAuth";

/** Hosted third-party cloud CLI OAuth routes are disabled in Prismux local-first builds. */
export function connectCliAuthRoutesEnabled(): boolean {
  return false;
}

export function connectCliSignInRedirectUrl(
  _request: ConnectAuthorizeRequest,
  currentHref: string,
): string {
  return currentHref;
}
