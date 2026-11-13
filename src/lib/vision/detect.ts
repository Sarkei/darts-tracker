export interface GrayImage {
  data: Float32Array;
  width: number;
  height: number;
}

export interface Blob {
  x: number;
  y: number;
  /** Schwerpunkt, gewichtet nach Änderungsstärke — liegt näher an der Dartspitze. */
  wx: number;
  wy: number;
  area: number;
  width: number;
  height: number;
  /** Stärkste Änderung im Blob (0..255). */
  peak: number;
}

export function imageDataToGray(img: ImageData): GrayImage {
  const n = img.width * img.height;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const j = i * 4;
    data[i] = 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2];
  }
  return { data, width: img.width, height: img.height };
}

/** Mittelwert-Pyramide: schnelle Verkleinerung auf Zielbreite. */
export function downscale(src: GrayImage, targetWidth: number): GrayImage {
  if (src.width <= targetWidth) return src;
  const factor = Math.max(1, Math.round(src.width / targetWidth));
  const width = Math.floor(src.width / factor);
  const height = Math.floor(src.height / factor);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          sum += src.data[(y * factor + dy) * src.width + (x * factor + dx)];
        }
      }
      data[y * width + x] = sum / (factor * factor);
    }
  }
  return { data, width, height };
}

/** Schärfe über die Varianz des Laplace-Filters (kleine Werte = verwackelt/unscharf). */
export function sharpness(g: GrayImage): number {
  const { data, width, height } = g;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const v =
        4 * data[i] - data[i - 1] - data[i + 1] - data[i - width] - data[i + width];
      sum += v;
      sumSq += v * v;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

function sobelMagnitude(g: GrayImage): Float32Array {
  const { data, width, height } = g;
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        -data[i - width - 1] - 2 * data[i - 1] - data[i + width - 1] +
        data[i - width + 1] + 2 * data[i + 1] + data[i + width + 1];
      const gy =
        -data[i - width - 1] - 2 * data[i - width] - data[i - width + 1] +
        data[i + width - 1] + 2 * data[i + width] + data[i + width + 1];
      out[i] = Math.hypot(gx, gy) / 8;
    }
  }
  return out;
}

export interface CircleHit {
  cx: number;
  cy: number;
  r: number;
  /** 0..1 — mittlere Kantenstärke auf dem Kreis. */
  score: number;
}

/**
 * Mittlere Kantenstärke auf der Kreislinie — ein Kreis, der aus dem Bild ragt oder
 * nur halb sichtbar ist, bekommt Abzug (sonst gewinnen Zufallskreise am Rand).
 */
function circleScore(edges: Float32Array, width: number, height: number, cx: number, cy: number, r: number) {
  const steps = 48;
  let sum = 0;
  let inside = 0;
  for (let s = 0; s < steps; s += 1) {
    const a = (s / steps) * Math.PI * 2;
    const x = Math.round(cx + r * Math.cos(a));
    const y = Math.round(cy + r * Math.sin(a));
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
    sum += edges[y * width + x];
    inside += 1;
  }
  const coverage = inside / steps;
  if (coverage < 0.9) return 0;
  return (sum / steps / 255) * coverage;
}

/**
 * Sucht den Boardkreis über Kantenstärke auf Kreislinien (grob → fein).
 * Liefert null, wenn nichts Überzeugendes gefunden wurde — dann kalibriert der Nutzer per Hand.
 */
/** Mittlere Kantenstärke je Radius um einen Mittelpunkt. */
function radialProfile(edges: Float32Array, width: number, height: number, cx: number, cy: number, maxR: number) {
  const profile = new Float32Array(Math.ceil(maxR) + 1);
  for (let r = 2; r <= maxR; r += 1) {
    let sum = 0;
    let n = 0;
    for (let s = 0; s < 48; s += 1) {
      const a = (s / 48) * Math.PI * 2;
      const x = Math.round(cx + r * Math.cos(a));
      const y = Math.round(cy + r * Math.sin(a));
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      sum += edges[y * width + x];
      n += 1;
    }
    profile[r] = n >= 40 ? sum / n / 255 : 0;
  }
  return profile;
}

function sobelWithDirection(g: GrayImage): { mag: Float32Array; gx: Float32Array; gy: Float32Array } {
  const { data, width, height } = g;
  const mag = new Float32Array(width * height);
  const gxArr = new Float32Array(width * height);
  const gyArr = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        -data[i - width - 1] - 2 * data[i - 1] - data[i + width - 1] +
        data[i - width + 1] + 2 * data[i + 1] + data[i + width + 1];
      const gy =
        -data[i - width - 1] - 2 * data[i - width] - data[i - width + 1] +
        data[i + width - 1] + 2 * data[i + width] + data[i + width + 1];
      gxArr[i] = gx;
      gyArr[i] = gy;
      mag[i] = Math.hypot(gx, gy) / 8;
    }
  }
  return { mag, gx: gxArr, gy: gyArr };
}

/**
 * Mittelpunkt über Hough-Voting: jeder Kantenpunkt stimmt entlang seiner Gradientenrichtung
 * für Kreismittelpunkte. Das ist deutlich stabiler als eine Rastersuche über (x, y, r).
 */
function houghCenter(g: GrayImage): { cx: number; cy: number; score: number } | null {
  const { mag, gx, gy } = sobelWithDirection(g);
  const { width, height } = g;
  const minDim = Math.min(width, height);
  const acc = new Float32Array(width * height);
  const rMin = Math.max(6, Math.round(minDim * 0.10));
  const rMax = Math.round(minDim * 0.5);
  const rStep = Math.max(2, Math.round(minDim / 150));

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const m = mag[i];
      if (m < 18) continue;
      const ux = gx[i] / (m * 8);
      const uy = gy[i] / (m * 8);
      const len = Math.hypot(ux, uy) || 1;
      const nx = ux / len;
      const ny = uy / len;
      for (let r = rMin; r <= rMax; r += rStep) {
        for (const sign of [1, -1]) {
          const cx = Math.round(x + sign * nx * r);
          const cy = Math.round(y + sign * ny * r);
          if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
          acc[cy * width + cx] += m;
        }
      }
    }
  }

  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      // 3x3-Nachbarschaft mitteln, sonst gewinnen einzelne Ausreißer
      const v =
        acc[i] + acc[i - 1] + acc[i + 1] + acc[i - width] + acc[i + width] +
        acc[i - width - 1] + acc[i - width + 1] + acc[i + width - 1] + acc[i + width + 1];
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  if (best <= 0) return null;
  // Schwerpunkt der Spitzenzellen (95 % des Maximums) — glättet die Quantisierung
  const threshold = best * 0.95;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const v =
        acc[i] + acc[i - 1] + acc[i + 1] + acc[i - width] + acc[i + width] +
        acc[i - width - 1] + acc[i - width + 1] + acc[i + width - 1] + acc[i + width + 1];
      if (v >= threshold) {
        sx += x * (v - threshold + 1);
        sy += y * (v - threshold + 1);
        sw += v - threshold + 1;
      }
    }
  }
  if (sw > 0) {
    return { cx: sx / sw, cy: sy / sw, score: best };
  }
  return { cx: bx, cy: by, score: best };
}

export function findBoardCircle(g: GrayImage): CircleHit | null {
  const edges = sobelMagnitude(g);
  const { width, height } = g;

  // 1) Mittelpunkt per Hough, 2) Radius über das Radialprofil
  const center = houghCenter(g);
  if (center) {
    const minDim = Math.min(width, height);
    const profile = radialProfile(edges, width, height, center.cx, center.cy, Math.min(width, height) * 0.55);
    const from = Math.round(minDim * 0.16);
    const to = Math.min(minDim * 0.52, profile.length - 2);
    let maxScore = 0;
    for (let r = from; r < to; r += 1) maxScore = Math.max(maxScore, profile[r]);

    // Nicht der stärkste Ring, sondern der äußerste kräftige: das ist die Doppel-Außenkante.
    let bestR = 0;
    let bestScore = 0;
    for (let r = from + 1; r < to; r += 1) {
      const isPeak = profile[r] >= profile[r - 1] && profile[r] >= profile[r + 1];
      if (!isPeak) continue;
      if (profile[r] < maxScore * 0.5) continue;
      bestR = r;
      bestScore = profile[r];
    }
    if (bestR && bestScore > 0.04) {
      return { cx: center.cx, cy: center.cy, r: bestR, score: bestScore };
    }
  }
  const minR = Math.min(width, height) * 0.12;
  const maxR = Math.min(width, height) * 0.52;

  // Bester Treffer je Radius-Klasse — die Doppel-Außenkante ist nicht der stärkste Kreis
  // (Bull und Triple sind kontrastreicher), darum gewinnt am Ende der größte ähnlich gute Kreis.
  const perRadius = new Map<number, CircleHit>();
  const coarseStep = Math.max(4, Math.round(Math.min(width, height) / 40));
  for (let cy = coarseStep; cy < height - coarseStep; cy += coarseStep) {
    for (let cx = coarseStep; cx < width - coarseStep; cx += coarseStep) {
      for (let r = minR; r <= maxR; r += Math.max(3, coarseStep / 2)) {
        const score = circleScore(edges, width, height, cx, cy, r);
        const bucket = Math.round(r / 4) * 4;
        const prev = perRadius.get(bucket);
        if (!prev || score > prev.score) perRadius.set(bucket, { cx, cy, r, score });
      }
    }
  }
  if (!perRadius.size) return null;
  const maxScore = Math.max(...[...perRadius.values()].map((c) => c.score));
  if (maxScore < 0.05) return null;

  // Anker: kleinstes überzeugendes Kreissegment (Bull) → von dort das Radialprofil auswerten.
  // Die Doppel-Außenkante ist im Profil der stärkste Ring außerhalb des Bulls, auch wenn
  // andere Ringe lokal kontrastreicher sind.
  const anchor = [...perRadius.values()]
    .filter((c) => c.r < Math.min(width, height) * 0.14 && c.score >= maxScore * 0.5)
    .sort((a, b) => b.score - a.score)[0];
  if (anchor) {
    const profile = radialProfile(edges, width, height, anchor.cx, anchor.cy, maxR);
    let bestR = 0;
    let bestScore = 0;
    for (let r = Math.round(minR * 1.4); r <= maxR; r += 1) {
      if (profile[r] > bestScore) {
        bestScore = profile[r];
        bestR = r;
      }
    }
    if (bestR && bestScore > 0.05) {
      return { cx: anchor.cx, cy: anchor.cy, r: bestR, score: bestScore };
    }
  }
  let best: CircleHit | null = null;
  for (const candidate of perRadius.values()) {
    if (candidate.score < maxScore * 0.72) continue;
    if (!best || candidate.r > best.r) best = candidate;
  }
  if (!best) return null;

  // Feinjustierung in zwei Stufen (±6 px / ±12 px in 1-px-Schritten)
  let refined = best;
  for (const span of [6, 12]) {
    for (let dy = -span; dy <= span; dy += 1) {
      for (let dx = -span; dx <= span; dx += 1) {
        for (let dr = -span; dr <= span; dr += 1) {
          const cx = refined.cx + dx;
          const cy = refined.cy + dy;
          const r = refined.r + dr;
          if (r < minR * 0.8 || r > maxR * 1.2) continue;
          if (cx < 1 || cy < 1 || cx > width - 2 || cy > height - 2) continue;
          const score = circleScore(edges, width, height, cx, cy, r);
          if (score > refined.score) refined = { cx, cy, r, score };
        }
      }
    }
  }
  return refined;
}

/** Änderungen zwischen Referenz- und aktuellem Bild als zusammenhängende Flächen. */
/**
 * Alle Änderungen zwischen zwei Bildern — unabhängig davon, ob etwas heller oder dunkler wird.
 * Ein Dart verdunkelt das Bild meist (Körper, Schatten), ein heller Schaft hellt es auf; beides
 * ist derselbe Vorgang.
 */
export function changeBlobs(ref: GrayImage, cur: GrayImage, threshold: number): Blob[] {
  const { width, height } = cur;
  const mask = new Uint8Array(width * height);
  const weight = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const d = Math.abs(cur.data[i] - ref.data[i]);
    if (d > threshold) {
      mask[i] = 1;
      weight[i] = d - threshold;
    }
  }
  return blobsFromMask(mask, width, height, weight);
}

export function frameDiff(ref: GrayImage, cur: GrayImage, threshold: number): { added: Blob[]; removed: Blob[] } {
  const { width, height } = cur;
  const added = new Uint8Array(width * height);
  const removed = new Uint8Array(width * height);
  const weight = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const d = cur.data[i] - ref.data[i];
    if (d > threshold) {
      added[i] = 1;
      weight[i] = d - threshold;
    } else if (d < -threshold) {
      removed[i] = 1;
      weight[i] = -d - threshold;
    }
  }
  return { added: blobsFromMask(added, width, height, weight), removed: blobsFromMask(removed, width, height, weight) };
}

function blobsFromMask(mask: Uint8Array, width: number, height: number, weight?: Float32Array): Blob[] {
  const seen = new Uint8Array(width * height);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || seen[i]) continue;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let wSum = 0;
    let wX = 0;
    let wY = 0;
    let peak = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      area += 1;
      sx += x;
      sy += y;
      if (weight) {
        const w = weight[p];
        wSum += w;
        wX += w * x;
        wY += w * y;
        if (w > peak) peak = w;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const n of [p - 1, p + 1, p - width, p + width]) {
        if (n < 0 || n >= mask.length) continue;
        if (Math.abs((n % width) - x) > 1) continue;
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (area < 4) continue;
    if (weight && peak < 25) continue;
    blobs.push({
      x: sx / area,
      y: sy / area,
      wx: wSum > 0 ? wX / wSum : sx / area,
      wy: wSum > 0 ? wY / wSum : sy / area,
      area,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      peak,
    });
  }
  return blobs;
}
