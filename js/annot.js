// 축 보조선(주석)의 기하 계산과 그리기. DOM 과 Firebase 에 의존하지 않는다.
// 좌표는 모두 world 기준으로 다루고, 화면 거리 판정에만 뷰포트를 쓴다.

export const CURVE_SNAP_PX = 12;
export const STRAIGHTEN_DEG = 10;
export const GUIDE_STYLE = { color: '#000', width: 1, dash: [6, 4] };

const round2 = (v) => Math.round(v * 100) / 100;
// 부동소수 꼬리(2.0000000000000004)를 잘라 정수 판정이 흔들리지 않게 한다.
const tidy = (v) => {
  const r = Number(v.toFixed(9));
  return Object.is(r, -0) ? 0 : r;
};

export function snapPoint(sx, sy, vp, curveFns = [], { free = false } = {}) {
  const wx = vp.s2x(sx);
  const wy = vp.s2y(sy);
  const x0 = tidy(free ? round2(wx) : Math.round(wx));

  let best = null;
  for (const fn of curveFns) {
    const y = fn(x0);
    if (!Number.isFinite(y)) continue;
    const d = Math.hypot(vp.x2s(x0) - sx, vp.y2s(y) - sy);
    if (d <= CURVE_SNAP_PX && (best === null || d < best.d)) best = { d, y };
  }

  if (best) return { point: { x: x0, y: tidy(best.y) }, kind: 'curve' };
  if (free) return { point: { x: x0, y: tidy(round2(wy)) }, kind: 'free' };
  return { point: { x: x0, y: tidy(Math.round(wy)) }, kind: 'grid' };
}

// 화면에서 잰 기울기가 수평·수직에서 toleranceDeg 안이면 축에 평행하게 맞춘다.
export function straighten(a, b, vp, toleranceDeg = STRAIGHTEN_DEG) {
  const dx = Math.abs(vp.x2s(b.x) - vp.x2s(a.x));
  const dy = Math.abs(vp.y2s(b.y) - vp.y2s(a.y));
  if (dx === 0 && dy === 0) return { ...b };
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle <= toleranceDeg) return { x: b.x, y: a.y };
  if (angle >= 90 - toleranceDeg) return { x: a.x, y: b.y };
  return { ...b };
}

export function markOf(a, b) {
  if (a.x === b.x && a.y !== b.y && a.x !== 0 && (a.y === 0 || b.y === 0)) {
    return { axis: 'x', value: a.x, text: '' };
  }
  if (a.y === b.y && a.x !== b.x && a.y !== 0 && (a.x === 0 || b.x === 0)) {
    return { axis: 'y', value: a.y, text: '' };
  }
  return null;
}

export function makeGuide(id, a, b) {
  if (a.x === b.x && a.y === b.y) return null;
  return {
    id,
    type: 'guide',
    pts: [{ ...a }, { ...b }],
    style: { ...GUIDE_STYLE, dash: [...GUIDE_STYLE.dash] },
    text: null,
    mark: markOf(a, b),
  };
}

// 축 위의 점에서는 만들지 않는다. 한쪽 선은 길이가 0 이고 다른 쪽은 축에 겹친다.
// 축이 범위 밖이어도 발은 world 의 축 위(0)에 둔다. 그릴 때 범위 사각형으로 잘린다.
export function guidesToAxes(p, mode, makeId) {
  if (p.x === 0 || p.y === 0) return [];
  const out = [];
  if (mode === 'both' || mode === 'x') out.push(makeGuide(makeId(), p, { x: p.x, y: 0 }));
  if (mode === 'both' || mode === 'y') out.push(makeGuide(makeId(), p, { x: 0, y: p.y }));
  return out;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSq = vx * vx + vy * vy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSq));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

export function hitTest(annots, vp, sx, sy, tolerancePx = 6) {
  for (let i = annots.length - 1; i >= 0; i -= 1) {
    const [a, b] = annots[i].pts;
    const d = distanceToSegment(sx, sy, vp.x2s(a.x), vp.y2s(a.y), vp.x2s(b.x), vp.y2s(b.y));
    if (d <= tolerancePx) return annots[i].id;
  }
  return null;
}

export function collectMarks(annots) {
  const out = [];
  for (const annot of annots) {
    const text = annot.mark?.text?.trim();
    if (!text) continue;
    const { axis, value } = annot.mark;
    if (out.some((m) => m.axis === axis && m.value === value)) continue;
    out.push({ axis, value, text });
  }
  return out;
}

// 화면에서 고르거나 가리킨 선, 미리보기에 쓰는 색. 내보내는 그림에는 나오지 않는다.
export const ACCENT = '#2b5d8a';

function clipToPlot(ctx, vp) {
  const { plot } = vp;
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  ctx.clip();
}

export function drawAnnots(ctx, vp, annots, { lineScale = 1, selectedId = null, highlightId = null } = {}) {
  ctx.save();
  clipToPlot(ctx, vp);
  ctx.lineCap = 'butt';
  for (const annot of annots) {
    if (annot.type !== 'guide') continue;
    const marked = annot.id === selectedId || annot.id === highlightId;
    const [a, b] = annot.pts;
    ctx.strokeStyle = marked ? ACCENT : annot.style.color;
    ctx.lineWidth = annot.style.width * lineScale * (marked ? 2 : 1);
    ctx.setLineDash((annot.style.dash ?? []).map((d) => d * lineScale));
    ctx.beginPath();
    ctx.moveTo(vp.x2s(a.x), vp.y2s(a.y));
    ctx.lineTo(vp.x2s(b.x), vp.y2s(b.y));
    ctx.stroke();
  }
  ctx.restore();
}

export function drawPreview(ctx, vp, { snap = null, from = null, to = null } = {}, { lineScale = 1 } = {}) {
  if (!snap && !(from && to)) return;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = lineScale;
  if (from && to) {
    ctx.setLineDash(GUIDE_STYLE.dash.map((d) => d * lineScale));
    ctx.beginPath();
    ctx.moveTo(vp.x2s(from.x), vp.y2s(from.y));
    ctx.lineTo(vp.x2s(to.x), vp.y2s(to.y));
    ctx.stroke();
  }
  if (snap) {
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(vp.x2s(snap.x), vp.y2s(snap.y), 4 * lineScale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
