/**
 * How to lay out n video tiles in a box so each camera is as big as it can
 * be: try every column count, give each tile an equal share of the box, and
 * keep the one where a 16:9 picture fills the most area. Pure.
 */
export function bestGrid(n: number, width: number, height: number, aspect = 16 / 9): { cols: number; rows: number } {
  if (n <= 1 || width <= 0 || height <= 0) return { cols: 1, rows: 1 };
  let best = { cols: 1, rows: n, area: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = width / cols;
    const h = height / rows;
    const picW = Math.min(w, h * aspect);
    const area = picW * (picW / aspect);
    if (area > best.area + 0.5) best = { cols, rows, area };
  }
  return { cols: best.cols, rows: best.rows };
}
