// 좌표평면과 곡선을 그린다. Canvas 2D 컨텍스트는 인자로 받으며
// 이 파일은 document 나 window 에 접근하지 않는다.

import { layoutMath } from './typeset.js';

const SUPERSCRIPT = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴',
  5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '-': '⁻', '+': '⁺',
};

export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const magnitude = 10 ** exponent;
  const normalized = raw / magnitude;
  const mantissa = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return mantissa * magnitude;
}

export function autoStep(span, px, targetPx = 60) {
  const wanted = (span * targetPx) / Math.max(px, 1);
  return niceStep(wanted);
}

export function ticksFor(min, max, step) {
  const out = [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  for (let k = first; k <= last; k += 1) {
    out.push(k * step);
  }
  return out;
}

function trimFloat(v) {
  // k * 0.2 처럼 계산된 값에서 0.6000000000000001 이 새지 않게 다듬는다.
  const rounded = Number(v.toFixed(10));
  return String(rounded);
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

// π/2 의 정수배가 아닌 값은 라벨로 쓰지 않고 null 을 돌려준다. 가까운 눈금으로
// 끌어다 붙이면 틀린 라벨이 조용히 찍힌다.
const PI_SNAP_TOLERANCE = 1e-9;

function formatPiTick(v) {
  // v 를 π/2 의 정수배로 보고 약분한다.
  const halves = Math.round(v / (Math.PI / 2));
  const snapped = halves * (Math.PI / 2);
  if (Math.abs(v - snapped) > PI_SNAP_TOLERANCE * Math.max(1, Math.abs(v))) {
    return null;
  }
  if (halves === 0) return '0';
  const sign = halves < 0 ? '-' : '';
  const n = Math.abs(halves);
  const d = gcd(n, 2);
  const num = n / d;
  const den = 2 / d;
  const head = num === 1 ? 'π' : `${num}π`;
  return den === 1 ? `${sign}${head}` : `${sign}${head}/${den}`;
}

export function formatTick(v, mode = 'auto') {
  if (mode === 'pi') {
    const label = formatPiTick(v);
    if (label !== null) return label;
  }
  if (Object.is(v, -0)) return '0';
  return trimFloat(v);
}

export function toSuperscript(text) {
  return text.replace(/\^(-?\d+)/g, (whole, exponent) => {
    const converted = [...exponent].map((ch) => SUPERSCRIPT[ch]);
    return converted.every(Boolean) ? converted.join('') : whole;
  });
}

// 눈금 라벨. 기호가 있으면 간격의 몇 배인지를 기호로 쓴다(T, 2T, -T).
export function tickLabel(v, step, symbol, mode = 'auto') {
  if (symbol) {
    const k = Math.round(v / step);
    if (k === 1) return symbol;
    if (k === -1) return `-${symbol}`;
    return `${k}${symbol}`;
  }
  return formatTick(v, mode === 'pi' ? 'pi' : 'auto');
}

export const DEFAULT_AXIS = {
  tickMode: 'auto',
  tickX: null,
  tickY: null,
  symbolX: '',
  symbolY: '',
  grid: 'none',
  showArrow: true,
  showOrigin: true,
  labelX: 'x',
  labelY: 'y',
  fontSize: 15,
  color: '#000',
  lineScale: 1,
};

const MATH_FONT = (size) => `italic ${size}px "Times New Roman", "Nanum Myeongjo", serif`;
const ARROW_LENGTH = 9;
const ARROW_HALF_WIDTH = 4;
const TICK_HALF = 4;

function stepsFor(vp, axis) {
  // 눈금 간격은 1배 기준 픽셀로 정한다. 장치 픽셀을 그대로 쓰면 해상도 배수나
  // 레티나 화면에서 눈금이 배수만큼 빽빽해져 화면과 내보낸 그림이 달라진다.
  const s = axis.lineScale ?? 1;
  const plotW = (vp.plot.right - vp.plot.left) / s;
  const plotH = (vp.plot.bottom - vp.plot.top) / s;
  if (axis.tickMode === 'pi') {
    const half = Math.PI / 2;
    const span = vp.view.xmax - vp.view.xmin;
    // 범위가 넓으면 π/2 눈금이 너무 빽빽해진다.
    const unit = (span / half) > 16 ? Math.PI : half;
    return { stepX: unit, stepY: unit };
  }
  if (axis.tickMode === 'manual') {
    return {
      stepX: axis.tickX || autoStep(vp.view.xmax - vp.view.xmin, plotW),
      stepY: axis.tickY || autoStep(vp.view.ymax - vp.view.ymin, plotH),
    };
  }
  return {
    stepX: autoStep(vp.view.xmax - vp.view.xmin, plotW),
    stepY: autoStep(vp.view.ymax - vp.view.ymin, plotH),
  };
}

export function clearCanvas(ctx, width, height, background = 'white') {
  ctx.save();
  if (background === 'transparent') {
    ctx.clearRect(0, 0, width, height);
  } else {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

export function drawGrid(ctx, vp, axis) {
  if (axis.grid === 'none') return;

  const { stepX, stepY } = stepsFor(vp, axis);
  const xs = ticksFor(vp.view.xmin, vp.view.xmax, stepX);
  const ys = ticksFor(vp.view.ymin, vp.view.ymax, stepY);
  const s = axis.lineScale ?? 1;
  const { plot } = vp;

  ctx.save();

  if (axis.grid === 'dots') {
    ctx.fillStyle = '#9a9a9a';
    for (const x of xs) {
      for (const y of ys) {
        ctx.beginPath();
        ctx.arc(vp.x2s(x), vp.y2s(y), 1 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    ctx.strokeStyle = '#d9d9d9';
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    for (const x of xs) {
      const sx = vp.x2s(x);
      ctx.moveTo(sx, plot.top);
      ctx.lineTo(sx, plot.bottom);
    }
    for (const y of ys) {
      const sy = vp.y2s(y);
      ctx.moveTo(plot.left, sy);
      ctx.lineTo(plot.right, sy);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawArrowHead(ctx, tipX, tipY, dirX, dirY, s = 1) {
  // dir 은 단위 벡터다. 화살촉은 채운 삼각형으로 그린다.
  const backX = tipX - dirX * ARROW_LENGTH * s;
  const backY = tipY - dirY * ARROW_LENGTH * s;
  const sideX = -dirY * ARROW_HALF_WIDTH * s;
  const sideY = dirX * ARROW_HALF_WIDTH * s;

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(backX + sideX, backY + sideY);
  ctx.lineTo(backX - sideX, backY - sideY);
  ctx.closePath();
  ctx.fill();
}

export function drawAxes(ctx, vp, axis, marks = []) {
  const { stepX, stepY } = stepsFor(vp, axis);
  const { plot } = vp;
  // 원점이 범위 밖이면 축을 범위 가장자리에 둔다. 축은 범위 안쪽만 그린다.
  const originInX = vp.view.xmin <= 0 && 0 <= vp.view.xmax;
  const originInY = vp.view.ymin <= 0 && 0 <= vp.view.ymax;
  const originX = Math.max(plot.left, Math.min(vp.x2s(0), plot.right));
  const originY = Math.max(plot.top, Math.min(vp.y2s(0), plot.bottom));
  const s = axis.lineScale ?? 1;
  const tick = TICK_HALF * s;
  const gap = 3 * s;

  ctx.save();
  ctx.strokeStyle = axis.color;
  ctx.fillStyle = axis.color;
  ctx.lineWidth = 1.4 * s;
  ctx.setLineDash([]);
  ctx.font = MATH_FONT(axis.fontSize);
  const manual = axis.tickMode === 'manual';
  const symbolX = manual ? axis.symbolX : '';
  const symbolY = manual ? axis.symbolY : '';
  const markAt = (name, v) => marks.some((m) => m.axis === name && Math.abs(m.value - v) < 1e-9);
  const inX = (v) => v >= vp.view.xmin - 1e-9 && v <= vp.view.xmax + 1e-9;
  const inY = (v) => v >= vp.view.ymin - 1e-9 && v <= vp.view.ymax + 1e-9;

  // 축 이름 자리: x 는 축 아래 오른쪽 끝, y 는 축 왼쪽 위 끝(눈금 숫자와 같은 줄).
  // 끝 눈금 숫자와 겹치면 축 이름을 남기고 그 숫자를 숨긴다.
  const nameGap = 4 * s;
  const xName = { x: plot.right, y: originY + tick + gap };
  const yName = { x: originX - tick - gap, y: plot.top };
  const xNameLeft = xName.x - ctx.measureText(axis.labelX).width - nameGap;
  const hidesX = (text, sx) => sx + ctx.measureText(text).width / 2 > xNameLeft;
  const hidesY = (sy) => Math.abs(sy - yName.y) < axis.fontSize + nameGap;

  // 축
  ctx.beginPath();
  ctx.moveTo(plot.left, originY);
  ctx.lineTo(plot.right, originY);
  ctx.moveTo(originX, plot.bottom);
  ctx.lineTo(originX, plot.top);
  ctx.stroke();

  // 눈금 선과 라벨
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  // 축 이름에 자리를 내준 끝 숫자는 눈금 선도 그리지 않는다(2026-11-24 사용자 요청).
  for (const x of ticksFor(vp.view.xmin, vp.view.xmax, stepX)) {
    const sx = vp.x2s(x);
    const labeled = Math.abs(x) > 1e-9 && !markAt('x', x);
    const text = labeled ? tickLabel(x, stepX, symbolX, axis.tickMode) : '';
    if (labeled && hidesX(text, sx)) continue;
    ctx.beginPath();
    ctx.moveTo(sx, originY - tick);
    ctx.lineTo(sx, originY + tick);
    ctx.stroke();
    if (labeled) ctx.fillText(text, sx, originY + tick + gap);
  }
  // 보조선 기호. 눈금 간격에 걸리지 않는 값이면 눈금선도 새로 긋는다.
  for (const m of marks) {
    if (m.axis !== 'x' || !inX(m.value)) continue;
    const sx = vp.x2s(m.value);
    ctx.beginPath();
    ctx.moveTo(sx, originY - tick);
    ctx.lineTo(sx, originY + tick);
    ctx.stroke();
    ctx.fillText(m.text, sx, originY + tick + gap);
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const y of ticksFor(vp.view.ymin, vp.view.ymax, stepY)) {
    const sy = vp.y2s(y);
    const labeled = Math.abs(y) > 1e-9 && !markAt('y', y);
    if (labeled && hidesY(sy)) continue;
    ctx.beginPath();
    ctx.moveTo(originX - tick, sy);
    ctx.lineTo(originX + tick, sy);
    ctx.stroke();
    if (labeled) ctx.fillText(tickLabel(y, stepY, symbolY, axis.tickMode), originX - tick - gap, sy);
  }
  for (const m of marks) {
    if (m.axis !== 'y' || !inY(m.value)) continue;
    const sy = vp.y2s(m.value);
    ctx.beginPath();
    ctx.moveTo(originX - tick, sy);
    ctx.lineTo(originX + tick, sy);
    ctx.stroke();
    ctx.fillText(m.text, originX - tick - gap, sy);
  }

  // 화살촉은 양의 방향 끝에만 붙인다.
  if (axis.showArrow) {
    drawArrowHead(ctx, plot.right, originY, 1, 0, s);
    drawArrowHead(ctx, originX, plot.top, 0, -1, s);
  }

  // 축 이름
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(axis.labelX, xName.x, xName.y);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(axis.labelY, yName.x, yName.y);

  // 원점
  if (axis.showOrigin && originInX && originInY) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('O', originX - 4 * s, originY + gap);
  }

  ctx.restore();
}

export const DEFAULT_CURVE_STYLE = { color: '#000', width: 2, dash: null };

// 화면 높이의 몇 배까지만 Canvas 에 넘긴다. 1e9 같은 값을 그대로 주면
// 선이 엉킨다. world 좌표(샘플 결과)는 손대지 않는다.
const CLAMP_FACTOR = 8;

function clampScreenY(sy, height) {
  const limit = height * CLAMP_FACTOR;
  return Math.max(-limit, Math.min(limit, sy));
}

export function drawCurve(ctx, vp, segments, style = DEFAULT_CURVE_STYLE) {
  ctx.save();
  // 여백으로 곡선이 새지 않게 범위 사각형으로 자른다.
  const { plot } = vp;
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  ctx.clip();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.setLineDash(style.dash ?? []);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const segment of segments) {
    if (segment.length < 2) continue;
    ctx.beginPath();
    segment.forEach((point, index) => {
      const sx = vp.x2s(point.x);
      const sy = clampScreenY(vp.y2s(point.y), vp.height);
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
  }

  ctx.restore();
}

// 정의역 끝점. 포함은 채운 점(●), 미포함은 빈 점(○). 구간 포함·미포함 표기라
// 반드시 구분한다. 빈 점의 속은 배경으로 채워 곡선이 원 안으로 들어오지 않게 한다.
export const ENDPOINT_RADIUS = 3.5;

export function drawEndpoints(ctx, vp, points, { color = '#000', lineScale = 1, background = 'white' } = {}) {
  const { view } = vp;
  const eps = 1e-9;
  const visible = points.filter((p) => Number.isFinite(p.y)
    && p.x >= view.xmin - eps && p.x <= view.xmax + eps
    && p.y >= view.ymin - eps && p.y <= view.ymax + eps);
  if (visible.length === 0) return;

  const r = ENDPOINT_RADIUS * lineScale;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5 * lineScale;
  for (const p of visible) {
    const sx = vp.x2s(p.x);
    const sy = vp.y2s(p.y);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    if (p.closed) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = color;
      ctx.fill();
      continue;
    }
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
  ctx.restore();
}

const LABEL_GAP = 6;
const LABEL_MARGIN = 4;
// 2026-11-24 사용자 요청으로 15px(약 11pt) → 18px(약 13.5pt).
const LABEL_FONT_SIZE = 18;

export function drawCurveLabel(ctx, vp, segments, label, style = DEFAULT_CURVE_STYLE) {
  if (!label || !label.text) return;

  let anchor = label.at;
  if (!anchor) {
    // 가장 오른쪽 덩어리의 마지막 점에 붙인다.
    const drawable = segments.filter((seg) => seg.length > 0);
    if (drawable.length === 0) return;
    const last = drawable[drawable.length - 1];
    anchor = last[last.length - 1];
  }

  const scale = style.lineScale ?? 1;
  const fontSize = style.fontSize ?? LABEL_FONT_SIZE * scale;
  ctx.save();
  // 조판 상자 크기로 자리를 정한다. 분수처럼 높은 라벨도 위아래 넘침을 따진다.
  const box = layoutMath(ctx, label.text, { fontSize });

  // 정의역을 제한하지 않은 곡선의 마지막 샘플점은 정확히 화면 오른쪽 끝이다.
  // 거기서 오른쪽으로 더 밀면 라벨이 캔버스 밖에 찍혀 아예 보이지 않는다.
  // 넘치면 앵커 왼쪽에 붙이고, 그래도 넘치면 화면 안으로 당긴다.
  const gap = LABEL_GAP * scale;
  const margin = LABEL_MARGIN * scale;
  const anchorX = vp.x2s(anchor.x);
  let sx = anchorX + gap;
  const { plot } = vp;
  if (sx + box.width > plot.right - margin) sx = anchorX - gap - box.width;
  sx = Math.max(plot.left + margin, Math.min(sx, plot.right - margin - box.width));
  const height = box.ascent + box.descent;
  const bottom = Math.max(
    plot.top + margin + height,
    Math.min(vp.y2s(anchor.y) - gap, plot.bottom - margin),
  );

  box.draw(ctx, sx, bottom - box.descent, { color: style.color, lineScale: scale });
  ctx.restore();
}
