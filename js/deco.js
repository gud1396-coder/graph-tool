// 미적분 장식: 접선, 넓이(적분 영역), 교점. 계산과 그리기만 한다.
// DOM 에 의존하지 않는다. 곡선은 y = f(x) 함수로 받는다(값이 없으면 NaN).

import { drawEndpoints } from './render.js';
import { guidesToAxes, drawAnnots } from './annot.js';

export const DECO_TYPES = ['tangent', 'area', 'intersect'];

// ---------- 계산 ----------

// 중앙차분. h 는 화면 축척에 비례하게 호출하는 쪽이 정한다(설계 4절).
export function derivativeAt(f, a, h) {
  return (f(a + h) - f(a - h)) / (2 * h);
}

// 접점과 기울기. 값이나 기울기가 없으면 null.
export function tangentAt(f, a, h) {
  const y = f(a);
  const slope = derivativeAt(f, a, h);
  if (!Number.isFinite(y) || !Number.isFinite(slope)) return null;
  return { x: a, y, slope };
}

// 접선을 보이는 x 범위 양 끝까지 늘인 선분(world 두 점).
export function tangentSegment(t, xmin, xmax) {
  return [
    { x: xmin, y: t.y + t.slope * (xmin - t.x) },
    { x: xmax, y: t.y + t.slope * (xmax - t.x) },
  ];
}

// 두 곡선의 교점. d = f - g 의 부호가 바뀌는 칸을 찾아 이분법 30회로 좁힌다(설계 4절).
// 부호가 바뀌어도 차가 작아지지 않으면 점근선(1/x)이라 버린다. 접하는 점(부호가 안 바뀜)은
// 샘플 값이 0 이거나 |d| 가 극소이면서 아주 작을 때만 잡는다.
export function intersections(f, g, xmin, xmax, samples = 1000) {
  const d = (x) => f(x) - g(x);
  const dx = (xmax - xmin) / samples;
  const xs = [];
  const push = (x) => {
    if (xs.some((v) => Math.abs(v - x) < dx * 0.5)) return;
    xs.push(x);
  };
  const tiny = 1e-9 * (Math.abs(xmax) + Math.abs(xmin) + 1);

  let x0 = xmin;
  let d0 = d(x0);
  let dPrev = NaN;
  for (let i = 1; i <= samples; i += 1) {
    const x1 = i === samples ? xmax : xmin + i * dx;
    const d1 = d(x1);
    if (Number.isFinite(d0) && d0 === 0) push(x0);
    else if (Number.isFinite(d0) && Number.isFinite(d1) && (d0 < 0) !== (d1 < 0) && d1 !== 0) {
      let a = x0; let b = x1; let da = d0;
      for (let k = 0; k < 30; k += 1) {
        const m = (a + b) / 2;
        const dm = d(m);
        if (!Number.isFinite(dm)) { a = NaN; break; }
        if ((dm < 0) === (da < 0)) { a = m; da = dm; } else { b = m; }
      }
      const root = (a + b) / 2;
      if (Number.isFinite(root) && Math.abs(d(root)) <= Math.max(Math.abs(d0), Math.abs(d1))) push(root);
    } else if (Number.isFinite(dPrev) && Number.isFinite(d0) && Number.isFinite(d1)
      && Math.abs(d0) < Math.abs(dPrev) && Math.abs(d0) <= Math.abs(d1)) {
      // 접하는 점 후보: |d| 의 극소. 황금분할 대신 3분 탐색으로 좁혀 0 에 가까운지 본다.
      let a = x0 - dx; let b = x1;
      for (let k = 0; k < 60; k += 1) {
        const m1 = a + (b - a) / 3;
        const m2 = b - (b - a) / 3;
        if (Math.abs(d(m1)) < Math.abs(d(m2))) b = m2; else a = m1;
      }
      const m = (a + b) / 2;
      if (Math.abs(d(m)) < Math.max(tiny, 1e-7)) push(m);
    }
    dPrev = d0;
    x0 = x1;
    d0 = d1;
  }
  if (Number.isFinite(d0) && d0 === 0) push(x0);
  return xs.sort((p, q) => p - q);
}

// 넓이 영역의 다각형(world). 위 곡선 f 를 a→b 로, 아래 g(없으면 x 축)를 b→a 로 잇는다.
// 구간 안에 값이 없는 곳이 있으면 null.
export function areaPolygon(f, g, a, b, samples = 400) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!(hi > lo)) return null;
  const base = g ?? (() => 0);
  const top = [];
  const bottom = [];
  for (let i = 0; i <= samples; i += 1) {
    const x = lo + ((hi - lo) * i) / samples;
    const y1 = f(x);
    const y2 = base(x);
    if (!Number.isFinite(y1) || !Number.isFinite(y2)) return null;
    top.push({ x, y: y1 });
    bottom.push({ x, y: y2 });
  }
  return [...top, ...bottom.reverse()];
}

// ---------- 그리기 ----------

const AREA_GRAY = 'rgba(0, 0, 0, 0.16)';
const HATCH_GAP = 7;

function clipToPlot(ctx, vp) {
  const { plot } = vp;
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  ctx.clip();
}

function tracePolygon(ctx, vp, polygon) {
  ctx.beginPath();
  polygon.forEach((p, i) => {
    const sx = vp.x2s(p.x);
    const sy = vp.y2s(p.y);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

// 회색 칠이나 빗금. 구간 양 끝에는 가는 세로 경계선을 긋는다(곡선은 따로 그린다).
export function drawArea(ctx, vp, polygon, { fill = 'gray', lineScale = 1, color = '#000' } = {}) {
  if (!polygon || polygon.length < 3) return;
  const s = lineScale;
  ctx.save();
  clipToPlot(ctx, vp);
  tracePolygon(ctx, vp, polygon);
  if (fill === 'hatch') {
    ctx.clip();
    const xs = polygon.map((p) => vp.x2s(p.x));
    const ys = polygon.map((p) => vp.y2s(p.y));
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.max(vp.plot.top, Math.min(...ys));
    const bottom = Math.min(vp.plot.bottom, Math.max(...ys));
    const gap = HATCH_GAP * s;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8 * s;
    ctx.setLineDash([]);
    ctx.beginPath();
    // 오른쪽 위로 올라가는 45° 빗금.
    for (let c = left - (bottom - top); c <= right; c += gap) {
      ctx.moveTo(c, bottom);
      ctx.lineTo(c + (bottom - top), top);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = AREA_GRAY;
    ctx.fill();
  }
  ctx.restore();

  // 경계: 구간 양 끝의 세로선.
  const n = polygon.length / 2;
  const edges = [[polygon[0], polygon[polygon.length - 1]], [polygon[n - 1], polygon[n]]];
  ctx.save();
  clipToPlot(ctx, vp);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 * s;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const [p, q] of edges) {
    ctx.moveTo(vp.x2s(p.x), vp.y2s(p.y));
    ctx.lineTo(vp.x2s(q.x), vp.y2s(q.y));
  }
  ctx.stroke();
  ctx.restore();
}

export const TANGENT_DASH = [6, 4];

export function drawTangent(ctx, vp, t, {
  lineScale = 1, dashed = false, point = true, color = '#000', background = 'white',
} = {}) {
  if (!t) return;
  const s = lineScale;
  const [p, q] = tangentSegment(t, vp.view.xmin, vp.view.xmax);
  ctx.save();
  clipToPlot(ctx, vp);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2 * s;
  ctx.lineCap = 'butt';
  ctx.setLineDash(dashed ? TANGENT_DASH.map((d) => d * s) : []);
  ctx.beginPath();
  // 기울기가 아주 크면 y 가 커서 Canvas 가 엉킨다. 화면 높이 몇 배로 자른다.
  const lim = vp.height * 8;
  const clampY = (y) => Math.max(-lim, Math.min(lim, y));
  ctx.moveTo(vp.x2s(p.x), clampY(vp.y2s(p.y)));
  ctx.lineTo(vp.x2s(q.x), clampY(vp.y2s(q.y)));
  ctx.stroke();
  ctx.restore();
  if (point) drawEndpoints(ctx, vp, [{ x: t.x, y: t.y, closed: true }], { color, lineScale: s, background });
}

// 교점 ●. drops 면 두 축까지 보조선과 같은 점선을 내린다(축 기호는 붙이지 않는다).
export function drawIntersections(ctx, vp, points, {
  lineScale = 1, drops = false, color = '#000', background = 'white',
} = {}) {
  if (points.length === 0) return;
  if (drops) {
    let seq = 0;
    const guides = points.flatMap((p) => guidesToAxes(p, 'both', () => `drop${seq += 1}`));
    drawAnnots(ctx, vp, guides, { lineScale, background });
  }
  drawEndpoints(ctx, vp, points.map((p) => ({ ...p, closed: true })), { color, lineScale, background });
}
