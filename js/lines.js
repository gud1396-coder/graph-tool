// 수식 칸의 줄을 해석한다. 'f(x)=…', 'y_1=…', 'y=…', 식만 쓴 줄을 받는다.
// DOM 에 의존하지 않는다.

import { parse, ParseError, evalAt, FUNCTION_NAMES } from './expr.js';

const SUBSCRIPT = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
// x 는 변수, e 는 상수, y 는 좌변이라 함수 이름으로 쓰면 헷갈린다.
const RESERVED = new Set(['x', 'y', 'e']);

export const LINE_DASH = [8, 5];
// 곡선 선 종류. 곡선은 lineCap 'round' 로 그리므로 길이 0.1 마디가 동그란 점이 된다.
export const LINE_DASHES = {
  dashed: LINE_DASH,
  dotted: [0.1, 5],
  long: [16, 6],
  dashdot: [14, 5, 0.1, 5],
};

export function toSubscript(digits) {
  return [...String(digits)].map((d) => SUBSCRIPT[d]).join('');
}

export function splitLine(line) {
  const fn = /^\s*([A-Za-z])\s*\(\s*x\s*\)\s*=(.*)$/.exec(line);
  if (fn) {
    const letter = fn[1];
    if (RESERVED.has(letter.toLowerCase())) {
      throw new Error(`${letter}(x) 는 이름으로 쓸 수 없다. x, y, e 는 변수·상수와 헷갈린다`);
    }
    return { key: letter, name: `${letter}(x)`, expr: fn[2].trim() };
  }
  const numbered = /^\s*y\s*_?\s*(\d+)\s*=(.*)$/i.exec(line);
  if (numbered) {
    const n = String(Number(numbered[1]));
    return { key: `y${n}`, name: `y${toSubscript(n)}`, expr: numbered[2].trim() };
  }
  const plain = /^\s*y\s*=(.*)$/i.exec(line);
  if (plain) return { key: null, name: null, expr: plain[1].trim() };
  return { key: null, name: null, expr: line.trim() };
}

// ---------- 범위 ----------
// 줄 끝의 [0<=x<=5), [x>0], [0,5) 같은 범위를 떼어 낸다.
// 부등식 모양은 부등호로, 구간 모양은 괄호로 끝점 포함을 정한다.

const RANGE_HINT = '[0<=x<=5], [x>0], [0,5) 처럼 쓴다';

// 끝 괄호와 짝이 맞는 여는 괄호를 찾는다. 괄호 종류는 섞여도 된다([0<=x<=5) 처럼).
function trailingGroup(expr) {
  const close = expr[expr.length - 1];
  if (close !== ']' && close !== ')') return null;
  let depth = 0;
  for (let i = expr.length - 1; i >= 0; i -= 1) {
    const ch = expr[i];
    if (ch === ']' || ch === ')') depth += 1;
    else if (ch === '[' || ch === '(') {
      depth -= 1;
      if (depth === 0) return { start: i, open: ch, inner: expr.slice(i + 1, -1), close };
    }
  }
  return null;
}

function readBound(text, whole) {
  const src = text.trim();
  let value = NaN;
  if (src !== '') {
    try {
      // x 를 NaN 으로 두어 x 가 든 경계는 NaN 이 되게 한다.
      value = evalAt(src, NaN);
    } catch {
      value = NaN;
    }
  }
  if (!Number.isFinite(value)) {
    throw new Error(`범위 '${whole}' 를 읽을 수 없다. ${RANGE_HINT}`);
  }
  return value;
}

function readInequality(inner, whole) {
  const parts = inner.replace(/≤/g, '<=').replace(/≥/g, '>=')
    .split(/(<=|>=|<|>)/).map((p) => p.trim());
  const fail = () => new Error(`범위 '${whole}' 를 읽을 수 없다. ${RANGE_HINT}`);
  const out = { min: null, max: null, minClosed: false, maxClosed: false };

  const apply = (xOnLeft, op, valueText) => {
    const value = readBound(valueText, whole);
    const isMax = xOnLeft === (op[0] === '<');
    const closed = op.length === 2;
    if (isMax) {
      if (out.max !== null) throw fail();
      out.max = value;
      out.maxClosed = closed;
    } else {
      if (out.min !== null) throw fail();
      out.min = value;
      out.minClosed = closed;
    }
  };

  if (parts.length === 3) {
    if (parts[0] === 'x' && parts[2] !== 'x') apply(true, parts[1], parts[2]);
    else if (parts[2] === 'x' && parts[0] !== 'x') apply(false, parts[1], parts[0]);
    else throw fail();
  } else if (parts.length === 5 && parts[2] === 'x') {
    apply(false, parts[1], parts[0]);
    apply(true, parts[3], parts[4]);
  } else {
    throw fail();
  }
  return out;
}

export function splitRange(expr) {
  const source = expr.trim();
  const none = { expr: source, range: null, tail: '' };
  const group = trailingGroup(source);
  if (!group) return none;

  const { start, open, inner, close } = group;
  const before = source.slice(0, start);
  const tail = source.slice(start);
  const inequality = /[<>≤≥]/.test(inner);
  const comma = inner.includes(',');

  if (!inequality) {
    // sin(x), 2(x+1), max(x,1) 처럼 식의 일부인 괄호는 범위가 아니다.
    if (open === '(' && !comma) return none;
    const word = /([A-Za-z]+)\s*$/.exec(before);
    if (open === '(' && word && FUNCTION_NAMES.has(word[1])) return none;
    if (!comma) throw new Error(`범위 '${tail}' 를 읽을 수 없다. ${RANGE_HINT}`);
  }

  let range;
  if (inequality) {
    range = readInequality(inner, tail);
  } else {
    const ends = inner.split(',');
    if (ends.length !== 2) throw new Error(`범위 '${tail}' 를 읽을 수 없다. ${RANGE_HINT}`);
    range = {
      min: readBound(ends[0], tail),
      max: readBound(ends[1], tail),
      minClosed: open === '[',
      maxClosed: close === ']',
    };
  }

  if (range.min !== null && range.max !== null && !(range.max > range.min)) {
    throw new Error(`범위가 비었다: '${tail}'. 왼쪽 끝이 오른쪽 끝보다 작아야 한다`);
  }
  return { expr: before.trim(), range, tail };
}

// 정의한 함수 글자가 다른 낱말에 붙지 않은 채 '(' 앞에 오면 부르는 것으로 본다.
function callsDefined(expr, letters) {
  return letters.find((letter) => new RegExp(`(^|[^A-Za-z])${letter}\\s*\\(`).test(expr));
}

// 사용자에게 보이는 식 번호는 빈 줄을 건너뛴 식 순서(order)다. lineNo 는 입력칸의 줄 번호로,
// 곡선 id 와 이름 없는 곡선의 설정 키에 쓰이므로 그대로 둔다.
export function readLines(text) {
  const errors = [];
  const fail = (order, message) => errors.push({ order, text: `식 ${order}${message}` });
  const split = [];
  let order = 0;

  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    order += 1;
    const lineNo = index + 1;
    try {
      const parts = splitLine(line);
      const { expr, range, tail } = splitRange(parts.expr);
      // 라벨 '식 전체' 에는 범위를 넣지 않는다(시험지 관례).
      const display = tail ? line.slice(0, line.length - tail.length).trim() : line;
      split.push({ lineNo, order, line, ...parts, expr, range, display });
    } catch (error) {
      fail(order, `: ${error.message}`);
    }
  });

  const letters = split.filter((s) => s.name && s.name.endsWith('(x)')).map((s) => s.key);
  const firstLine = new Map();
  const entries = [];

  for (const s of split) {
    if (s.key !== null) {
      if (firstLine.has(s.key)) {
        fail(s.order, `: ${s.name} 는 식 ${firstLine.get(s.key)} 에서 이미 정의했다`);
        continue;
      }
      firstLine.set(s.key, s.order);
    }
    const called = callsDefined(s.expr, letters);
    if (called) {
      fail(s.order, `: ${called}(x) 를 식 안에서 부르는 기능은 아직 없다`);
      continue;
    }
    try {
      entries.push({
        lineNo: s.lineNo,
        order: s.order,
        key: s.key ?? `#${s.lineNo}`,
        name: s.name,
        line: s.line,
        display: s.display,
        range: s.range,
        expr: s.expr,
        ast: parse(s.expr),
      });
    } catch (error) {
      if (error instanceof ParseError) {
        fail(s.order, `, 문자 ${error.pos + 1} 근처: ${error.message}`);
      } else {
        fail(s.order, `: ${error.message}`);
      }
    }
  }

  errors.sort((a, b) => a.order - b.order);
  return { entries, errors: errors.map((e) => e.text) };
}

export function defaultOptions(entry) {
  return { dash: 'solid', width: 2, label: entry.name ? 'name' : 'full' };
}

export function curveFromEntry(entry, options = {}) {
  const opts = { ...defaultOptions(entry), ...options };
  let text = entry.display ?? entry.line;
  if (opts.label === 'hidden') text = null;
  else if (opts.label === 'name' && entry.name) text = entry.name;

  return {
    id: `c${entry.lineNo - 1}`,
    lineNo: entry.lineNo,
    order: entry.order,
    kind: 'explicit',
    name: entry.name,
    key: entry.key,
    expr: entry.expr,
    ast: entry.ast,
    domain: entry.range ? { ...entry.range } : { min: null, max: null },
    style: {
      color: '#000',
      width: Number(opts.width),
      dash: LINE_DASHES[opts.dash] ? [...LINE_DASHES[opts.dash]] : null,
    },
    label: { text, at: null },
  };
}

export function parseStep(text) {
  const src = String(text ?? '').trim();
  if (src === '') return null;
  let value;
  try {
    value = evalAt(src, 0);
  } catch {
    value = NaN;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`'${src}' 을 읽을 수 없다. 0보다 큰 수나 pi/2 같은 식을 넣는다`);
  }
  return value;
}
