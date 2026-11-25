/**
 * Prismux uses local-first LAN / Tailscale QR pairing instead of cloud T3 Connect onboarding.
 * Kept as a no-op export so upstream root route wiring remains untouched.
 */
export function ConnectOnboardingDialog() {
  return null;
}
