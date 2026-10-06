// Shell:B's HTTPS address (optional): e.g. `tailscale serve --https=8443 http://127.0.0.1:8200`
// Set VITE_SECURE_URL in .env.local if microphone/clipboard access requires a specific external HTTPS address.
export const SECURE_URL: string = (import.meta.env.VITE_SECURE_URL as string) || '';

/** The same page on the HTTPS address, or null when this page is already secure or SECURE_URL is unset. */
export const secureHere = (): string | null => {
  if (window.isSecureContext || !SECURE_URL) return null;
  return `${SECURE_URL.replace(/\/+$/, '')}/${location.search}${location.hash}`;
};
