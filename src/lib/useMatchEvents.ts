import { useEffect } from 'react';
import { getToken } from './api';

/** Hört auf Server-Sent-Events eines Matches und ruft `onChange` bei jeder Änderung. */
export function useMatchEvents(matchId: number | null, onChange: () => void) {
  useEffect(() => {
    if (!matchId) return;
    const token = getToken();
    if (!token) return;
    const source = new EventSource(`/api/events?matchId=${matchId}&token=${encodeURIComponent(token)}`);
    const handler = () => onChange();
    for (const type of ['dart', 'visit', 'match', 'candidate', 'role', 'camera']) source.addEventListener(type, handler);
    source.onerror = () => {
      // EventSource verbindet sich selbst neu; nichts zu tun.
    };
    return () => source.close();
  }, [matchId, onChange]);
}
