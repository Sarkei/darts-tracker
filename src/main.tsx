import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthProvider } from './lib/auth';
import { getToken, setToken } from './lib/api';
import { isDemoMode } from './lib/demo';

/** Demo-Zugang: auf demo-*-Domains und mit ?demo=1 wird das Demo-Konto automatisch angemeldet. */
async function start() {
  if (isDemoMode() && !getToken()) {
    try {
      const r = await fetch('/api/auth/demo');
      if (r.ok) {
        const d = (await r.json()) as { token?: string };
        if (d?.token) {
          setToken(d.token);
          window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        }
      }
    } catch {
      /* ohne Demo weiter — dann erscheint die normale Anmeldung */
    }
  }

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>,
  );
}

void start();
