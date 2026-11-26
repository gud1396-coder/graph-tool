import { evaluate } from './expr.js';
import { makeViewport } from './view.js';
import { sampleCurve } from './sample.js';
import {
  clearCanvas, drawGrid, drawAxes, drawCurve, drawCurveLabels, drawEndpoints, DEFAULT_AXIS,
  yLabelOverflow, tickSteps,
} from './render.js';
import { renderToCanvas, downloadPng, downloadBlob, copyCanvasToClipboard } from './export.js';
import {
  saveBackup, loadBackup, normalizeBackup, toGraphFile, fromGraphFile,
} from './store.js';
import {
  readLines, curveFromEntry, defaultOptions, parseStep, parseValue,
} from './lines.js';
import { contourImplicit, implicitYNear } from './implicit.js';
import {
  tangentAt, tangentSegment, intersections, areaPolygon, drawArea, drawTangent, drawIntersections,
} from './deco.js';
import { layoutMath } from './typeset.js';
import { PALETTE, insertSnippet, nextSlot } from './palette.js';
import {
  snapPoint, straighten, makeGuide, guidesToAxes, hitTest, collectMarks,
  drawAnnots, drawPreview, makePoint, handleAt, moveHandle,
} from './annot.js';
import { makeHistory } from './history.js';

const CANVAS_WIDTH = 760;
const CANVAS_HEIGHT = 560;
// 캔버스 둘레 여백(1배 기준 px). 왼쪽·아래는 y 축 눈금 숫자와 x 축 눈금 숫자,
// O 가 들어갈 자리다. 없으면 범위 최솟값 0 일 때 축이 가장자리에 걸려 안 보인다.
const PADDING = { left: 36, top: 24, right: 24, bottom: 36 };

const el = (id) => document.getElementById(id);

export const state = {
  view: { xmin: -5, xmax: 5, ymin: -5, ymax: 5, lockAspect: true },
  axis: { ...DEFAULT_AXIS },
  curves: [],
  curveStyles: {},
  annots: [],
  // 미적분 장식(접선·넓이·교점). 값 칸은 글자 그대로 둔다(pi/2 같은 식).
  decos: [],
  canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: 'white' },
};

// 저장하지 않는 화면 상태: 지금 도구, L 의 첫 점, 미리보기, 고른 선, 가리킨 선.
const ui = { tool: 'select', pending: null, preview: null, selectedId: null, highlightId: null };
// 마지막으로 그린 화면의 뷰포트. vp 는 장치 픽셀(그리기용), vp1 은 CSS 픽셀(마우스용).
const screen = { vp: null, vp1: null, ratio: 1 };
// 파일을 새로 열면 되돌리기 기록도 새로 시작한다.
let history = makeHistory(50);

// ---------- 입력 읽기 ----------

function readCurves() {
  const { entries, errors } = readLines(el('exprs').value);
  const curves = entries.map((entry) => curveFromEntry(entry, state.curveStyles[entry.key]));
  return { curves, errors };
}

// 간격 칸을 읽는다. 직접 지정 모드일 때만 오류를 알린다(다른 모드에서는 쓰지 않는다).
function readStep(id, name, errors, report) {
  try {
    return parseStep(el(id).value);
  } catch (error) {
    if (report) errors.push(`${name} 눈금 간격 ${error.message}`);
    return null;
  }
}

// 직접 지정 간격이 너무 작으면 눈금이 빽빽해 읽을 수 없다. 알리고 자동 간격으로 그린다.
// (render.js 의 MAX_TICKS 는 멈추지 않게 하는 마지막 방어선이다.)
const DENSE_TICKS = 100;

function tooDense(step, span, name, errors, report) {
  if (step === null || !(span > 0) || span / step <= DENSE_TICKS) return step;
  if (report) errors.push(`${name} 눈금 간격이 너무 작다(눈금이 ${DENSE_TICKS}개를 넘는다). 자동 간격으로 그렸다`);
  return null;
}

function readState() {
  state.view = {
    xmin: Number(el('xmin').value),
    xmax: Number(el('xmax').value),
    ymin: Number(el('ymin').value),
    ymax: Number(el('ymax').value),
    lockAspect: el('lockAspect').checked,
  };

  const errors = [];
  const tickMode = el('tickMode').value;
  const manual = tickMode === 'manual';
  const tickX = tooDense(readStep('tickX', 'x', errors, manual), state.view.xmax - state.view.xmin, 'x', errors, manual);
  const tickY = tooDense(readStep('tickY', 'y', errors, manual), state.view.ymax - state.view.ymin, 'y', errors, manual);
  const symbolX = el('tickSymbolX').value.trim();
  const symbolY = el('tickSymbolY').value.trim();
  if (manual && symbolX && tickX === null && el('tickX').value.trim() === '') errors.push('x 눈금 기호를 쓰려면 x 눈금 간격을 넣어야 한다');
  if (manual && symbolY && tickY === null && el('tickY').value.trim() === '') errors.push('y 눈금 기호를 쓰려면 y 눈금 간격을 넣어야 한다');

  state.axis = {
    ...DEFAULT_AXIS,
    tickMode,
    tickX,
    tickY,
    symbolX: manual && tickX !== null ? symbolX : '',
    symbolY: manual && tickY !== null ? symbolY : '',
    grid: el('grid').value,
    showArrow: el('showArrow').checked,
    showOrigin: el('showOrigin').checked,
  };

  state.canvas = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    background: el('background').value,
  };

  const { curves, errors: curveErrors } = readCurves();
  state.curves = curves;
  const { items, errors: decoErrors } = resolveDecos();
  decoItems = items;
  return [...errors, ...curveErrors, ...decoErrors];
}

function showErrors(errors) {
  const box = el('error');
  if (errors.length === 0) {
    box.hidden = true;
    box.textContent = '';
  } else {
    box.hidden = false;
    box.textContent = errors.join('\n');
  }
}

// ---------- 그리기 ----------

// 글자 폭을 재는 데만 쓰는 캔버스. 화면에 붙이지 않는다.
let measureCtx = null;

// 1배 기준 여백. y 축 왼쪽 글자가 왼쪽 여백보다 길면 그만큼 늘린다.
// 화면·마우스·내보내기 뷰포트가 모두 이 값을 써야 서로 맞는다.
function scenePadding() {
  const { lockAspect, ...range } = state.view;
  const base = makeViewport(range, CANVAS_WIDTH, CANVAS_HEIGHT, lockAspect, PADDING);
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const axis = { ...state.axis, fontSize: DEFAULT_AXIS.fontSize, lineScale: 1 };
  const extra = Math.ceil(yLabelOverflow(measureCtx, base, axis, collectMarks(state.annots)));
  return { ...PADDING, left: PADDING.left + extra };
}

function sceneViewport(width, height, pixelRatio) {
  const { lockAspect, ...range } = state.view;
  const padding = Object.fromEntries(
    Object.entries(scenePadding()).map(([side, px]) => [side, px * pixelRatio]),
  );
  return makeViewport(range, width, height, lockAspect, padding);
}

// 곡선 샘플 캐시. 보조선 기호만 바뀌어 곡선 층을 다시 그릴 때 곡선을 다시 계산하지 않는다.
let sampleCache = { key: '', segments: new Map() };

function segmentsFor(curve, vp) {
  const key = JSON.stringify([vp.view, vp.width, vp.height, vp.plot]);
  if (key !== sampleCache.key) sampleCache = { key, segments: new Map() };
  const curveKey = `${curve.expr}|${curve.domain.min}|${curve.domain.max}`;
  let segments = sampleCache.segments.get(curveKey);
  if (!segments) {
    segments = curve.kind === 'implicit'
      ? contourImplicit(curve.ast, vp, { domain: curve.domain })
      : sampleCurve(curve.ast, vp, { domain: curve.domain });
    sampleCache.segments.set(curveKey, segments);
  }
  return segments;
}

// 해상도를 인자로 받아 그 크기에서 처음부터 그린다.
// 화면용 비트맵을 확대하면 선이 뭉개지므로 내보내기도 이 함수를 쓴다.
export function drawScene(ctx, width, height, pixelRatio = 1) {
  const vp = sceneViewport(width, height, pixelRatio);
  const axis = {
    ...state.axis,
    fontSize: DEFAULT_AXIS.fontSize * pixelRatio,
    lineScale: pixelRatio,
  };

  clearCanvas(ctx, width, height, state.canvas.background);
  drawGrid(ctx, vp, axis);
  // 넓이 칠은 축과 곡선 아래에 깐다.
  for (const item of decoItems) {
    if (item.type === 'area') drawArea(ctx, vp, item.polygon, { fill: item.fill, lineScale: pixelRatio });
  }
  drawAxes(ctx, vp, axis, collectMarks(state.annots));

  // 라벨은 곡선을 다 그린 뒤 한꺼번에 자리를 정한다. 서로, 그리고 다른 곡선과 덜 겹치게.
  const labels = [];
  for (const curve of state.curves) {
    const segments = segmentsFor(curve, vp);
    const style = {
      ...curve.style,
      width: curve.style.width * pixelRatio,
      dash: curve.style.dash ? curve.style.dash.map((d) => d * pixelRatio) : null,
      lineScale: pixelRatio,
    };
    drawCurve(ctx, vp, segments, style);
    drawEndpoints(ctx, vp, endpointsOf(curve), {
      color: curve.style.color,
      lineScale: pixelRatio,
      background: state.canvas.background,
    });
    labels.push({ segments, label: curve.label, style });
  }

  const background = state.canvas.background;
  const obstacles = [];
  for (const item of decoItems) {
    if (item.type === 'tangent') {
      drawTangent(ctx, vp, item.t, {
        lineScale: pixelRatio, dashed: item.dashed, point: item.point, background,
      });
      obstacles.push(tangentSegment(item.t, vp.view.xmin, vp.view.xmax));
    } else if (item.type === 'intersect') {
      drawIntersections(ctx, vp, item.points, { lineScale: pixelRatio, drops: item.drops, background });
    }
  }
  drawCurveLabels(ctx, vp, labels, { obstacles });
}

function valueAt(curve, x) {
  try {
    return evaluate(curve.ast, { x });
  } catch {
    return NaN;
  }
}

// 범위를 준 곡선의 끝점. 값이 없는 끝(1/x 의 0 등)은 drawEndpoints 가 건너뛴다.
// 음함수는 끝점을 찍지 않는다(한 x 에 y 가 여럿이다).
function endpointsOf(curve) {
  if (curve.kind === 'implicit') return [];
  const { min, max, minClosed, maxClosed } = curve.domain;
  const out = [];
  if (min !== null) out.push({ x: min, y: valueAt(curve, min), closed: Boolean(minClosed) });
  if (max !== null) out.push({ x: max, y: valueAt(curve, max), closed: Boolean(maxClosed) });
  return out;
}

// 내보낼 때는 보조선까지 한 장에 그린다. 스냅 표시·미리보기·선택 강조는 넣지 않는다.
function drawExport(ctx, width, height, pixelRatio) {
  drawScene(ctx, width, height, pixelRatio);
  drawAnnots(ctx, sceneViewport(width, height, pixelRatio), state.annots, {
    lineScale: pixelRatio,
    background: state.canvas.background,
  });
}

// 주석 층만 다시 그린다. 마우스를 움직일 때는 이것만 부른다.
function drawAnnotLayer() {
  const canvas = el('annotLayer');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!screen.vp) return;
  drawAnnots(ctx, screen.vp, state.annots, {
    lineScale: screen.ratio,
    selectedId: ui.selectedId,
    highlightId: ui.highlightId,
  });
  if (ui.preview) drawPreview(ctx, screen.vp, ui.preview, { lineScale: screen.ratio });
}

export function render() {
  const errors = readState();
  renderCurveOptions();
  renderDecoList();

  const canvas = el('fnLayer');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = CANVAS_WIDTH * ratio;
  canvas.height = CANVAS_HEIGHT * ratio;
  const ctx = canvas.getContext('2d');

  // 범위를 그릴 수 없으면 makeViewport 가 RangeError 를 던진다. 까닭을 입력창
  // 아래에 띄운다. 오류 없이 빈 화면이 나오면 사용자가 원인을 알 수 없다.
  try {
    drawScene(ctx, canvas.width, canvas.height, ratio);
    screen.vp = sceneViewport(canvas.width, canvas.height, ratio);
    screen.vp1 = sceneViewport(CANVAS_WIDTH, CANVAS_HEIGHT, 1);
    screen.ratio = ratio;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    errors.push(`보이는 범위: ${error.message}`);
    screen.vp = null;
    screen.vp1 = null;
  }

  showErrors(errors);

  const annot = el('annotLayer');
  annot.width = CANVAS_WIDTH * ratio;
  annot.height = CANVAS_HEIGHT * ratio;
  drawAnnotLayer();
}

// ---------- 곡선 설정 줄 ----------

const OPTION_SELECTS = [
  ['dash', '선', [
    ['solid', '실선'], ['dashed', '점선'], ['dotted', '짧은 점선'], ['long', '긴 점선'], ['dashdot', '일점쇄선'],
  ]],
  ['width', '굵기', [['1', '1'], ['2', '2'], ['3', '3']]],
  ['label', '라벨', [['hidden', '숨김'], ['name', '이름'], ['full', '식 전체']]],
];

let optionRowsSignature = '';

// 곡선 구성이 바뀔 때만 다시 만든다. 수식을 치는 동안 매번 만들면 고르던
// 선택 상자가 사라진다.
function renderCurveOptions() {
  const box = el('curveOptions');
  const signature = state.curves.map((c) => `${c.key}:${c.name ?? ''}:${c.lineNo}`).join('|');
  if (signature === optionRowsSignature) return;
  optionRowsSignature = signature;
  box.replaceChildren(...state.curves.map(optionRow));
  box.hidden = state.curves.length === 0;
}

function optionRow(curve) {
  const opts = { ...defaultOptions(curve), ...state.curveStyles[curve.key] };
  const row = document.createElement('div');
  row.className = 'curveRow';

  const title = document.createElement('span');
  title.className = 'curveName';
  title.textContent = curve.name ?? `식 ${curve.order}`;
  row.append(title);

  for (const [field, caption, choices] of OPTION_SELECTS) {
    const label = document.createElement('label');
    label.append(caption);
    const select = document.createElement('select');
    for (const [value, text] of choices) select.add(new Option(text, value));
    select.value = String(opts[field]);
    select.addEventListener('change', () => {
      state.curveStyles = {
        ...state.curveStyles,
        [curve.key]: { ...state.curveStyles[curve.key], [field]: select.value },
      };
      render();
      backupForm();
    });
    label.append(select);
    row.append(label);
  }
  return row;
}

// ---------- 보조선 ----------

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const fmt = (v) => String(Number(v.toFixed(2)));

let idSeq = 0;
function nextId() {
  idSeq += 1;
  return `g${Date.now().toString(36)}${idSeq}`;
}

// y = f(x) 곡선 함수. 범위 밖에서는 값이 없다. 빈 점(○) 끝에도 보조선을
// 내릴 수 있게 끝점 자체는 받는다. 장식 계산과 스냅이 함께 쓴다.
function curveFn(curve) {
  return (x) => {
    const { min, max } = curve.domain;
    if ((min !== null && x < min) || (max !== null && x > max)) return NaN;
    return valueAt(curve, x);
  };
}

// 스냅용 곡선 함수. 음함수는 마우스 y 에 가까운 곡선 위 y 를 준다.
function curveFns() {
  return state.curves.map((curve) => {
    if (curve.kind !== 'implicit') return curveFn(curve);
    return (x, wy) => {
      if (!screen.vp) return NaN;
      const { min, max } = curve.domain;
      if ((min !== null && x < min) || (max !== null && x > max)) return NaN;
      return implicitYNear(curve.ast, segmentsFor(curve, screen.vp), x, wy);
    };
  });
}

function afterAnnotsChange() {
  render();
  renderGuideList();
  backupForm();
}

function commitAnnots(next) {
  history.record(state.annots);
  state.annots = next;
  afterAnnotsChange();
}

function undo() {
  const prev = history.undo(state.annots);
  if (!prev) return;
  state.annots = prev;
  ui.selectedId = null;
  afterAnnotsChange();
}

function redo() {
  const next = history.redo(state.annots);
  if (!next) return;
  state.annots = next;
  ui.selectedId = null;
  afterAnnotsChange();
}

function setTool(tool) {
  ui.tool = tool;
  ui.pending = null;
  ui.preview = null;
  if (tool !== 'select') ui.selectedId = null;
  for (const button of document.querySelectorAll('.tool')) {
    button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  }
  el('annotLayer').classList.toggle('drawing', tool !== 'select');
  drawAnnotLayer();
}

function pointerPos(event) {
  const rect = el('annotLayer').getBoundingClientRect();
  return {
    sx: (event.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
    sy: (event.clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
  };
}

function inPlot(sx, sy) {
  const r = screen.vp1.plot;
  return sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom;
}

// 보조선·점은 정수와 눈금 간격의 배수에 붙는다(π 눈금이면 π/2 자리).
// 자동 눈금에서는 예전처럼 정수에만 붙는다. 사용자가 간격을 고른 경우(π·직접 지정)만 따른다.
function snapSteps() {
  if (state.axis.tickMode === 'auto') return null;
  const { stepX, stepY } = tickSteps(screen.vp1, { ...state.axis, lineScale: 1 });
  return { x: stepX, y: stepY };
}

function snapAt(event) {
  const { sx, sy } = pointerPos(event);
  return snapPoint(sx, sy, screen.vp1, curveFns(), {
    free: event.altKey, steps: snapSteps(), points: decoSnapPoints(),
  }).point;
}

// ---------- 끌어 옮기기 (선택 도구) ----------
// 끄는 동안에는 주석 층만 다시 그린다. 축 기호 자리(곡선 층)는 놓을 때 한 번 그린다.
// 되돌리기 기록도 놓을 때 한 번 남긴다.
let drag = null;

function onPointerDown(event) {
  if (ui.tool !== 'select' || !screen.vp1 || event.button !== 0) return;
  const { sx, sy } = pointerPos(event);
  const handle = handleAt(state.annots, screen.vp1, sx, sy);
  if (!handle) return;
  drag = { ...handle, before: state.annots, moved: false };
  ui.selectedId = handle.id;
  el('annotLayer').setPointerCapture(event.pointerId);
  el('annotLayer').classList.add('dragging');
  drawAnnotLayer();
}

function dragTo(event) {
  const pos = pointerPos(event);
  if (!inPlot(pos.sx, pos.sy)) return;
  const next = moveHandle(drag.before, drag.id, drag.index, snapAt(event), screen.vp1);
  if (next === drag.before) return;
  state.annots = next;
  drag.moved = true;
  drawAnnotLayer();
}

function onPointerUp(event) {
  if (!drag) return;
  const { before, moved } = drag;
  drag = null;
  const layer = el('annotLayer');
  if (layer.hasPointerCapture(event.pointerId)) layer.releasePointerCapture(event.pointerId);
  layer.classList.remove('dragging');
  if (moved) {
    history.record(before);
    afterAnnotsChange();
  } else {
    drawAnnotLayer();
  }
}

function onPointerMove(event) {
  if (drag) {
    dragTo(event);
    return;
  }
  if (ui.tool === 'select' && screen.vp1) {
    const { sx, sy } = pointerPos(event);
    el('annotLayer').classList.toggle('grabbable', Boolean(handleAt(state.annots, screen.vp1, sx, sy)));
    return;
  }
  if (ui.tool === 'select' || !screen.vp1) return;
  const pos = pointerPos(event);
  if (!inPlot(pos.sx, pos.sy)) {
    ui.preview = null;
    drawAnnotLayer();
    return;
  }
  let p = snapAt(event);
  if (ui.tool === 'line' && ui.pending) p = straighten(ui.pending, p, screen.vp1);
  ui.preview = { snap: p, from: ui.pending, to: ui.pending ? p : null };
  drawAnnotLayer();
}

function onPointerLeave() {
  ui.preview = null;
  drawAnnotLayer();
}

function onCanvasClick(event) {
  if (!screen.vp1) return;
  const { sx, sy } = pointerPos(event);
  if (!inPlot(sx, sy)) {
    if (ui.tool === 'select') {
      ui.selectedId = null;
      drawAnnotLayer();
    }
    return;
  }
  if (ui.tool === 'select') {
    ui.selectedId = hitTest(state.annots, screen.vp1, sx, sy);
    drawAnnotLayer();
    return;
  }

  const p = snapAt(event);
  if (ui.tool === 'line') {
    if (!ui.pending) {
      ui.pending = p;
      ui.preview = { snap: p, from: p, to: p };
      drawAnnotLayer();
      return;
    }
    const end = straighten(ui.pending, p, screen.vp1);
    const guide = makeGuide(nextId(), ui.pending, end);
    ui.pending = null;
    ui.preview = null;
    if (guide) commitAnnots([...state.annots, guide]);
    else drawAnnotLayer();
    return;
  }

  if (ui.tool === 'pointFilled' || ui.tool === 'pointOpen') {
    commitAnnots([...state.annots, makePoint(nextId(), p, ui.tool === 'pointFilled')]);
    return;
  }

  const added = guidesToAxes(p, ui.tool, nextId);
  if (added.length > 0) commitAnnots([...state.annots, ...added]);
}

// 한글 입력 상태에서는 event.key 가 자모로 온다. 글쇠 위치(code)로 가른다.
const TOOL_CODES = {
  KeyV: 'select', KeyL: 'line', KeyG: 'both', KeyX: 'x', KeyY: 'y',
  KeyP: 'pointFilled', KeyO: 'pointOpen',
};

function onKeyDown(event) {
  // 파일 단축키는 입력 칸에서도 받는다.
  if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyS' || event.code === 'KeyO')) {
    event.preventDefault();
    if (event.code === 'KeyS') saveGraph(event.shiftKey);
    else openGraph();
    return;
  }
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.code === 'KeyZ') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (mod || event.altKey) return;

  if (TOOL_CODES[event.code]) {
    setTool(TOOL_CODES[event.code]);
    return;
  }
  if (event.key === 'Escape') {
    setTool('select');
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && ui.selectedId) {
    event.preventDefault();
    const removed = ui.selectedId;
    ui.selectedId = null;
    commitAnnots(state.annots.filter((a) => a.id !== removed));
  }
}

// 축에 닿는 보조선마다 기호 칸, 점마다 이름 칸 한 줄.
function renderGuideList() {
  const rows = state.annots.filter((a) => a.mark || a.type === 'point');
  el('guideList').replaceChildren(...rows.map(guideRow));
  el('guideEmpty').hidden = rows.length > 0;
}

function guideRow(annot, index) {
  const row = document.createElement('div');
  row.className = 'guideRow';

  const isPoint = annot.type === 'point';
  const caption = document.createElement('span');
  const number = CIRCLED[index] ?? `${index + 1}.`;
  if (isPoint) {
    const [p] = annot.pts;
    caption.textContent = `${number} ${annot.style.filled ? '●' : '○'} (${fmt(p.x)}, ${fmt(p.y)})`;
  } else {
    // 축 위가 아닌 쪽 끝이 곡선 쪽 점이다.
    const onAxis = (q) => (annot.mark.axis === 'x' ? q.y === 0 : q.x === 0);
    const p = annot.pts.find((q) => !onAxis(q)) ?? annot.pts[0];
    caption.textContent = `${number} (${fmt(p.x)}, ${fmt(p.y)}) → ${annot.mark.axis} 축`;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.value = isPoint ? annot.text : annot.mark.text;
  input.placeholder = isPoint ? '이름' : '기호';
  input.maxLength = 8;
  input.spellcheck = false;

  // 고치기 시작할 때의 상태를 잡아 두었다가 다 고치면 한 번만 기록한다.
  let before = null;
  input.addEventListener('focus', () => { before = state.annots; });
  input.addEventListener('input', () => {
    state.annots = state.annots.map((a) => {
      if (a.id !== annot.id) return a;
      return isPoint ? { ...a, text: input.value } : { ...a, mark: { ...a.mark, text: input.value } };
    });
    // 점 이름은 주석 층에만 있다. 보조선 기호는 축(곡선 층)을 다시 그려야 한다.
    if (isPoint) drawAnnotLayer();
    else render();
    backupForm();
  });
  input.addEventListener('change', () => {
    if (before) history.record(before);
    before = state.annots;
  });

  row.addEventListener('mouseenter', () => { ui.highlightId = annot.id; drawAnnotLayer(); });
  row.addEventListener('mouseleave', () => { ui.highlightId = null; drawAnnotLayer(); });

  row.append(caption, input);
  return row;
}

// ---------- 미적분 장식 ----------

// 장식을 그릴 값(world)으로 바꾼 것. readState 가 만들고 drawScene·스냅이 읽는다.
let decoItems = [];

const DECO_NAMES = { tangent: '접선', area: '넓이', intersect: '교점' };

function explicitCurves() {
  return state.curves.filter((c) => c.kind !== 'implicit');
}

function curveTitle(curve) {
  return curve.name ?? `식 ${curve.order}`;
}

// 장식 칸의 글자를 읽어 그릴 수 있는 값으로 바꾼다. 오류는 '장식 N(접선): …' 으로 알린다.
function resolveDecos() {
  if (state.decos.length === 0) return { items: [], errors: [] };
  let vp;
  try {
    vp = sceneViewport(CANVAS_WIDTH, CANVAS_HEIGHT, 1);
  } catch (error) {
    if (error instanceof RangeError) return { items: [], errors: [] };
    throw error;
  }
  const { xmin, xmax } = vp.view;
  const items = [];
  const errors = [];

  state.decos.forEach((deco, index) => {
    const fail = (message) => errors.push(`장식 ${index + 1}(${DECO_NAMES[deco.type]}): ${message}`);
    const pick = (key, role) => {
      if (!key) throw new Error(`${role}을 고른다`);
      const curve = state.curves.find((c) => c.key === key);
      if (!curve) throw new Error(`${role}이 수식 칸에 없다`);
      if (curve.kind === 'implicit') throw new Error('음함수 곡선에는 쓸 수 없다');
      return curve;
    };
    try {
      const curve = pick(deco.curve, '곡선');
      const f = curveFn(curve);
      if (deco.type === 'tangent') {
        const a = parseValue(deco.at);
        const t = tangentAt(f, a, (xmax - xmin) * 1e-4);
        if (!t) throw new Error(`x=${deco.at.trim()} 에서 접선을 그을 수 없다(값이나 기울기가 없다)`);
        items.push({ type: 'tangent', t, dashed: Boolean(deco.dashed), point: deco.point !== false });
      } else if (deco.type === 'area') {
        const a = parseValue(deco.from);
        const b = parseValue(deco.to);
        if (a === b) throw new Error('구간의 두 끝이 같다');
        const g = deco.against ? curveFn(pick(deco.against, '아래 곡선')) : null;
        const polygon = areaPolygon(f, g, a, b);
        if (!polygon) throw new Error('구간 안에 값이 없는 곳이 있다');
        items.push({ type: 'area', polygon, fill: deco.fill === 'hatch' ? 'hatch' : 'gray' });
      } else if (deco.type === 'intersect') {
        if (deco.with && deco.with === deco.curve) throw new Error('서로 다른 두 곡선을 고른다');
        const g = deco.with ? curveFn(pick(deco.with, '둘째 곡선')) : () => 0;
        const points = intersections(f, g, xmin, xmax)
          .map((x) => ({ x, y: f(x) }))
          .filter((p) => Number.isFinite(p.y));
        if (points.length === 0) throw new Error('보이는 범위에 만나는 점이 없다');
        items.push({ type: 'intersect', points, drops: Boolean(deco.drops) });
      }
    } catch (error) {
      fail(error.message);
    }
  });
  return { items, errors };
}

// 교점과 접점은 점·보조선 스냅 자리다. 정수 좌표가 아니어도 정확히 붙는다.
function decoSnapPoints() {
  return decoItems.flatMap((item) => {
    if (item.type === 'intersect') return item.points;
    if (item.type === 'tangent') return [{ x: item.t.x, y: item.t.y }];
    return [];
  });
}

function addDeco(type) {
  const [first, second] = explicitCurves();
  const curve = first?.key ?? '';
  const base = { id: nextId(), type, curve };
  const deco = {
    tangent: { ...base, at: '1', dashed: false, point: true },
    area: { ...base, against: '', from: '0', to: '1', fill: 'gray' },
    intersect: { ...base, with: second?.key ?? '', drops: false },
  }[type];
  state.decos = [...state.decos, deco];
  render();
  backupForm();
}

function updateDeco(id, patch) {
  state.decos = state.decos.map((d) => (d.id === id ? { ...d, ...patch } : d));
  render();
  backupForm();
}

function removeDeco(id) {
  state.decos = state.decos.filter((d) => d.id !== id);
  render();
  backupForm();
}

let decoRowsSignature = '';

// 곡선 구성이나 장식 개수가 바뀔 때만 다시 만든다. 값을 치는 동안 칸이 사라지지 않게.
function renderDecoList() {
  const signature = JSON.stringify([
    explicitCurves().map((c) => [c.key, curveTitle(c)]),
    state.decos.map((d) => d.id),
  ]);
  el('decoEmpty').hidden = state.decos.length > 0;
  if (signature === decoRowsSignature) return;
  decoRowsSignature = signature;
  el('decoList').replaceChildren(...state.decos.map(decoRow));
}

function curveSelect(value, { axisOption = null } = {}) {
  const select = document.createElement('select');
  select.add(new Option(axisOption ?? '곡선 고르기', ''));
  for (const curve of explicitCurves()) select.add(new Option(curveTitle(curve), curve.key));
  if (value && !explicitCurves().some((c) => c.key === value)) select.add(new Option('(없는 곡선)', value));
  select.value = value;
  return select;
}

function decoRow(deco, index) {
  const row = document.createElement('div');
  row.className = 'decoRow';
  const kind = document.createElement('span');
  kind.className = 'decoKind';
  kind.textContent = `${index + 1}. ${DECO_NAMES[deco.type]}`;
  row.append(kind);

  const text = (field, caption, title) => {
    const label = document.createElement('label');
    label.append(caption);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = deco[field];
    input.spellcheck = false;
    input.title = title;
    input.addEventListener('input', () => updateDeco(deco.id, { [field]: input.value }));
    label.append(input);
    return label;
  };
  const check = (field, caption, fallback) => {
    const label = document.createElement('label');
    label.className = 'checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = deco[field] ?? fallback;
    input.addEventListener('change', () => updateDeco(deco.id, { [field]: input.checked }));
    label.append(input, caption);
    return label;
  };
  const choose = (field, options) => {
    const select = document.createElement('select');
    for (const [value, caption] of options) select.add(new Option(caption, value));
    select.value = deco[field] ?? options[0][0];
    select.addEventListener('change', () => updateDeco(deco.id, { [field]: select.value }));
    return select;
  };
  const curvePick = (field, options) => {
    const select = curveSelect(deco[field], options);
    select.addEventListener('change', () => updateDeco(deco.id, { [field]: select.value }));
    return select;
  };

  if (deco.type === 'tangent') {
    // 선 종류는 불리언(dashed)으로 저장한다.
    const dash = document.createElement('select');
    dash.add(new Option('실선', 'solid'));
    dash.add(new Option('점선', 'dashed'));
    dash.value = deco.dashed ? 'dashed' : 'solid';
    dash.addEventListener('change', () => updateDeco(deco.id, { dashed: dash.value === 'dashed' }));
    row.append(
      curvePick('curve'),
      text('at', 'x =', '접점의 x 좌표. pi/2 같은 식도 된다'),
      dash,
      check('point', '접점 ●', true),
    );
  } else if (deco.type === 'area') {
    row.append(
      curvePick('curve'),
      document.createTextNode('와'),
      curvePick('against', { axisOption: 'x 축' }),
      text('from', 'x', '구간 왼쪽 끝'),
      text('to', '~', '구간 오른쪽 끝'),
      choose('fill', [['gray', '회색'], ['hatch', '빗금']]),
    );
  } else {
    row.append(
      curvePick('curve'),
      document.createTextNode('와'),
      curvePick('with', { axisOption: 'x 축' }),
      check('drops', '축까지 점선', false),
    );
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'decoRemove';
  remove.textContent = '×';
  remove.title = '이 장식 지우기';
  remove.setAttribute('aria-label', `장식 ${index + 1} 지우기`);
  remove.addEventListener('click', () => removeDeco(deco.id));
  row.append(remove);
  return row;
}

// ---------- 내보내기 ----------

function exportCanvas() {
  readState();
  try {
    return renderToCanvas(
      (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
      drawExport,
      { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, scale: Number(el('scale').value) },
    );
  } catch (error) {
    // 그릴 수 없는 범위면 내보낼 것도 없다.
    if (!(error instanceof RangeError)) throw error;
    showExportMessage(`내보낼 수 없다 — 보이는 범위: ${error.message}`);
    return null;
  }
}

function showExportMessage(text) {
  const box = el('exportMessage');
  box.hidden = false;
  box.textContent = text;
}

// ---------- 백업 ----------

const FORM_IDS = [
  'exprs', 'xmin', 'xmax', 'ymin', 'ymax', 'lockAspect',
  'tickMode', 'tickX', 'tickY', 'tickSymbolX', 'tickSymbolY', 'grid', 'showArrow', 'showOrigin',
  'background', 'scale',
];

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readForm() {
  const form = {};
  for (const id of FORM_IDS) {
    const node = el(id);
    form[id] = node.type === 'checkbox' ? node.checked : node.value;
  }
  return form;
}

// 백업과 그래프 파일이 같은 모양을 쓴다.
function collectPayload() {
  return {
    ...readForm(), curveStyles: state.curveStyles, annots: state.annots, decos: state.decos,
  };
}

// 입력이 바뀔 때마다 부른다. 브라우저 자동 저장을 하고, 파일과 달라졌다고 표시한다.
function backupForm() {
  saveBackup(storage(), collectPayload());
  markDirty();
}

// 처음 화면의 폼 값. 새 그림이나 칸이 빠진 파일을 열 때 기본값으로 쓴다.
let DEFAULT_FORM = {};

// { form, curveStyles, annots } 를 화면 상태로 옮긴다. 빠진 폼 칸은 기본값으로 돌린다.
function applyGraph(backup) {
  const form = { ...DEFAULT_FORM, ...backup.form };
  for (const id of FORM_IDS) {
    if (!(id in form)) continue;
    const node = el(id);
    if (node.type === 'checkbox') node.checked = Boolean(form[id]);
    else node.value = form[id];
  }
  state.curveStyles = backup.curveStyles;
  state.annots = backup.annots;
  state.decos = backup.decos ?? [];
  decoRowsSignature = '';
  history = makeHistory(50);
  ui.selectedId = null;
  ui.pending = null;
  ui.preview = null;
  optionRowsSignature = '';
}

function restoreForm() {
  const backup = normalizeBackup(loadBackup(storage()));
  if (backup) applyGraph(backup);
}

// ---------- 그래프 파일 ----------

const FILE_TYPES = [{ description: '그래프 파일', accept: { 'application/json': ['.json'] } }];
// 지금 연 파일. handle 은 Chrome 파일 시스템 접근 API 의 핸들(없으면 다운로드로 저장).
const fileState = { handle: null, name: '', dirty: false };

function updateFileLabel() {
  const name = fileState.name || '새 그림';
  el('fileName').textContent = fileState.dirty ? `${name} ●` : name;
  document.title = `${fileState.dirty ? '● ' : ''}${name} — 시험 그래프 도구`;
}

function markDirty() {
  if (fileState.dirty) return;
  fileState.dirty = true;
  updateFileLabel();
}

function showFileMessage(text) {
  const box = el('fileMessage');
  box.hidden = false;
  box.textContent = text;
}

function confirmDiscard() {
  return !fileState.dirty || window.confirm('저장하지 않은 변경이 있다. 버리고 계속할까?');
}

function loadIntoApp(backup, name, handle) {
  applyGraph(backup);
  render();
  renderGuideList();
  saveBackup(storage(), collectPayload());
  fileState.handle = handle;
  fileState.name = name;
  fileState.dirty = false;
  updateFileLabel();
}

function newGraph() {
  if (!confirmDiscard()) return;
  loadIntoApp({ form: {}, curveStyles: {}, annots: [] }, '', null);
  showFileMessage('새 그림을 시작했다.');
}

async function openFromFile(file, handle) {
  try {
    loadIntoApp(fromGraphFile(await file.text()), file.name, handle);
    showFileMessage(`${file.name} 을 열었다.`);
  } catch (error) {
    // 읽지 못하면 지금 그림은 그대로 둔다.
    showFileMessage(`열 수 없다: ${error.message}`);
  }
}

async function openGraph() {
  if (!confirmDiscard()) return;
  if (!window.showOpenFilePicker) {
    el('fileInput').value = '';
    el('fileInput').click();
    return;
  }
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ types: FILE_TYPES });
  } catch (error) {
    if (error.name !== 'AbortError') showFileMessage(`열 수 없다: ${error.message}`);
    return;
  }
  await openFromFile(await handle.getFile(), handle);
}

async function saveGraph(saveAs = false) {
  const text = JSON.stringify(toGraphFile(collectPayload()), null, 2);
  const suggestedName = fileState.name || '그래프.graph.json';
  try {
    let handle = saveAs ? null : fileState.handle;
    if (!handle && window.showSaveFilePicker) {
      handle = await window.showSaveFilePicker({ suggestedName, types: FILE_TYPES });
    }
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      fileState.handle = handle;
      fileState.name = handle.name;
    } else {
      // 파일 저장 창이 없는 브라우저: 다운로드 폴더로 내려준다.
      downloadBlob(new Blob([text], { type: 'application/json' }), suggestedName);
      fileState.name = suggestedName;
    }
    fileState.dirty = false;
    updateFileLabel();
    showFileMessage(`${fileState.name} 에 저장했다.`);
  } catch (error) {
    if (error.name !== 'AbortError') showFileMessage(`저장하지 못했다: ${error.message}`);
  }
}

// ---------- LaTeX 팔레트 ----------

const FACE_WIDTH = 40;
const FACE_HEIGHT = 34;
const FACE_FONT = 14;

// 버튼 얼굴을 그림 라벨과 같은 조판기로 그린다. 빈 칸은 □.
function drawFace(canvas, face) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = FACE_WIDTH * ratio;
  canvas.height = FACE_HEIGHT * ratio;
  canvas.style.width = `${FACE_WIDTH}px`;
  canvas.style.height = `${FACE_HEIGHT}px`;
  const ctx = canvas.getContext('2d');
  const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#000';
  ctx.save();
  const box = layoutMath(ctx, face, { fontSize: FACE_FONT * ratio, slots: true });
  const x = (canvas.width - box.width) / 2;
  const y = (canvas.height + box.ascent - box.descent) / 2;
  box.draw(ctx, x, y, { color, lineScale: ratio });
  ctx.restore();
}

// 입력칸 글자만 바꾼다. 곡선은 input 이벤트가 지금 흐름대로 다시 그린다.
function insertIntoExprs(snippet) {
  const box = el('exprs');
  const { insert, from, to, cursor } = insertSnippet(box.value, box.selectionStart, box.selectionEnd, snippet);
  box.focus();
  box.setSelectionRange(from, to);
  // insertText 는 브라우저 실행 취소 기록에 남아 ⌘Z 로 되돌릴 수 있다.
  const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, insert);
  if (!inserted) {
    box.setRangeText(insert, from, to, 'end');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
  box.setSelectionRange(cursor, cursor);
}

function buildPalette() {
  const bar = el('palette');
  let group = null;
  for (const item of PALETTE) {
    if (group !== null && item.group !== group) {
      const gap = document.createElement('span');
      gap.className = 'paletteGap';
      bar.append(gap);
    }
    group = item.group;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'paletteButton';
    button.title = item.title;
    button.setAttribute('aria-label', item.title);
    const canvas = document.createElement('canvas');
    button.append(canvas);
    drawFace(canvas, item.face);
    // 누를 때 입력칸의 포커스와 선택을 빼앗지 않는다.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => insertIntoExprs(item.snippet));
    bar.append(button);
  }
}

// Tab: 같은 줄 커서 뒤에 빈 칸이 있으면 그리로, 없으면 기본 동작(다음 입력칸).
function onExprsKeyDown(event) {
  if (event.key !== 'Tab' || event.isComposing) return;
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
  const box = event.target;
  const pos = nextSlot(box.value, box.selectionEnd);
  if (pos === null) return;
  event.preventDefault();
  box.setSelectionRange(pos, pos);
}

// ---------- 배선 ----------

function attach() {
  const ids = [
    'exprs', 'xmin', 'xmax', 'ymin', 'ymax', 'lockAspect',
    'tickMode', 'tickX', 'tickY', 'tickSymbolX', 'tickSymbolY', 'grid', 'showArrow', 'showOrigin',
    'background',
  ];
  buildPalette();
  el('exprs').addEventListener('keydown', onExprsKeyDown);
  const onChange = () => { render(); backupForm(); };
  for (const id of ids) {
    el(id).addEventListener('input', onChange);
    el(id).addEventListener('change', onChange);
  }
  el('scale').addEventListener('change', backupForm);
  el('addTangent').addEventListener('click', () => addDeco('tangent'));
  el('addArea').addEventListener('click', () => addDeco('area'));
  el('addIntersect').addEventListener('click', () => addDeco('intersect'));

  for (const button of document.querySelectorAll('.tool')) {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  }
  const layer = el('annotLayer');
  layer.addEventListener('pointerdown', onPointerDown);
  layer.addEventListener('pointerup', onPointerUp);
  layer.addEventListener('pointercancel', onPointerUp);
  layer.addEventListener('pointermove', onPointerMove);
  layer.addEventListener('pointerleave', onPointerLeave);
  layer.addEventListener('click', onCanvasClick);
  document.addEventListener('keydown', onKeyDown);

  el('fileNew').addEventListener('click', newGraph);
  el('fileOpen').addEventListener('click', openGraph);
  el('fileSave').addEventListener('click', () => saveGraph(false));
  el('fileSaveAs').addEventListener('click', () => saveGraph(true));
  el('fileInput').addEventListener('change', () => {
    const [file] = el('fileInput').files;
    if (file) openFromFile(file, null);
  });

  el('savePng').addEventListener('click', async () => {
    const canvas = exportCanvas();
    if (!canvas) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
    await downloadPng(canvas, `graph-${stamp}.png`);
    showExportMessage('PNG 파일을 내려받았다.');
  });

  el('copyPng').addEventListener('click', async () => {
    const canvas = exportCanvas();
    if (!canvas) return;
    const ok = await copyCanvasToClipboard(canvas);
    showExportMessage(ok
      ? '클립보드에 복사했다. 문서에서 붙여넣기 하면 된다.'
      : '이 브라우저에서는 클립보드 복사가 막혀 있다. PNG 저장을 쓰세요.');
  });
}

DEFAULT_FORM = readForm();
restoreForm();
attach();
render();
renderGuideList();
updateFileLabel();

window.graphTool = { state, render, drawScene, screen, ui };
