import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, Crosshair, RefreshCw, Square } from 'lucide-react';
import { api } from '../lib/api';
import { dartLabel, type Ring } from '../lib/types';
import { BOARD_MM, pointToField } from '../lib/vision/geometry';
import { applyMatrix, homographyFrom4, type Matrix3, type Point } from '../lib/vision/homography';
import { downscale, findBoardCircle, imageDataToGray, sharpness, changeBlobs, type GrayImage } from '../lib/vision/detect';
import { useWakeLock } from '../lib/useWakeLock';

interface Props {
  matchId: number;
  onNavigate: (to: string) => void;
}

type Quality = 'good' | 'ok' | 'bad';

/** Board-Koordinaten der vier Kalibrierpunkte (Doppel-Außenkante). */
const BOARD_TARGETS: Point[] = [
  { x: 0, y: -BOARD_MM.doubleOuter },
  { x: BOARD_MM.doubleOuter, y: 0 },
  { x: 0, y: BOARD_MM.doubleOuter },
  { x: -BOARD_MM.doubleOuter, y: 0 },
];
const TARGET_LABELS = ['20 oben', '6 rechts', '3 unten', '11 links'];

const MAX_POST_WIDTH = 480;

function deviceId() {
  let id = localStorage.getItem('darts.deviceId');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem('darts.deviceId', id);
  }
  return id;
}

export function CameraPage({ matchId, onNavigate }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const refGray = useRef<GrayImage | null>(null);
  /** Bereits erkannte Darts (normierte Bildkoordinaten) — unterscheidet „hängt noch" von „abgezogen". */
  const knownDarts = useRef<Array<{ x: number; y: number }>>([]);
  const matrix = useRef<Matrix3 | null>(null);
  const lastHitAt = useRef(0);
  const busy = useRef(false);
  const me = useRef(deviceId());
  useWakeLock(true);

  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[] | null>(null);
  const [calibrated, setCalibrated] = useState(false);
  const [quality, setQuality] = useState<Quality>('bad');
  const [message, setMessage] = useState('Kamera noch nicht bereit');
  const [lastHit, setLastHit] = useState<{ label: string; ring: Ring; number: number; confidence: number; at: number } | null>(null);
  const [detections, setDetections] = useState(0);
  const [autoDetect, setAutoDetect] = useState(() => localStorage.getItem('darts.autoDetect') === '1');
  const [probeMode, setProbeMode] = useState(false);
  const [probe, setProbe] = useState({ thrown: 0, detected: 0 });
  const [queued, setQueued] = useState(0);
  const [fps, setFps] = useState(0);
  const [drift, setDrift] = useState(false);
  const boardToImage = useRef<Matrix3 | null>(null);
  const [drawTick, setDrawTick] = useState(0);

  const beep = useCallback(() => {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
      window.setTimeout(() => void ctx.close(), 300);
    } catch {
      /* Ton ist optional */
    }
  }, []);

  const enqueue = useCallback((payload: Record<string, unknown>) => {
    try {
      const raw = localStorage.getItem('darts.queue');
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      list.push(payload);
      localStorage.setItem('darts.queue', JSON.stringify(list.slice(-50)));
      setQueued(list.length);
    } catch {
      /* Speicher voll — dann ist der Wurf verloren, aber nichts blockiert */
    }
  }, []);

  const flushQueue = useCallback(async () => {
    let list: Array<Record<string, unknown>> = [];
    try {
      const raw = localStorage.getItem('darts.queue');
      list = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
    } catch {
      list = [];
    }
    if (!list.length) return;
    const rest: Array<Record<string, unknown>> = [];
    for (const item of list) {
      try {
        await api(`/matches/${matchId}/candidates`, { body: { ...item, deviceId: me.current } });
      } catch {
        rest.push(item);
      }
    }
    localStorage.setItem('darts.queue', JSON.stringify(rest));
    setQueued(rest.length);
  }, [matchId]);

  const register = useCallback(async () => {
    try {
      await api(`/matches/${matchId}/devices`, {
        body: { deviceId: me.current, role: 'camera', name: navigator.userAgent.includes('Mobile') ? 'Handy' : 'Gerät' },
      });
    } catch {
      /* Rolle ist optional für die Erkennung */
    }
  }, [matchId]);

  // Kamera starten
  useEffect(() => {
    void register();
    let active = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStreaming(true);
        setMessage('Suche die Scheibe …');
      } catch (e) {
        setError(
          e instanceof Error
            ? `Kamera nicht verfügbar: ${e.message}. Auf dem Handy braucht die Seite HTTPS und die Kamerafreigabe.`
            : 'Kamera nicht verfügbar',
        );
      }
    })();
    return () => {
      active = false;
      const video = videoRef.current;
      const tracks = (video?.srcObject as MediaStream | null)?.getTracks?.() ?? [];
      tracks.forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [register]);

  const videoSize = () => {
    const video = videoRef.current;
    if (!video) return null;
    return { w: video.videoWidth, h: video.videoHeight };
  };

  /** Bild in Graustufen auf Arbeitsbreite holen. */
  const grabGray = useCallback((): GrayImage | null => {
    const video = videoRef.current;
    if (!workRef.current) {
      // Arbeits-Canvas entsteht im Speicher — es muss nicht im DOM hängen
      workRef.current = document.createElement('canvas');
    }
    const work = workRef.current;
    const size = videoSize();
    if (!video || !work || !size || !size.w) return null;
    const scale = Math.min(1, MAX_POST_WIDTH / size.w);
    work.width = Math.round(size.w * scale);
    work.height = Math.round(size.h * scale);
    const ctx = work.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, work.width, work.height);
    return downscale(imageDataToGray(ctx.getImageData(0, 0, work.width, work.height)), MAX_POST_WIDTH);
  }, []);

  const autoDetectBoard = useCallback(async () => {
    const gray = grabGray();
    const size = videoSize();
    if (!gray || !size) return;
    const hit = findBoardCircle(gray);
    if (!hit) {
      setMessage('Scheibe nicht automatisch erkannt — Punkte bitte von Hand setzen');
      return;
    }
    const scale = size.w / gray.width;
    const cx = hit.cx * scale;
    const cy = hit.cy * scale;
    const r = hit.r * scale;
    setPoints([
      { x: (cx + 0) / size.w, y: (cy - r) / size.h },
      { x: (cx + r) / size.w, y: (cy + 0) / size.h },
      { x: (cx + 0) / size.w, y: (cy + r) / size.h },
      { x: (cx - r) / size.w, y: (cy + 0) / size.h },
    ]);
    setMessage(`Scheibe erkannt (Sicherheit ${Math.round(hit.score * 100)} %) — Punkte prüfen und übernehmen`);
  }, [grabGray]);

  // automatisch erkennen, solange bis die Punkte sitzen (Video braucht manchmal Sekunden)
  useEffect(() => {
    if (!streaming || points) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (tries > 12 || !videoRef.current?.videoWidth) return;
      void autoDetectBoard();
    }, 1200);
    return () => window.clearInterval(timer);
  }, [streaming, points, autoDetectBoard]);

  // Qualitätsbewertung + Überlagerung
  const evaluate = useCallback(() => {
    const gray = grabGray();
    const size = videoSize();
    if (!gray || !size || !points) return;
    const sharp = sharpness(gray);
    const pts = points.map((p) => ({ x: p.x * size.w, y: p.y * size.h }));
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
    const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
    const radius = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / 4;
    const radiusRatio = radius / size.w;
    const inside = pts.every((p) => p.x > size.w * 0.02 && p.x < size.w * 0.98 && p.y > size.h * 0.02 && p.y < size.h * 0.98);

    let q: Quality = 'good';
    const notes: string[] = [];
    if (!inside) {
      q = 'bad';
      notes.push('Board nicht vollständig im Bild');
    }
    if (radiusRatio < 0.13) {
      q = 'bad';
      notes.push('näher an die Scheibe gehen');
    } else if (radiusRatio < 0.18) {
      if (q === 'good') q = 'ok';
      notes.push('etwas näher wäre besser');
    }
    if (sharp < 30) {
      q = 'bad';
      notes.push('Bild unscharf — Handy ruhig halten oder Fokus antippen');
    } else if (sharp < 80) {
      if (q === 'good') q = 'ok';
      notes.push('Bild leicht unscharf');
    }
    setQuality(q);
    setMessage(q === 'good' ? 'Alles gut — Würfe werden erkannt' : notes.join(' · '));
  }, [grabGray, points]);

  // Erkennungsschleife
  useEffect(() => {
    if (!calibrated || !matrix.current) return;
    let tick = 0;
    const timer = window.setInterval(async () => {
      if (busy.current) return;
      const started = performance.now();
      const gray = grabGray();
      if (!gray) return;

      // Alle ~6 s prüfen, ob die Kamera noch auf dasselbe Board zeigt
      tick += 1;
      if (tick % 15 === 0 && points && matrix.current) {
        const hit = findBoardCircle(gray);
        if (hit) {
          const size = videoSize();
          const scale = size ? size.w / gray.width : 1;
          const cx = hit.cx * scale;
          const cy = hit.cy * scale;
          const r = hit.r * scale;
          const px = points.map((p) => ({ x: p.x * (size?.w ?? 1), y: p.y * (size?.h ?? 1) }));
          const ocx = px.reduce((s, p) => s + p.x, 0) / 4;
          const ocy = px.reduce((s, p) => s + p.y, 0) / 4;
          const orad = px.reduce((s, p) => s + Math.hypot(p.x - ocx, p.y - ocy), 0) / 4;
          const shift = Math.hypot(cx - ocx, cy - ocy) / Math.max(1, orad);
          const scaleDiff = Math.abs(r - orad) / Math.max(1, orad);
          setDrift(shift > 0.08 || scaleDiff > 0.1);
          // Punkte still nachziehen: verschieben und skalieren, Drehung bleibt erhalten
          if ((shift > 0.08 || scaleDiff > 0.1) && size) {
            const sx = r / Math.max(1, orad);
            const shifted = px.map((p) => ({ x: (cx + (p.x - ocx) * sx) / size.w, y: (cy + (p.y - ocy) * sx) / size.h }));
            setPoints(shifted);
            matrix.current = homographyFrom4(shifted, BOARD_TARGETS);
            boardToImage.current = homographyFrom4(BOARD_TARGETS, shifted);
          }
        }
      }

      if (!refGray.current) {
        refGray.current = gray;
        return;
      }

      // Änderungen sind polaritätsunabhängig: ein Dart verdunkelt, ein Schaft hellt auf.
      const blobs = changeBlobs(refGray.current, gray, 20);
      if (!blobs.length) return;

      const biggest = blobs.sort((a, b) => b.area - a.area)[0];
      const nx = biggest.wx / gray.width;
      const ny = biggest.wy / gray.height;

      // Verschwindet ein bekannter Dart (abgezogen)? Dann nur Referenz nachziehen.
      const knownIndex = knownDarts.current.findIndex((d) => Math.hypot(d.x - nx, d.y - ny) < 0.045);
      if (knownIndex >= 0) {
        knownDarts.current.splice(knownIndex, 1);
        refGray.current = gray;
        return;
      }

      const size = videoSize();
      if (!size) return;
      const candidate = biggest;
      if (candidate.area < 8 || candidate.area > 900) {
        refGray.current = gray;
        return;
      }
      if (Date.now() - lastHitAt.current < 1400) return;

      // Dartspitze: stärkste Änderung, nicht Schaft oder Schatten
      const boardPoint = applyMatrix(matrix.current!, { x: candidate.wx / gray.width, y: candidate.wy / gray.height });
      const field = pointToField(boardPoint.x, boardPoint.y);
      if (!field) return;

      // Konfidenz: Fläche, Abstand zur Sektorgrenze, Schärfe
      const areaScore = Math.min(1, candidate.area / 60);
      const marginScore = Math.min(1, field.angleMargin / 3.5);
      const confidence = Math.max(0.2, Math.min(0.98, 0.45 * areaScore + 0.4 * marginScore + 0.15));

      lastHitAt.current = Date.now();
      busy.current = true;
      // Referenz sofort nachziehen, damit derselbe Wurf nicht doppelt zählt
      refGray.current = gray;
      knownDarts.current.push({ x: nx, y: ny });
      setLastHit({ label: dartLabel(field.ring, field.number), ring: field.ring, number: field.number, confidence, at: Date.now() });
      setDetections((n) => n + 1);
      if (probeMode) {
        setProbe((p) => ({ ...p, detected: p.detected + 1 }));
        beep();
        busy.current = false;
        setFps(Math.max(1, Math.round(1000 / Math.max(1, performance.now() - started))));
        return;
      }
      beep();
      try {
        await api(`/matches/${matchId}/candidates`, {
          body: {
            deviceId: me.current,
            ring: field.ring,
            number: field.number,
            confidence,
            auto: autoDetect,
          },
        });
        setError(null);
      } catch (e) {
        // Offline oder Server weg: Wurf puffern und später nachschicken
        enqueue({ ring: field.ring, number: field.number, confidence, auto: autoDetect });
        setError(e instanceof Error ? `gepuffert (${e.message})` : 'Wurf gepuffert');
      } finally {
        busy.current = false;
        setFps(Math.max(1, Math.round(1000 / Math.max(1, performance.now() - started))));
      }
    }, 420);
    return () => window.clearInterval(timer);
  }, [calibrated, autoDetect, grabGray, matchId, points, probeMode, beep, enqueue]);

  useEffect(() => {
    const timer = window.setInterval(() => setDrawTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Gepufferte Würfe nachschicken, sobald die Verbindung wieder steht
  useEffect(() => {
    void flushQueue();
    const timer = window.setInterval(() => void flushQueue(), 15000);
    const online = () => void flushQueue();
    window.addEventListener('online', online);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', online);
    };
  }, [flushQueue]);

  // Qualität regelmäßig prüfen und an den Server melden
  useEffect(() => {
    if (!streaming) return;
    const tick = () => {
      evaluate();
    };
    tick();
    const q = window.setInterval(tick, 4000);
    const send = window.setInterval(() => {
      void api(`/matches/${matchId}/devices/${me.current}/status`, {
        body: { quality, message, calibrated, fps: Math.round(1000 / 420) },
      }).catch(() => undefined);
    }, 5000);
    return () => {
      window.clearInterval(q);
      window.clearInterval(send);
    };
  }, [streaming, evaluate, quality, message, calibrated, matchId]);

  // Punkte ziehen
  const dragIndex = useRef<number | null>(null);
  const toLocal = (e: React.PointerEvent) => {
    const el = overlayRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!points) return;
    const local = toLocal(e);
    let best = -1;
    let bestDist = 0.06;
    points.forEach((p, i) => {
      const d = Math.hypot(p.x - local.x, p.y - local.y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best >= 0) {
      dragIndex.current = best;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragIndex.current === null || !points) return;
    const local = toLocal(e);
    setPoints(points.map((p, i) => (i === dragIndex.current ? { x: Math.min(1, Math.max(0, local.x)), y: Math.min(1, Math.max(0, local.y)) } : p)));
  };

  const onPointerUp = () => {
    dragIndex.current = null;
  };

  const applyCalibration = (pts: Point[], persist: boolean) => {
    matrix.current = homographyFrom4(pts, BOARD_TARGETS);
    boardToImage.current = homographyFrom4(BOARD_TARGETS, pts);
    refGray.current = null;
    knownDarts.current = [];
    setCalibrated(true);
    if (persist) localStorage.setItem('darts.calibration', JSON.stringify(pts));
    window.setTimeout(() => {
      refGray.current = grabGray();
    }, 900);
  };

  // Gespeicherte Kalibrierung beim Öffnen wiederherstellen (die Kamera steht ja gleich)
  useEffect(() => {
    if (!streaming) return;
    const saved = localStorage.getItem('darts.calibration');
    if (!saved) return;
    try {
      const pts = JSON.parse(saved) as Point[];
      if (Array.isArray(pts) && pts.length === 4) {
        setPoints(pts);
        applyCalibration(pts, false);
        setMessage('Kalibrierung wiederhergestellt');
      }
    } catch {
      /* kaputte Daten ignorieren */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  const confirmCalibration = () => {
    if (!points) return;
    applyCalibration(points, true);
    setCalibrated(true);
    setMessage('Kalibriert — Referenzbild wird aufgenommen');
    window.setTimeout(() => {
      refGray.current = grabGray();
    }, 700);
  };

  const overlayPoints = useMemo(() => points ?? [], [points]);

  useEffect(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 360;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    // Farben aus dem Designsystem (Canvas kann keine CSS-Variablen auflösen)
    const rootStyle = getComputedStyle(document.documentElement);
    const token = (name: string) => rootStyle.getPropertyValue(name).trim();
    const accent = token('--accent') || '#4fbf8b';
    const warn = token('--warn') || '#a8701c';
    ctx.globalAlpha = 1;

    // Board-Ringe als Orientierung, sobald kalibriert
    if (calibrated && boardToImage.current) {
      const m = boardToImage.current;
      ctx.lineWidth = Math.max(1.5, w / 600);
      const rings: Array<[number, string, number]> = [
        [BOARD_MM.doubleOuter, accent, 0.9],
        [BOARD_MM.doubleInner, accent, 0.35],
        [BOARD_MM.tripleOuter, token('--ink') || '#ffffff', 0.28],
        [BOARD_MM.tripleInner, token('--ink') || '#ffffff', 0.28],
        [BOARD_MM.bull, token('--ink') || '#ffffff', 0.4],
      ];
      for (const [radius, color, alpha] of rings) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (let i = 0; i <= 72; i += 1) {
          const a = (i / 72) * Math.PI * 2;
          const p = applyMatrix(m, { x: Math.cos(a) * radius, y: Math.sin(a) * radius });
          if (i === 0) ctx.moveTo(p.x * w, p.y * h);
          else ctx.lineTo(p.x * w, p.y * h);
        }
        ctx.stroke();
      }
      // 20er-Sektor markieren
      ctx.strokeStyle = warn;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      const top = applyMatrix(m, { x: 0, y: -BOARD_MM.tripleInner });
      const top2 = applyMatrix(m, { x: 0, y: -BOARD_MM.doubleOuter });
      ctx.moveTo(top.x * w, top.y * h);
      ctx.lineTo(top2.x * w, top2.y * h);
      ctx.stroke();
    }

    // Kalibrierpunkte
    overlayPoints.forEach((point, index) => {
      const x = point.x * w;
      const y = point.y * h;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(8, w / 45), 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.lineWidth = Math.max(2, w / 300);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 1;
      ctx.stroke();
      ctx.fillStyle = token('--ink') || '#ffffff';
      ctx.font = `bold ${Math.max(11, w / 45)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(TARGET_LABELS[index] ?? '', x, y - Math.max(14, w / 35));
    });
    ctx.globalAlpha = 1;
  }, [overlayPoints, calibrated, drawTick]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button className="btn !px-3 !py-2" onClick={() => onNavigate(`/match/${matchId}`)}>
          <ArrowLeft className="h-4 w-4" /> Zum Dashboard
        </button>
        <span className={`chip ${quality === 'good' ? 'chip-on' : ''}`}>
          <Camera className="h-3.5 w-3.5" />
          {quality === 'good' ? 'Kamera gut' : quality === 'ok' ? 'Kamera okay' : 'Kamera prüfen'}
        </span>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="relative w-full bg-black">
          <video ref={videoRef} playsInline muted className="block h-auto w-full" />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 h-full w-full touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          {!streaming && (
            <div className="absolute inset-0 grid place-items-center bg-[var(--bg)]/85 p-6 text-center text-sm text-[var(--muted)]">
              {error ?? 'Kamera wird gestartet …'}
            </div>
          )}
        </div>
      </div>

      {points && (
        <div className="card p-3">
          <p className="label">Kalibrierung</p>
          <p className="text-xs text-[var(--muted)]">
            Die vier Punkte liegen auf der <strong>Außenkante des Doppelrings</strong> bei 20 (oben), 6 (rechts),
            3 (unten) und 11 (links). Ziehen zum Korrigieren.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn !py-2 text-xs" onClick={() => void autoDetectBoard()}>
              <RefreshCw className="h-3.5 w-3.5" /> neu erkennen
            </button>
            <button className="btn btn-primary !py-2 text-xs" onClick={confirmCalibration}>
              <Check className="h-3.5 w-3.5" /> Kalibrierung übernehmen
            </button>
          </div>
        </div>
      )}

      <div className="card space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="label !mb-0">Status</p>
          <span
            className={`chip ${quality === 'good' ? 'chip-on' : quality === 'bad' ? '!border-[var(--danger)] !text-[var(--danger)]' : ''}`}
          >
            {message}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--muted)]">Erkannte Würfe</span>
          <span className="font-bold tabular-nums">{detections}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span className="chip">{fps} Bilder/s</span>
          {queued > 0 && <span className="chip !text-[var(--warn)]">{queued} gepuffert</span>}
          {drift && <span className="chip !text-[var(--warn)]">Kamera leicht verschoben — Punkte nachgezogen</span>}
        </div>

        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">Probelauf</p>
              <p className="text-xs text-[var(--muted)]">Würfe zählen, ohne sie zu buchen — zum Prüfen der Erkennung.</p>
            </div>
            <button
              className={`btn !px-3 !py-2 text-xs ${probeMode ? 'btn-primary' : ''}`}
              onClick={() => {
                setProbeMode((v) => !v);
                setProbe({ thrown: 0, detected: 0 });
              }}
            >
              {probeMode ? 'läuft' : 'starten'}
            </button>
          </div>
          {probeMode && (
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">erkannt</span>
              <span className="font-bold">{probe.detected} Würfe</span>
            </div>
          )}
        </div>
        {lastHit && (
          <div className="rounded-xl bg-[var(--surface-2)] p-3">
            <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Letzter Wurf</p>
            <p className="text-2xl font-extrabold">
              {lastHit.label}{' '}
              <span className="text-sm font-semibold text-[var(--muted)]">
                · {Math.round(lastHit.confidence * 100)} % sicher
              </span>
            </p>
          </div>
        )}
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Sichere Würfe automatisch buchen</span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={autoDetect}
            onChange={(e) => {
              setAutoDetect(e.target.checked);
              localStorage.setItem('darts.autoDetect', e.target.checked ? '1' : '0');
            }}
          />
        </label>
        <p className="text-xs text-[var(--placeholder)]">
          Aus: jeder Treffer wird als Vorschlag ans Dashboard geschickt und dort bestätigt. An: Treffer ab 60 %
          Sicherheit landen direkt im Spiel, unsichere trotzdem als Vorschlag.
        </p>
        <div className="flex gap-2">
          <button
            className="btn flex-1"
            onClick={() => {
              refGray.current = grabGray();
              knownDarts.current = [];
              setMessage('Referenzbild neu aufgenommen');
            }}
          >
            <Crosshair className="h-4 w-4" /> Referenz neu
          </button>
          <button
            className="btn flex-1"
            onClick={() => {
              setCalibrated(false);
              matrix.current = null;
              refGray.current = null;
              knownDarts.current = [];
            }}
          >
            <Square className="h-4 w-4" /> Erkennung aus
          </button>
        </div>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </div>

      <p className="text-center text-xs text-[var(--placeholder)]">
        Tipp: Handy quer oder hochkant fest aufstellen, Board vollständig im Bild, gleichmäßiges Licht. Nach jedem
        Leg die Darts abziehen — die Referenz zieht automatisch nach.
      </p>
    </div>
  );
}
