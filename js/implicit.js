// 음함수 곡선 F(x, y) = 0 을 world 좌표 점열로 바꾼다(marching squares).
// DOM 에 의존하지 않는다.

import { evaluate } from './expr.js';

// 격자 한 칸의 크기(화면 px)와 한 방향 칸 수 상한. 내보내기 배수가 커도 계산량이
// 늘지 않게 칸 수로 막는다. 교차점은 칸 가장자리에서 이분법으로 다시 좁힌다.
const CELL_PX = 2;
const MAX_CELLS = 320;
const BISECT_STEPS = 22;

const isNeg = (v) => v < 0;

// 칸 가장자리 위의 0 을 이분법으로 찾는다. 양 끝 부호가 달라도 가운데 값이 양 끝보다
// 크면 0 이 아니라 극(1/x 따위)이다. 그 경우 null.
function edgeRoot(F, x0, y0, f0, x1, y1, f1) {
  let ax = x0; let ay = y0; let fa = f0;
  let bx = x1; let by = y1;
  for (let k = 0; k < BISECT_STEPS; k += 1) {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const fm = F(mx, my);
    if (!Number.isFinite(fm)) return null;
    if (isNeg(fm) === isNeg(fa)) { ax = mx; ay = my; fa = fm; } else { bx = mx; by = my; }
  }
  const x = (ax + bx) / 2;
  const y = (ay + by) / 2;
  const fr = F(x, y);
  if (!Number.isFinite(fr) || Math.abs(fr) > Math.max(Math.abs(f0), Math.abs(f1))) return null;
  return { x, y };
}

export function contourImplicit(ast, vp, { domain = { min: null, max: null } } = {}) {
  const { xmin, xmax, ymin, ymax } = vp.view;
  const left = domain.min === null ? xmin : Math.max(xmin, domain.min);
  const right = domain.max === null ? xmax : Math.min(xmax, domain.max);
  if (!(right > left)) return [];

  const vars = { x: 0, y: 0 };
  const F = (x, y) => {
    vars.x = x;
    vars.y = y;
    return evaluate(ast, vars);
  };

  const widthPx = Math.abs(vp.x2s(right) - vp.x2s(left));
  const heightPx = Math.abs(vp.y2s(ymin) - vp.y2s(ymax));
  const nx = Math.max(2, Math.min(MAX_CELLS, Math.ceil(widthPx / CELL_PX)));
  const ny = Math.max(2, Math.min(MAX_CELLS, Math.ceil(heightPx / CELL_PX)));
  // 격자가 대칭인 곡선의 꼭짓점(원 x^2+y^2=4 의 (2,0))을 정확히 밟으면 0 이 두 칸에 걸린다.
  // 아주 조금 비켜 둔다.
  const jitter = 1e-7;
  const xs = Array.from({ length: nx + 1 }, (_, i) => left + ((right - left) * i) / nx + jitter);
  const ys = Array.from({ length: ny + 1 }, (_, j) => ymin + ((ymax - ymin) * j) / ny + jitter);
  xs[nx] = right;

  const values = xs.map((x) => ys.map((y) => F(x, y)));

  // 가장자리 점: 'h,i,j' 는 (i,j)-(i+1,j), 'v,i,j' 는 (i,j)-(i,j+1).
  const points = new Map();
  const pointOn = (key) => {
    if (points.has(key)) return points.get(key);
    const [kind, si, sj] = key.split(',');
    const i = Number(si);
    const j = Number(sj);
    const i1 = kind === 'h' ? i + 1 : i;
    const j1 = kind === 'v' ? j + 1 : j;
    const p = edgeRoot(F, xs[i], ys[j], values[i][j], xs[i1], ys[j1], values[i1][j1]);
    points.set(key, p);
    return p;
  };

  const segments = [];
  const add = (k1, k2) => {
    const p = pointOn(k1);
    const q = pointOn(k2);
    if (p && q) segments.push([k1, k2]);
  };

  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const a = values[i][j];
      const b = values[i + 1][j];
      const c = values[i + 1][j + 1];
      const d = values[i][j + 1];
      if (![a, b, c, d].every(Number.isFinite)) continue;
      const na = isNeg(a); const nb = isNeg(b); const nc = isNeg(c); const nd = isNeg(d);
      const bottom = `h,${i},${j}`;
      const top = `h,${i},${j + 1}`;
      const leftEdge = `v,${i},${j}`;
      const rightEdge = `v,${i + 1},${j}`;
      const crossed = [];
      if (na !== nb) crossed.push(bottom);
      if (nb !== nc) crossed.push(rightEdge);
      if (nd !== nc) crossed.push(top);
      if (na !== nd) crossed.push(leftEdge);
      if (crossed.length === 2) {
        add(crossed[0], crossed[1]);
      } else if (crossed.length === 4) {
        // 안장점: 가운데 값으로 어느 두 모서리가 이어지는지 정한다.
        const center = F((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
        if (isNeg(center) === na) {
          add(bottom, rightEdge);
          add(top, leftEdge);
        } else {
          add(leftEdge, bottom);
          add(rightEdge, top);
        }
      }
    }
  }

  return joinSegments(segments, points);
}

// 칸마다 나온 선분을 가장자리 점을 따라 이어 긴 점열로 만든다. 점선이 끊기지 않게.
function joinSegments(segments, points) {
  const byKey = new Map();
  segments.forEach(([k1, k2], index) => {
    for (const k of [k1, k2]) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(index);
    }
  });
  const used = new Array(segments.length).fill(false);
  const lines = [];

  const walk = (startKey, fromIndex) => {
    const keys = [];
    let key = startKey;
    let index = fromIndex;
    for (;;) {
      const next = (byKey.get(key) ?? []).find((s) => !used[s] && s !== index);
      if (next === undefined) break;
      used[next] = true;
      const [k1, k2] = segments[next];
      key = k1 === key ? k2 : k1;
      index = next;
      keys.push(key);
    }
    return keys;
  };

  segments.forEach(([k1, k2], index) => {
    if (used[index]) return;
    used[index] = true;
    const forward = walk(k2, index);
    const backward = walk(k1, index);
    const keys = [...backward.reverse(), k1, k2, ...forward];
    lines.push(keys.map((k) => points.get(k)));
  });
  return lines;
}

// 세로선 x 와 곡선이 만나는 y 가운데 wy 에 가장 가까운 것. 보조선·점 스냅에 쓴다.
// 정수 y 에서 F 가 0 이면(x=3 같은 세로선) 정수 y 를 준다. 없으면 NaN.
export function implicitYNear(ast, lines, x, wy) {
  const F = (y) => evaluate(ast, { x, y });
  const whole = Math.round(wy);
  if (Math.abs(F(whole)) < 1e-9) return whole;

  let best = NaN;
  const consider = (y) => {
    if (Number.isFinite(y) && (Number.isNaN(best) || Math.abs(y - wy) < Math.abs(best - wy))) best = y;
  };
  for (const line of lines) {
    for (let k = 1; k < line.length; k += 1) {
      const p = line[k - 1];
      const q = line[k];
      const lo = Math.min(p.x, q.x);
      const hi = Math.max(p.x, q.x);
      if (x < lo || x > hi) continue;
      if (hi - lo < 1e-12) {
        consider(Math.max(Math.min(p.y, q.y), Math.min(wy, Math.max(p.y, q.y))));
        continue;
      }
      const t = (x - p.x) / (q.x - p.x);
      consider(refineY(F, p.y + t * (q.y - p.y), Math.abs(q.y - p.y) + 1e-6));
    }
  }
  return best;
}

// 선형 보간한 y 근처에서 F(x, y) = 0 을 이분법으로 다시 좁힌다. 부호가 안 바뀌면 그대로.
function refineY(F, y, span) {
  let a = y - span;
  let b = y + span;
  let fa = F(a);
  const fb = F(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || isNeg(fa) === isNeg(fb)) return y;
  for (let k = 0; k < 40; k += 1) {
    const m = (a + b) / 2;
    const fm = F(m);
    if (!Number.isFinite(fm)) return y;
    if (isNeg(fm) === isNeg(fa)) { a = m; fa = fm; } else { b = m; }
  }
  return (a + b) / 2;
}
