import { test } from "node:test";
import assert from "node:assert/strict";
import { bestGrid } from "../lib/meetings/video-grid.ts";

test("video tiles: as big as the box allows", () => {
  // The right-hand column's 4:3 box.
  assert.deepEqual(bestGrid(1, 400, 300), { cols: 1, rows: 1 });
  assert.deepEqual(bestGrid(2, 400, 300), { cols: 1, rows: 2 });
  assert.deepEqual(bestGrid(4, 400, 300), { cols: 2, rows: 2 });
  assert.deepEqual(bestGrid(5, 400, 300), { cols: 2, rows: 3 });
  // A very wide box: side by side.
  assert.deepEqual(bestGrid(2, 1600, 400), { cols: 2, rows: 1 });
  assert.deepEqual(bestGrid(6, 1600, 400), { cols: 3, rows: 2 });
  // Every tile fits.
  for (let n = 1; n <= 12; n++) {
    const g = bestGrid(n, 400, 300);
    assert.ok(g.cols * g.rows >= n);
  }
  assert.deepEqual(bestGrid(3, 0, 0), { cols: 1, rows: 1 });
});
