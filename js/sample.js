import { evaluate } from './expr.js';

// 곡선을 world 좌표 점열로 바꾼다. 끊어진 곳마다 덩어리를 나눈다.
// DOM 에 의존하지 않는다.

function isDrawable(y) {
  return Number.isFinite(y);
}

// 점근선을 세로 직선으로 잇는 사고를 막는 판정.
// 부호가 반대이면서 차이가 화면 높이의 jumpFactor 배를 넘을 때만 끊는다.
// 부호 조건을 함께 두어 x^3 처럼 기울기만 큰 연속 함수를 잘못 끊지 않는다.
function isJump(prevY, y, viewSpanY, jumpFactor) {
  if (prevY === undefined) return false;
  const opposite = (prevY < 0 && y > 0) || (prevY > 0 && y < 0);
  return opposite && Math.abs(y - prevY) > viewSpanY * jumpFactor;
}

export function sampleCurve(ast, vp, options = {}) {
  const {
    domain = { min: null, max: null },
    stepPx = 2,
    jumpFactor = 2,
    maxDepth = 4,
    tolerancePx = 0.4,
  } = options;

  const { xmin, xmax, ymin, ymax } = vp.view;
  const viewSpanY = ymax - ymin;
  const left = domain.min === null ? xmin : Math.max(xmin, domain.min);
  const right = domain.max === null ? xmax : Math.min(xmax, domain.max);
  if (!(right > left)) return [];

  const vars = { x: 0 };
  const yAt = (x) => {
    vars.x = x;
    return evaluate(ast, vars);
  };

  const steps = Math.max(2, Math.ceil(((right - left) * vp.scale) / stepPx));
  const dx = (right - left) / steps;

  const segments = [];
  let current = [];
  let prevY;

  const flush = () => {
    if (current.length >= 2) segments.push(current);
    current = [];
    prevY = undefined;
  };

  // 두 샘플 사이가 직선으로 보일 만큼 가까운지 보고, 아니면 쪼갠다.
  const refine = (x0, y0, x1, y1, depth) => {
    if (depth >= maxDepth) return;
    const xm = (x0 + x1) / 2;
    const ym = yAt(xm);
    if (!isDrawable(ym)) return;
    const chord = (y0 + y1) / 2;
    if (Math.abs(ym - chord) * vp.scale <= tolerancePx) return;
    refine(x0, y0, xm, ym, depth + 1);
    current.push({ x: xm, y: ym });
    refine(xm, ym, x1, y1, depth + 1);
  };

  for (let i = 0; i <= steps; i += 1) {
    const x = i === steps ? right : left + i * dx;
    const y = yAt(x);

    if (!isDrawable(y)) {
      flush();
      continue;
    }

    if (isJump(prevY, y, viewSpanY, jumpFactor)) {
      flush();
    }

    if (current.length > 0) {
      const last = current[current.length - 1];
      refine(last.x, last.y, x, y, 0);
    }

    current.push({ x, y });
    prevY = y;
  }

  flush();
  return segments;
}
