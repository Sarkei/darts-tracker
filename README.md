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

## Zugriff, Rollen und Teilen

- **Ein Match gehört seinen Spielern.** Lesen, Werfen, Korrigieren, Geräte und Vorschläge sind nur
  für Ersteller und beteiligte Spieler möglich (`server/access.ts`, 403 für alle anderen). Die Liste
  zeigt nur eigene Matches.
- **Zuschauer ohne Konto:** jedes Match hat einen sechsstelligen **Zuschauer-Code**
  (`/#/watch/CODE`), der nur den Spielstand liefert — kein Login, keine Schreibrechte.
- **Fernbedienung:** `/#/match/:id/remote` ist ein schlankes Zahlenfeld für ein zweites Gerät.
- **Rollen:** Beim ersten Betreten fragt die App „Kamera / Dashboard / Zuschauer"; gewechselt wird
  jederzeit, es gibt pro Match genau eine Kamera.
- **Konto:** Passwort vergessen → Link (eine Stunde gültig, einmalig, entwertet alte Sitzungen).
  Ohne SMTP zeigt die App den Link direkt an (`ALLOW_DEV_RESET_LINK=1`).
- **Registrierung schließen:** `INVITE_CODE` in der `.env` setzen — dann ist die Anmeldung nur mit
  Code möglich. Login/Registrierung/Reset sind zusätzlich rate-limitiert.

## Als App aufs Handy

Manifest, Icons und Service Worker liegen unter `public/`. Im Browser „Zum Startbildschirm
hinzufügen" → eigenes Fenster ohne Adressleiste. Die App-Hülle kommt aus dem Cache, Spielstände
immer live aus dem Netz; beim Kamera-Betrieb bleibt der Bildschirm über die Wake-Lock-API an.


## Spielformate

- **Legs:** „First to X" — wer zuerst X Legs hat, gewinnt (`bestOf`).
- **Sätze:** Legs pro Satz (`bestOf`) plus Best of Sätze (`bestOfSets`). Ein Satzgewinn setzt die
  Legs aller Spieler zurück; das Match endet beim erreichten Satzziel.
- **Anwurf:** „Sieger wirft an" (Standard) oder „abwechselnd"; die Startposition im ersten Leg ist
  wählbar. In der Kopfzeile steht bei Sätzen `x S / y L`.
- **Bogey-Zahlen** (159, 162, 163, 165, 166, 168, 169) zeigen einen Hinweis, auf welchen Rest man
  stattdessen spielen sollte.

## Training

Vier Übungen unter „Training", Ergebnisse landen in `training_sessions` und fließen in die Statistik:

- **Doppel-Training** — D1…D20, drei Darts je Doppel, zählt Treffer.
- **Bob's 27** — Start 27, Treffer addieren den Doppelwert, drei Fehlwürfe ziehen ihn ab, unter 0 ist Schluss.
- **Around the Clock** — 1…20 und Bull der Reihe nach, zählt die Darts.
- **Checkout-Training** — zufällige Restscores 41–170, festhalten wie viele Darts nötig waren.

## Statistik

- **3-Dart-Average** aus Punkten **pro Dart** × 3 (Züge können vorzeitig enden).
- **Doppel-Quote**: Anteil der Darts, die bei Rest ≤ 50 (also auf ein Doppel) geworfen wurden und trafen.
- **Checkout-Quote**: erfolgreiche Checkouts geteilt durch Züge, die mit Rest ≤ 170 begannen.
- **Verlauf** pro Kalenderwoche, **H2H**-Bilanz gegen jeden Gegner, Elo-Rangliste.


## Turnier

K.-o.-Baum für 2 bis 8 Spieler. Freie Plätze werden aufgefüllt und ziehen automatisch weiter; jedes
Paar bekommt ein eigenes Match (501, Double-Out, First to 2 Legs), das im Turnier verlinkt ist.
Sobald ein Match endet, rückt der Sieger in die nächste Runde, das Finale entsteht von selbst.

## Kamera im Alltag

- Nachkalibrierung: alle ~6 s wird geprüft, ob das Board noch an derselben Stelle ist; Punkte werden
  still nachgezogen, im Status erscheint „Kamera leicht verschoben".
- **Probelauf**: zählt erkannte Würfe, ohne sie zu buchen — zum Prüfen vor dem Spiel.
- **Offline-Puffer**: Würfe, die den Server nicht erreichen, landen lokal und gehen alle 15 s bzw.
  beim Wiederverbinden raus.
- Ton bei jedem erkannten Wurf, Anzeige der Bilder pro Sekunde.


## Aufräumen

- **Match löschen:** in der Historie das Papierkorb-Symbol — Match, Würfe, Legs und Geräte
  verschwinden, die Statistik rechnet sie nicht mehr mit. Nur Ersteller und Teilnehmer dürfen das.
- **Spieler entfernen:** Gäste werden archiviert und verschwinden aus Auswahl, Statistik-Auswahl und
  Rangliste; in alten Matches bleiben ihre Namen erhalten. Das eigene Profil hängt am Konto und
  lässt sich nur umbenennen (Einstellungen).

## Dashboard vs. Fernbedienung

Das Dashboard ist eine **Anzeigetafel**: alle Spieler groß mit Restscore, Legs/Sätzen, der aktive
Spieler hervorgehoben, darunter Checkout-Weg, Bogey-Hinweis und die letzte Runde. Die Eingabe liegt
hinter „Würfe eingeben" und ist standardmäßig geschlossen; Geräte-, Teilen- und Zuschauer-Optionen
stehen unten. Die Fernbedienung (`/match/:id/remote`) bleibt ein reines Zahlenfeld.

