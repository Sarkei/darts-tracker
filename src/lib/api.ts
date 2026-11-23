const TOKEN_KEY = 'darts.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Zwischenspeicher für Leseanfragen: Tab-Wechsel kommen sofort aus dem Speicher.
 * Jede schreibende Anfrage verwirft ihn, damit nie veraltete Daten stehen bleiben.
 */
const cache = new Map<string, { ts: number; data: unknown }>();
const laufend = new Map<string, Promise<unknown>>();
/** Wie lange ein Eintrag als frisch gilt (ms). */
const CACHE_TTL = 60_000;

export function cacheLeeren(): void {
  cache.clear();
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = (options.method ?? (options.body ? 'POST' : 'GET')).toUpperCase();
  const istLesen = method === 'GET';

  if (istLesen) {
    const treffer = cache.get(path);
    if (treffer && Date.now() - treffer.ts < CACHE_TTL) return treffer.data as T;
    const offen = laufend.get(path);
    if (offen) return offen as Promise<T>;
  } else {
    cacheLeeren();
  }

  const anfrage = (async () => {
    const token = getToken();
    const res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const message =
        (data as { message?: string; error?: string } | null)?.message ??
        (data as { error?: string } | null)?.error ??
        `Fehler ${res.status}`;
      if (res.status === 401) setToken(null);
      throw new ApiError(res.status, message);
    }
    if (istLesen) cache.set(path, { ts: Date.now(), data });
    return data as T;
  })();

  if (istLesen) {
    laufend.set(path, anfrage);
    try {
      return (await anfrage) as T;
    } finally {
      laufend.delete(path);
    }
  }
  return (await anfrage) as T;
}

/** Lädt die Bereiche im Hintergrund vor, damit Tab-Wechsel ohne Wartezeit laufen. */
export async function prefetchBereiche(): Promise<void> {
  for (const pfad of ['/stats', '/matches', '/players', '/training']) {
    try {
      await api(pfad);
    } catch {
      /* einzeln ignorieren — ein kaputter Endpunkt darf die anderen nicht blockieren */
    }
  }
}
