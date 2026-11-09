# Darts Tracker

Selbst gehostete Darts-App: Match-Tracking, Checkout-Vorschläge, Wurfhistorie, Statistik und
Rangliste. Läuft als Docker-Stack (Postgres + Node) auf der NAS, die Oberfläche ist eine
React-PWA und funktioniert auf Handy wie Desktop.

## Was drin ist

- **Konten & Profile**: Registrierung, Login (JWT), Anzeigename/Avatar, Passwort ändern.
  Jedes Konto bekommt automatisch ein Spielerprofil; zusätzlich lassen sich Gastspieler anlegen.
- **Match anlegen**: 2–8 Spieler, Start **301 / 401 / 501 / frei wählbar**, **Double-In**
  und/oder **Double-Out**, Best-of-Legs, Tracking-Modus manuell oder automatisch.
- **Live-Scoring**: Nur der aktive Spieler steht groß im Fokus, Restpunkte werden nach jedem
  Wurf gerechnet. Eingabe über **Single / Doppel / Triple** plus Zahlenfeld 1–20, separat
  **25 (Bull)** und **50 (Bullseye)**.
- **Regeln**: Bust (unter 0, Rest 1 bei Double-Out, Checkout ohne Doppel), Double-In öffnet erst
  mit einem Doppel, Leg-/Match-Ende, **Undo**, **Zug vorzeitig beenden**.
- **Checkout-Vorschläge**: ab 170 rückwärts, regelkonform, mit Alternativen.
- **Historie**: alle Matches, jeder Zug mit seinen Darts (`T20 S5 D16`).
- **Statistik**: Treffer-Heatmap auf der Scheibe, häufigste Felder, Average, First-9-Average,
  Doppelquote, Checkoutquote, 180er/140er/100er, Busts — filterbar nach Spieler und Zeitraum.
- **Rangliste**: Elo (Start 1000, K = 32) aus allen beendeten Matches, plus Siege, Average,
  Doppelquote.
- **KI (DeepSeek)**: Spielanalyse nach dem Match, Trainingsplan aus den eigenen Daten.

## Architektur

Der Server ist die einzige Wahrheit: alle Würfe liegen als Ereignisse in der Datenbank, der
Matchzustand wird bei jeder Anfrage aus ihnen neu berechnet (`server/scoring.ts` →
`replayMatch`). Dadurch sind Korrekturen und Undo exakt, und Kamera, Tastatur oder Fernbedienung
können später dieselben Ereignisse schreiben.

```
server/    index, auth, players, matches, scoring (Engine + Checkout), stats, ai, events (SSE)
src/       React-Seite: pages/ (Auth, Home, NewMatch, Match, History, Stats, Ranking, Players, Settings)
scripts/   checkout-selftest.ts (prüft 2–170 auf Gültigkeit)
```

## Entwicklung

```bash
npm install
cp .env.example .env      # POSTGRES_PASSWORD, JWT_SECRET, DEEPSEEK_API_KEY
npm run dev               # Server auf :3000
npm run build && npm run build:server
npm run test:checkout
```

## Betrieb

```bash
cp .env.example .env
docker compose up -d --build
curl -fsS http://127.0.0.1:22227/api/health
```

Port `22227` nach außen (lokal), öffentlich über den Cloudflare-Tunnel als
`https://darts.nas-timgreen.com`. Das Netz `cloudflare-tunnel-net` muss existieren.

## Nächste Stufe

Kamera-Tracking (Handy als Sensor mit Board-Erkennung und Qualitätsanzeige), Live-Dashboard auf
einem zweiten Gerät, Rollenwechsel mitten im Spiel, Remote-Keypad, Trainingsmodi (Bob's 27,
Around the Clock) und Turnierbaum.
