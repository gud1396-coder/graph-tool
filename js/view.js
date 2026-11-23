// world 좌표(수학)와 screen 좌표(픽셀) 사이의 변환만 담당한다.
// DOM 에 의존하지 않는다.

// 그릴 수 없는 범위를 여기서 걸러낸다. 그대로 계산하면 unitPx 가 Infinity 나
// 음수가 되어 화면이 조용히 비거나 축이 뒤집힌다. 음수 unitPx 는 두 축에 함께
// 곱해지므로 성한 축까지 망친다.
function assertDrawable(view, width, height) {
  for (const name of ['xmin', 'xmax', 'ymin', 'ymax']) {
    if (!Number.isFinite(view[name])) {
      throw new RangeError(`${name} 가 유한한 수가 아니다`);
    }
  }
  if (!(view.xmax > view.xmin)) {
    throw new RangeError('x 범위가 비었다. x 최소가 x 최대보다 작아야 한다');
  }
  if (!(view.ymax > view.ymin)) {
    throw new RangeError('y 범위가 비었다. y 최소가 y 최대보다 작아야 한다');
  }
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError('캔버스 폭과 높이가 0보다 커야 한다');
  }
}

// padding 은 캔버스 둘레 여백(screen 픽셀)이다. 숫자 하나면 네 변에 같게,
// 객체면 { left, top, right, bottom } 이다. world 범위는 여백 안쪽 사각형(plot)에
// 대응한다. 여백이 없으면 범위 최솟값 0 이 캔버스 가장자리에 걸려 축과 눈금
// 라벨이 캔버스 밖으로 잘린다.
function normalizePadding(padding) {
  if (typeof padding === 'number') {
    return { left: padding, top: padding, right: padding, bottom: padding };
  }
  return { left: 0, top: 0, right: 0, bottom: 0, ...padding };
}

export function makeViewport(view, width, height, lockAspect = true, padding = 0) {
  assertDrawable(view, width, height);
  const pad = normalizePadding(padding);
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  if (!(innerW > 0) || !(innerH > 0)) {
    throw new RangeError('여백을 빼면 그릴 자리가 남지 않는다');
  }
  let { xmin, xmax, ymin, ymax } = view;

  if (lockAspect) {
    // 요청한 범위를 잘라내지 않고 넓힌다. 중심은 그대로 둔다.
    const spanX = xmax - xmin;
    const spanY = ymax - ymin;
    const unitPx = Math.min(innerW / spanX, innerH / spanY);
    const halfX = innerW / unitPx / 2;
    const halfY = innerH / unitPx / 2;
    const cx = (xmin + xmax) / 2;
    const cy = (ymin + ymax) / 2;
    xmin = cx - halfX;
    xmax = cx + halfX;
    ymin = cy - halfY;
    ymax = cy + halfY;
  }

  const pxPerUnitX = innerW / (xmax - xmin);
  const pxPerUnitY = innerH / (ymax - ymin);
  const plotBottom = pad.top + innerH;

  return {
    view: { xmin, xmax, ymin, ymax },
    width,
    height,
    plot: { left: pad.left, top: pad.top, right: pad.left + innerW, bottom: plotBottom },
    scale: pxPerUnitX,
    x2s: (x) => pad.left + (x - xmin) * pxPerUnitX,
    y2s: (y) => plotBottom - (y - ymin) * pxPerUnitY,
    s2x: (sx) => xmin + (sx - pad.left) / pxPerUnitX,
    s2y: (sy) => ymin + (plotBottom - sy) / pxPerUnitY,
  };
}
