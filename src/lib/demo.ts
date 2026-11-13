/**
 * Demo-Modus: greift auf einer `demo-*`-Domain oder mit `?demo=1`.
 * Im Demo-Modus wird automatisch das Demo-Konto angemeldet und die
 * Registrierung ausgeblendet, damit keine echten Konten entstehen.
 */
export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  if (host.startsWith('demo-') || host.startsWith('demo.')) return true;
  return new URLSearchParams(window.location.search).get('demo') === '1';
}
