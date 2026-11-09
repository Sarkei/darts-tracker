import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import type { Player, User } from './types';

interface AuthState {
  user: User | null;
  player: Player | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!getToken()) {
      setUser(null);
      setPlayer(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: User; player: Player | null }>('/auth/me');
      setUser(data.user);
      setPlayer(data.player);
    } catch {
      setToken(null);
      setUser(null);
      setPlayer(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      player,
      loading,
      refresh,
      async login(email, password) {
        const data = await api<{ token: string; user: User }>('/auth/login', { body: { email, password } });
        setToken(data.token);
        await refresh();
      },
      async register(email, password, displayName) {
        const data = await api<{ token: string; user: User }>('/auth/register', { body: { email, password, displayName } });
        setToken(data.token);
        await refresh();
      },
      logout() {
        setToken(null);
        setUser(null);
        setPlayer(null);
      },
    }),
    [user, player, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden');
  return ctx;
}
