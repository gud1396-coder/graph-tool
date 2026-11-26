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

// 정수와 눈금 간격의 배수 가운데 w 에 더 가까운 값. 눈금이 π/2 이면 π/2 자리에도
// 붙는다(sin x 의 π/2 에 보조선을 둘 수 있게). 간격이 정수면 정수만 본다.
export function snapToGrid(w, step = null) {
  const whole = Math.round(w);
  if (!(step > 0) || Number.isInteger(step)) return whole;
  const multiple = Math.round(w / step) * step;
  return Math.abs(multiple - w) < Math.abs(whole - w) ? multiple : whole;
}

// steps 는 { x, y } 눈금 간격(없으면 정수만). 곡선 함수는 (x, 마우스 y) 를 받는다.
// 음함수 곡선은 한 x 에 y 가 여럿이라 마우스에 가까운 쪽을 고르는 데 둘째 인자를 쓴다.
// points 는 정확히 붙을 특별한 점(교점·접점). 화면에서 CURVE_SNAP_PX 안이면 가장 먼저 붙는다.
export function snapPoint(sx, sy, vp, curveFns = [], { free = false, steps = null, points = [] } = {}) {
  let nearest = null;
  for (const p of points) {
    const d = Math.hypot(vp.x2s(p.x) - sx, vp.y2s(p.y) - sy);
    if (d <= CURVE_SNAP_PX && (nearest === null || d < nearest.d)) nearest = { d, p };
  }
  if (nearest) return { point: { x: tidy(nearest.p.x), y: tidy(nearest.p.y) }, kind: 'point' };

  const wx = vp.s2x(sx);
  const wy = vp.s2y(sy);
  const x0 = tidy(free ? round2(wx) : snapToGrid(wx, steps?.x));

  let best = null;
  for (const fn of curveFns) {
    const y = fn(x0, wy);
    if (!Number.isFinite(y)) continue;
    const d = Math.hypot(vp.x2s(x0) - sx, vp.y2s(y) - sy);
    if (d <= CURVE_SNAP_PX && (best === null || d < best.d)) best = { d, y };
  }

  if (best) return { point: { x: x0, y: tidy(best.y) }, kind: 'curve' };
  if (free) return { point: { x: x0, y: tidy(round2(wy)) }, kind: 'free' };
  return { point: { x: x0, y: tidy(snapToGrid(wy, steps?.y)) }, kind: 'grid' };
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

// ---------- 점 ●/○ ----------
// 곡선 끝점(render.js 의 ENDPOINT_RADIUS)과 같은 크기로 그린다.
export const POINT_RADIUS = 3.5;

export function makePoint(id, p, filled) {
  return {
    id,
    type: 'point',
    pts: [{ x: p.x, y: p.y }],
    style: { color: '#000', filled: Boolean(filled) },
    text: '',
    mark: null,
  };
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
    const [a, b = a] = annots[i].pts;
    const d = distanceToSegment(sx, sy, vp.x2s(a.x), vp.y2s(a.y), vp.x2s(b.x), vp.y2s(b.y));
    if (d <= tolerancePx) return annots[i].id;
  }
  return null;
}

// ---------- 끌어 옮기기 ----------
// 점은 그 점을, 축에 닿는 보조선은 곡선 쪽 끝(축 위가 아닌 끝)을, 자유 보조선은 두 끝을 잡는다.

function curveSide(annot) {
  const onAxis = (q) => (annot.mark.axis === 'x' ? q.y === 0 : q.x === 0);
  const index = annot.pts.findIndex((q) => !onAxis(q));
  return index === -1 ? 0 : index;
}

function handlesOf(annot) {
  if (annot.type === 'point') return [0];
  if (annot.type !== 'guide') return [];
  return annot.mark ? [curveSide(annot)] : [0, 1];
}

export function handleAt(annots, vp, sx, sy, tolerancePx = 8) {
  for (let i = annots.length - 1; i >= 0; i -= 1) {
    const annot = annots[i];
    for (const index of handlesOf(annot)) {
      const q = annot.pts[index];
      if (Math.hypot(vp.x2s(q.x) - sx, vp.y2s(q.y) - sy) <= tolerancePx) return { id: annot.id, index };
    }
  }
  return null;
}

// 축 보조선의 곡선 쪽 끝을 p 로 옮기고 발을 축에 다시 내린다. 축 기호 글자는 지킨다.
// 축 위로 옮겨 선이 사라지면 null.
function retarget(annot, p) {
  const foot = annot.mark.axis === 'x' ? { x: p.x, y: 0 } : { x: 0, y: p.y };
  const moved = makeGuide(annot.id, p, foot);
  if (!moved || !moved.mark || moved.mark.axis !== annot.mark.axis) return null;
  return { ...annot, pts: moved.pts, mark: { ...moved.mark, text: annot.mark.text } };
}

const samePoint = (a, b) => a.x === b.x && a.y === b.y;

// 잡은 손잡이를 world 점 p 로 옮긴 새 배열. 옮길 수 없으면 받은 배열을 그대로 돌려준다.
// 같은 곡선 쪽 점을 나누는 축 보조선(G 로 만든 짝)은 함께 옮긴다.
export function moveHandle(annots, id, index, p, vp) {
  const target = annots.find((a) => a.id === id);
  if (!target) return annots;

  if (target.type === 'point') {
    return annots.map((a) => (a.id === id ? { ...a, pts: [{ x: p.x, y: p.y }] } : a));
  }

  if (target.mark) {
    const from = target.pts[curveSide(target)];
    const linked = (a) => a.id === id
      || (a.type === 'guide' && a.mark && samePoint(a.pts[curveSide(a)], from));
    const next = annots.map((a) => (linked(a) ? retarget(a, p) : a));
    return next.some((a) => a === null) ? annots : next;
  }

  const other = target.pts[1 - index];
  const end = straighten(other, p, vp);
  const pts = index === 0 ? [end, { ...other }] : [{ ...other }, end];
  const moved = makeGuide(id, pts[0], pts[1]);
  if (!moved) return annots;
  return annots.map((a) => (a.id === id ? { ...a, pts: moved.pts, mark: moved.mark } : a));
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

const POINT_FONT = (size) => `italic ${size}px "Times New Roman", "Nanum Myeongjo", serif`;
const POINT_FONT_SIZE = 15;

// 빈 점의 속은 배경으로 채운다. 투명 배경이면 지운다(내보낼 때). 화면의 주석 층은
// 곡선 층 위에 겹쳐 있으므로 호출하는 쪽이 'white' 를 넘긴다.
function drawPoint(ctx, vp, annot, color, lineScale, background) {
  const [p] = annot.pts;
  const sx = vp.x2s(p.x);
  const sy = vp.y2s(p.y);
  const r = POINT_RADIUS * lineScale;
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5 * lineScale;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  if (annot.style.filled) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    if (background === 'transparent') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = background;
    }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  const name = (annot.text ?? '').trim();
  if (name) {
    ctx.fillStyle = color;
    ctx.font = POINT_FONT(POINT_FONT_SIZE * lineScale);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(name, sx + r + 2 * lineScale, sy - r - 1 * lineScale);
  }
}

export function drawAnnots(ctx, vp, annots, {
  lineScale = 1, selectedId = null, highlightId = null, background = 'white',
} = {}) {
  ctx.save();
  clipToPlot(ctx, vp);
  ctx.lineCap = 'butt';
  for (const annot of annots) {
    const marked = annot.id === selectedId || annot.id === highlightId;
    if (annot.type === 'point') {
      drawPoint(ctx, vp, annot, marked ? ACCENT : annot.style.color, lineScale, background);
      continue;
    }
    if (annot.type !== 'guide') continue;
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
