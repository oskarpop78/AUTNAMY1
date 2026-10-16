'use strict';
// Навигация для ботов: карта разбита на клетки 1x1, путь ищется алгоритмом A*.
// Высокие стены клетку закрывают, низкие ящики (можно перепрыгнуть) делают путь «дороже».

const world = require('./world');

let grid = null;
let gridMap = null;
let N = 0;

function build() {
  const B = world.BOUNDS;
  N = B * 2;
  grid = new Float32Array(N * N);        // 0 - свободно, число - цена, Infinity - стена
  gridMap = world.MAP;
  const mark = (b, pad, value) => {
    const x0 = Math.max(0, Math.floor(b.x - b.w / 2 - pad + B));
    const x1 = Math.min(N - 1, Math.floor(b.x + b.w / 2 + pad + B));
    const z0 = Math.max(0, Math.floor(b.z - b.d / 2 - pad + B));
    const z1 = Math.min(N - 1, Math.floor(b.z + b.d / 2 + pad + B));
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const cx = i - B + 0.5;
        const cz = j - B + 0.5;
        if (Math.abs(cx - b.x) < b.w / 2 + pad && Math.abs(cz - b.z) < b.d / 2 + pad) {
          if (value === Infinity || grid[j * N + i] !== Infinity) grid[j * N + i] = Math.max(grid[j * N + i], value);
        }
      }
    }
  };
  for (const b of world.BOXES) {
    if (b.h > 1.25) mark(b, world.RADIUS + 0.2, Infinity);
    else if (b.h > 0.15) mark(b, 0.1, 4);
  }
}

function ensure() {
  if (!grid || gridMap !== world.MAP) build();
}

const cellOf = (v) => Math.max(0, Math.min(N - 1, Math.floor(v + world.BOUNDS)));
const center = (i) => i - world.BOUNDS + 0.5;

// ближайшая свободная клетка (если стоим вплотную к стене)
function nearestFree(i, j) {
  if (grid[j * N + i] !== Infinity) return [i, j];
  for (let r = 1; r < 8; r++) {
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= N || b >= N) continue;
        if (grid[b * N + a] !== Infinity) return [a, b];
      }
    }
  }
  return null;
}

// Путь от (sx,sz) до (tx,tz): массив точек {x,z} или null
function findPath(sx, sz, tx, tz) {
  ensure();
  const s = nearestFree(cellOf(sx), cellOf(sz));
  const g = nearestFree(cellOf(tx), cellOf(tz));
  if (!s || !g) return null;
  const start = s[1] * N + s[0];
  const goal = g[1] * N + g[0];
  if (start === goal) return [{ x: center(g[0]), z: center(g[1]) }];

  const gs = new Float32Array(N * N).fill(Infinity);
  const from = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  // простая двоичная куча
  const heap = [];
  const push = (node, f) => {
    heap.push([f, node]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top[1];
  };
  const h = (n) => {
    const dx = Math.abs((n % N) - g[0]);
    const dz = Math.abs(Math.floor(n / N) - g[1]);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  };

  gs[start] = 0;
  push(start, h(start));
  let found = false;
  while (heap.length) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) { found = true; break; }
    const ci = cur % N;
    const cj = Math.floor(cur / N);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const a = ci + di;
        const b = cj + dj;
        if (a < 0 || b < 0 || a >= N || b >= N) continue;
        const n = b * N + a;
        const cost = grid[n];
        if (cost === Infinity || closed[n]) continue;
        if (di && dj && (grid[cj * N + a] === Infinity || grid[b * N + ci] === Infinity)) continue; // не режем углы
        const ng = gs[cur] + (di && dj ? 1.414 : 1) + cost;
        if (ng < gs[n]) { gs[n] = ng; from[n] = cur; push(n, ng + h(n)); }
      }
    }
  }
  if (!found) return null;
  const path = [];
  for (let n = goal; n !== -1 && n !== start; n = from[n]) path.push({ x: center(n % N), z: center(Math.floor(n / N)) });
  path.reverse();
  return path;
}

module.exports = { findPath };
