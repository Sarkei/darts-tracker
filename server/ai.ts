import { Router } from 'express';
import { z } from 'zod';
import { logAiRun, query } from './db.js';
import type { AuthRequest } from './auth.js';
import { loadMatchState, dartLabel } from './scoring.js';
import { computeRanking } from './stats.js';

export const aiRouter = Router();

const DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

export function aiEnabled() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

async function complete(prompt: string, system: string, maxTokens = 1200, json = true): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY fehlt');
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Leere Antwort von DeepSeek');
  return content;
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('Antwort war kein JSON');
  }
}

// Bewusst tolerant: das Modell liefert manchmal mehr Einträge als gewünscht — wir kürzen selbst.
const summarySchema = z.object({
  headline: z.string().max(200).catch('Match-Analyse'),
  summary: z.string().max(2000).catch(''),
  highlights: z.array(z.string().max(400)).default([]).catch([]),
  tips: z.array(z.string().max(400)).default([]).catch([]),
});

const trainingSchema = z.object({
  focus: z.array(z.string().max(120)).min(1),
  plan: z
    .array(
      z.object({
        title: z.string().max(120),
        minutes: z.number().min(1).max(120),
        description: z.string().max(600),
      }),
    )
    .min(1),
  encouragement: z.string().max(600).catch(''),
});

aiRouter.get('/status', (_req, res) => {
  res.json({ enabled: aiEnabled(), provider: 'deepseek', model: DEEPSEEK_MODEL });
});

aiRouter.post('/match-summary', async (req: AuthRequest, res) => {
  const body = z.object({ matchId: z.number().int().positive() }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const state = await loadMatchState(body.data.matchId);
  if (!state) {
    res.status(404).json({ error: 'not-found' });
    return;
  }
  const started = Date.now();
  const players = state.players
    .map((p) => {
      const own = state.visits.filter((v) => v.matchPlayerId === p.matchPlayerId);
      const points = own.reduce((sum, v) => sum + (v.bust ? 0 : v.score), 0);
      const darts = own.reduce((sum, v) => sum + v.darts.length, 0);
      const checkouts = own.filter((v) => v.checkout).length;
      const busts = own.filter((v) => v.bust).length;
      return `- ${p.name}: ${p.legsWon} Legs gewonnen, Average ${own.length ? ((points / own.length) * 3).toFixed(1) : '0'}, ${darts} Darts, ${checkouts} Checkouts, ${busts} Busts`;
    })
    .join('\n');
  const recent = state.visits
    .slice(-12)
    .map((v) => {
      const mp = state.players.find((p) => p.matchPlayerId === v.matchPlayerId);
      const darts = v.darts.map((d) => dartLabel(d.ring, d.number)).join(' ');
      return `${mp?.name}: ${darts} = ${v.score}${v.bust ? ' (Bust)' : ''}${v.checkout ? ' (Checkout!)' : ''}`;
    })
    .join('\n');

  const prompt = `Analysiere dieses Darts-Match und antworte auf Deutsch.
Start: ${state.match.startScore}, Double-In: ${state.match.doubleIn ? 'ja' : 'nein'}, Double-Out: ${state.match.doubleOut ? 'ja' : 'nein'}, Best of ${state.match.bestOf}.
Status: ${state.finished ? 'beendet' : 'läuft'}.

Spieler:
${players}

Letzte Würfe:
${recent}

Antworte NUR mit JSON: {"headline":"...","summary":"3-5 Sätze","highlights":["..."],"tips":["..."]}
Die Tipps müssen konkret sein (z. B. Doppel-Training, Checkout-Wege, Streuung).`;

  try {
    const raw = await complete(prompt, 'Du bist ein erfahrener Dartstrainer. Antworte ausschließlich mit JSON.', 900);
    const rawParsed = summarySchema.parse(parseJson(raw));
    const parsed = {
      ...rawParsed,
      highlights: rawParsed.highlights.slice(0, 4),
      tips: rawParsed.tips.slice(0, 4),
    };
    await logAiRun(req.userId!, 'match-summary', true, Date.now() - started);
    res.json(parsed);
  } catch (e) {
    await logAiRun(req.userId!, 'match-summary', false, Date.now() - started, e instanceof Error ? e.message : String(e));
    res.status(502).json({ error: 'ai-failed', message: e instanceof Error ? e.message : 'Unbekannter Fehler' });
  }
});

aiRouter.post('/training-plan', async (req: AuthRequest, res) => {
  const body = z.object({ playerId: z.number().int().positive().optional() }).safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const own = await query<{ id: number; name: string }>('select id, name from players where owner_id = $1', [req.userId]);
  const playerId = body.data?.playerId ?? own.rows[0]?.id;
  if (!playerId) {
    res.status(400).json({ error: 'no-player' });
    return;
  }

  const statsRows = await query<{ field: string; hits: string }>(
    `select (case when d.ring in ('bull','bullseye') then d.ring when d.ring = 'triple' then 'T' || d.number
              when d.ring = 'double' then 'D' || d.number else 'S' || d.number end) as field,
            count(*)::text as hits
       from darts d join matches m on m.id = d.match_id
      where d.match_player_id in (select id from match_players where player_id = $1)
      group by 1 order by 2 desc limit 15`,
    [playerId],
  );
  const totals = await query<{ darts: string; visits: string; points: string; checkouts: string; busts: string }>(
    `select count(*)::text as darts,
            (select count(*)::text from visits v join match_players mp on mp.id = v.match_player_id where mp.player_id = $1) as visits,
            (select coalesce(sum(case when v.bust then 0 else v.score end),0)::text from visits v join match_players mp on mp.id = v.match_player_id where mp.player_id = $1) as points,
            (select count(*)::text from visits v join match_players mp on mp.id = v.match_player_id where mp.player_id = $1 and v.checkout) as checkouts,
            (select count(*)::text from visits v join match_players mp on mp.id = v.match_player_id where mp.player_id = $1 and v.bust) as busts
       from darts d join match_players mp on mp.id = d.match_player_id where mp.player_id = $1`,
    [playerId],
  );
  const ranking = await computeRanking();
  const place = ranking.findIndex((r) => r.playerId === playerId) + 1;

  const t = totals.rows[0];
  const darts = Number(t?.darts ?? 0);
  const visits = Number(t?.visits ?? 0);
  const points = Number(t?.points ?? 0);
  const avg = visits ? ((points / visits) * 3).toFixed(1) : '0';
  const fields = statsRows.rows.map((r) => `${r.field}: ${r.hits}`).join(', ') || 'noch keine Würfe';

  const prompt = `Erstelle einen Trainingsplan für einen Darts-Spieler. Antworte auf Deutsch, NUR mit JSON.
Daten: ${darts} Darts, ${visits} Züge, 3-Dart-Average ${avg}, Checkouts ${t?.checkouts ?? 0}, Busts ${t?.busts ?? 0}, Rang ${place || 'unbekannt'}.
Häufigste Trefferfelder: ${fields}.

JSON-Schema: {"focus":["..."],"plan":[{"title":"...","minutes":10,"description":"..."}],"encouragement":"..."}
Der Plan soll 3-4 Übungen enthalten, die zu den Daten passen (z. B. Doppel-Training bei vielen Busts, Streuung bei unausgewogenen Feldern).`;

  const started = Date.now();
  try {
    const raw = await complete(prompt, 'Du bist ein Dartstrainer. Antworte ausschließlich mit JSON.', 900);
    const rawPlan = trainingSchema.parse(parseJson(raw));
    const parsed = { ...rawPlan, focus: rawPlan.focus.slice(0, 4), plan: rawPlan.plan.slice(0, 5) };
    await logAiRun(req.userId!, 'training-plan', true, Date.now() - started);
    res.json(parsed);
  } catch (e) {
    await logAiRun(req.userId!, 'training-plan', false, Date.now() - started, e instanceof Error ? e.message : String(e));
    res.status(502).json({ error: 'ai-failed', message: e instanceof Error ? e.message : 'Unbekannter Fehler' });
  }
});
