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
- **Kamera-Tracking**: Handy als Sensor, Board-Erkennung mit Qualitätsampel, Live-Dashboard auf
  einem zweiten Gerät (siehe unten).

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

## Kamera-Tracking (automatisch)

Ein Gerät filmt das Board, ein zweites zeigt Tabelle und Eingriffe — beides im Browser, Rollen
jederzeit umschaltbar.

1. Match öffnen, **„Kamera auf diesem Gerät"** → Kamera freigeben.
2. Die App sucht die Scheibe selbst und legt vier Punkte auf die **Außenkante des Doppelrings**
   bei 20 (oben), 6 (rechts), 3 (unten), 11 (links). Punkte ziehen, dann „Kalibrierung übernehmen" —
   sie wird für dieses Gerät gespeichert und beim nächsten Öffnen wiederhergestellt.
3. Die Ampel zeigt, ob die Position taugt: Abstand (Board groß genug), Schärfe und ob das Board
   vollständig im Bild ist, jeweils mit Hinweis („näher heran", „Bild unscharf", „nicht vollständig").
4. Danach wird **alle ~0,4 s** verglichen, ob sich am Board etwas geändert hat. Ein neuer Dart wird
   erkannt, über die Homographie ins Board-Koordinatensystem gerechnet und als Feld/Ring verbucht.
   Abgezogene Darts werden erkannt und nicht gewertet.
5. Sichere Treffer (≥ 60 %) bucht die App direkt, wenn „sichere Würfe automatisch buchen" an ist;
   alles andere erscheint auf dem Dashboard als **Vorschlag** mit Übernehmen/Verwerfen.

Technik: Hough-Voting für den Mittelpunkt, Radialprofil für die Doppel-Außenkante, 4-Punkt-
Homographie für die Perspektive, Blob-Erkennung auf dem Differenzbild (polaritätsunabhängig, weil
ein Dart das Bild verdunkelt und ein Schaft aufhellt). Die Prüfung läuft gegen synthetische Bilder:
`npm run test:vision` (Kreis, T20, Single-Band, perspektivische Verzerrung).

## Nächste Stufe

Remote-Keypad, Trainingsmodi (Bob's 27, Around the Clock), Turnierbaum, Kamera-Feintuning mit
eigenem Videomaterial.
