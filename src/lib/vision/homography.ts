export type Point = { x: number; y: number };

export type Matrix3 = [number, number, number, number, number, number, number, number, number];

/** Löst ein lineares Gleichungssystem (Gauß mit Spaltenpivot). */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[piv][col])) piv = row;
    }
    if (Math.abs(m[piv][col]) < 1e-12) throw new Error('Kalibrierung entartet');
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let row = col + 1; row < n; row += 1) {
      const f = m[row][col] / m[col][col];
      for (let k = col; k <= n; k += 1) m[row][k] -= f * m[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = m[row][n];
    for (let k = row + 1; k < n; k += 1) sum -= m[row][k] * x[k];
    x[row] = sum / m[row][row];
  }
  return x;
}

/** Homographie aus vier Punktpaaren (Quelle → Ziel). */
export function homographyFrom4(src: Point[], dst: Point[]): Matrix3 {
  if (src.length !== 4 || dst.length !== 4) throw new Error('vier Punktpaare nötig');
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(a, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyMatrix(m: Matrix3, p: Point): Point {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}

/** Mittlerer Rückprojektionsfehler in Pixeln — Maß für die Kalibrierqualität. */
export function reprojectionError(src: Point[], dst: Point[], m: Matrix3): number {
  let sum = 0;
  for (let i = 0; i < src.length; i += 1) {
    const p = applyMatrix(m, src[i]);
    sum += Math.hypot(p.x - dst[i].x, p.y - dst[i].y);
  }
  return sum / src.length;
}
