// 수식 라벨 조판기. expr.js 의 토큰을 받아 "쓴 모양 그대로" 상자를 짜고 Canvas 2D 에 그린다.
// document 나 window 에 접근하지 않는다. 외부 의존 없음.
//
// 상자(Box): { width, ascent, descent, draw(ctx, x, baselineY, pen) }, pen = { color, lineScale }.
// 길이 단위 em 은 그 자리의 글자 크기다.

import { tokenize } from './expr.js';

const FAMILY = '"Times New Roman", "Nanum Myeongjo", serif';
export const METRICS = { ascent: 0.72, descent: 0.22, axis: 0.3 };
export const SCALE = { sup: 0.7, frac: 0.85, index: 0.6, min: 0.5 };
const RAISE = 0.45;
const DROP = 0.25;
// 높은 밑에서 지수 기준선을 밑의 위 끝보다 이만큼(em) 아래에 둔다.
const SUP_DROP = 0.3;
const SPACE = { rel: 0.28, bin: 0.22, mul: 0.17, fn: 0.17 };
// 괄호 안 내용 높이가 이 값(em)을 넘으면 괄호를 선으로 늘려 그린다.
const TALL_FENCE = 1.3;
const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
// 이름으로 볼 왼쪽: f(x), y, y_1, y1, y₁
const NAME_LEFT = /^\s*([A-Za-z]\s*\(\s*x\s*\)|[A-Za-z](\s*_?\s*\d+)?|[A-Za-z][₀-₉]+)\s*$/;

const fontOf = (size, italic) => `${italic ? 'italic ' : ''}${size}px ${FAMILY}`;

// ---------- 상자 ----------

function glyph(ctx, text, size, italic = false) {
  const font = fontOf(size, italic);
  ctx.font = font;
  const { width } = ctx.measureText(text);
  return {
    width,
    ascent: METRICS.ascent * size,
    descent: METRICS.descent * size,
    draw(c, x, y, pen) {
      c.font = font;
      c.fillStyle = pen.color;
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillText(text, x, y);
    },
  };
}

function space(width) {
  return { width, ascent: 0, descent: 0, draw() {} };
}

function row(items) {
  return {
    width: items.reduce((sum, b) => sum + b.width, 0),
    ascent: Math.max(0, ...items.map((b) => b.ascent)),
    descent: Math.max(0, ...items.map((b) => b.descent)),
    draw(c, x, y, pen) {
      let cx = x;
      for (const b of items) {
        b.draw(c, cx, y, pen);
        cx += b.width;
      }
    },
  };
}

// raise > 0 이면 위로 올린다.
function shift(box, raise) {
  return {
    width: box.width,
    ascent: Math.max(0, box.ascent + raise),
    descent: Math.max(0, box.descent - raise),
    draw(c, x, y, pen) { box.draw(c, x, y - raise, pen); },
  };
}

function pen(c, p) {
  c.lineWidth = p.lineScale;
  c.strokeStyle = p.color;
}

function frac(num, den, size) {
  const pad = 0.1 * size;
  const gap = 0.15 * size;
  const axis = METRICS.axis * size;
  const width = Math.max(num.width, den.width) + 2 * pad;
  return {
    width,
    ascent: axis + gap + num.descent + num.ascent,
    descent: Math.max(0, gap + den.ascent + den.descent - axis),
    draw(c, x, y, p) {
      const barY = y - axis;
      num.draw(c, x + (width - num.width) / 2, barY - gap - num.descent, p);
      den.draw(c, x + (width - den.width) / 2, barY + gap + den.ascent, p);
      pen(c, p);
      c.beginPath();
      c.moveTo(x, barY);
      c.lineTo(x + width, barY);
      c.stroke();
    },
  };
}

function radical(body, index, size) {
  const over = 0.15 * size;
  const hook = 0.62 * size;
  const lead = index ? Math.max(0, index.width - 0.3 * size) : 0;
  const width = lead + hook + 0.1 * size + body.width;
  const ascent = Math.max(body.ascent + over, index ? 0.4 * size + index.ascent : 0);
  return {
    width,
    ascent,
    descent: body.descent,
    draw(c, x, y, p) {
      const x0 = x + lead;
      const top = y - body.ascent - over;
      const bottom = y + body.descent;
      pen(c, p);
      c.beginPath();
      c.moveTo(x0 + 0.05 * size, y - 0.25 * size);
      c.lineTo(x0 + 0.18 * size, y - 0.32 * size);
      c.lineTo(x0 + 0.38 * size, bottom);
      c.lineTo(x0 + hook, top);
      c.lineTo(x + width, top);
      c.stroke();
      if (index) index.draw(c, x0 + 0.3 * size - index.width, y - 0.4 * size, p);
      body.draw(c, x0 + hook + 0.05 * size, y, p);
    },
  };
}

function side(c, kind, x, w, top, bottom, closing) {
  c.beginPath();
  if (kind === '|') {
    c.moveTo(x + w / 2, top);
    c.lineTo(x + w / 2, bottom);
  } else {
    const outer = closing ? x + 0.2 * w : x + 0.8 * w;
    const inner = closing ? x + 0.9 * w : x + 0.1 * w;
    c.moveTo(outer, top);
    c.quadraticCurveTo(inner, (top + bottom) / 2, outer, bottom);
  }
  c.stroke();
}

function fence(ctx, open, close, body, size) {
  if (body.ascent + body.descent <= TALL_FENCE * size) {
    return row([glyph(ctx, open, size), body, glyph(ctx, close, size)]);
  }
  const pad = 0.05 * size;
  const w = (open === '|' ? 0.25 : 0.35) * size;
  const ascent = body.ascent + pad;
  const descent = body.descent + pad;
  return {
    width: 2 * w + body.width,
    ascent,
    descent,
    draw(c, x, y, p) {
      const top = y - ascent;
      const bottom = y + descent;
      pen(c, p);
      side(c, open, x, w, top, bottom, false);
      side(c, close, x + w + body.width, w, top, bottom, true);
      body.draw(c, x + w, y, p);
    },
  };
}

// 팔레트 버튼의 빈 칸 □ (점선 네모).
function slot(size) {
  const w = 0.55 * size;
  const h = 0.7 * size;
  return {
    width: w + 0.1 * size,
    ascent: h,
    descent: 0,
    draw(c, x, y, p) {
      pen(c, p);
      c.setLineDash([2 * p.lineScale, 2 * p.lineScale]);
      c.beginPath();
      c.rect(x + 0.05 * size, y - h, w, h);
      c.stroke();
      c.setLineDash([]);
    },
  };
}

// ---------- 한 줄 조판 (이름, 조판 실패 시) ----------

function plainRow(ctx, text, size) {
  const items = [];
  const small = size * SCALE.sup;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ') { i += 1; continue; }
    if (ch === '_' && /\d/.test(text[i + 1] ?? '')) {
      let j = i + 1;
      while (/\d/.test(text[j] ?? '')) j += 1;
      items.push(shift(glyph(ctx, text.slice(i + 1, j), small), -DROP * size));
      i = j;
      continue;
    }
    if (SUBSCRIPT_DIGITS.includes(ch)) {
      let digits = '';
      while (i < text.length && SUBSCRIPT_DIGITS.includes(text[i])) {
        digits += SUBSCRIPT_DIGITS.indexOf(text[i]);
        i += 1;
      }
      items.push(shift(glyph(ctx, digits, small), -DROP * size));
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (/[\d.]/.test(text[j] ?? '')) j += 1;
      items.push(glyph(ctx, text.slice(i, j), size));
      i = j;
      continue;
    }
    items.push(glyph(ctx, ch, size, /[A-Za-z]/.test(ch)));
    i += 1;
  }
  return row(items);
}

// ---------- 토큰 → 상자 ----------

class Unsupported extends Error {}

class MathLayout {
  constructor(ctx, src, base, slots) {
    this.ctx = ctx;
    this.src = src;
    this.tokens = tokenize(src);
    this.i = 0;
    this.base = base;
    this.slots = slots;
  }

  peek() { return this.tokens[this.i]; }
  next() { return this.tokens[this.i++]; }
  atEnd() { return this.i >= this.tokens.length; }

  isType(type) {
    const t = this.peek();
    return Boolean(t) && t.type === type;
  }

  isOp(value) {
    const t = this.peek();
    return Boolean(t) && t.type === 'op' && t.value === value;
  }

  expectType(type) {
    if (!this.isType(type)) throw new Unsupported();
    return this.next();
  }

  glyph(text, size, italic = false) { return glyph(this.ctx, text, size, italic); }

  scriptSize(size, k) { return Math.max(size * k, this.base * SCALE.min); }

  numberText(token) { return /^\d*\.?\d*/.exec(this.src.slice(token.pos))[0]; }

  // 여는 토큰부터 닫는 토큰까지. 묶음 기호 자체는 그리지 않는다.
  group(size, openType, closeType) {
    this.expectType(openType);
    const inner = this.rowUntil(size, [closeType]);
    this.expectType(closeType);
    return inner.width === 0 && this.slots ? slot(size) : inner;
  }

  rowUntil(size, closers) {
    const items = [];
    let afterValue = false;
    while (!this.atEnd() && !closers.includes(this.peek().type)) {
      const t = this.peek();
      if (t.type === 'op' && t.value !== '^') {
        this.next();
        items.push(...this.operator(t, size, afterValue));
        afterValue = false;
      } else if (t.type === 'comma') {
        this.next();
        items.push(this.glyph(',', size), space(SPACE.fn * size));
        afterValue = false;
      } else {
        items.push(this.scripted(size));
        afterValue = true;
      }
    }
    return row(items);
  }

  operator(token, size, afterValue) {
    if (token.implicit) return [];
    if (token.value === '+' || token.value === '-') {
      const text = token.value === '-' ? '−' : '+';
      if (!afterValue) return [this.glyph(text, size)];
      const gap = space(SPACE.bin * size);
      return [gap, this.glyph(text, size), gap];
    }
    if (token.value === '*') {
      const gap = space(SPACE.mul * size);
      return [gap, this.glyph(token.glyph ?? '×', size), gap];
    }
    if (token.value === '/') return [this.glyph('/', size)];
    throw new Unsupported();
  }

  // 지수는 0.45em 올리되, 밑이 높으면(괄호로 감싼 분수 등) 밑의 위 끝 근처까지 올린다.
  scripted(size) {
    let box = this.atom(size);
    while (this.isOp('^')) {
      this.next();
      const raise = Math.max(RAISE * size, box.ascent - SUP_DROP * size);
      box = row([box, shift(this.script(size), raise)]);
    }
    return box;
  }

  script(size) {
    const small = this.scriptSize(size, SCALE.sup);
    if (this.isOp('-')) {
      this.next();
      return row([this.glyph('−', small), this.scriptUnit(small)]);
    }
    return this.scriptUnit(small);
  }

  // 첨자 한 단위. 첨자를 묶는 { } 와 ( ) 는 그리지 않는다.
  scriptUnit(size) {
    if (this.isType('lbrace')) return this.group(size, 'lbrace', 'rbrace');
    if (this.isType('lparen')) return this.group(size, 'lparen', 'rparen');
    return this.scripted(size);
  }

  atom(size) {
    const t = this.peek();
    if (!t) throw new Unsupported();
    switch (t.type) {
      case 'lbrace': return this.group(size, 'lbrace', 'rbrace');
      case 'lparen': return fence(this.ctx, '(', ')', this.group(size, 'lparen', 'rparen'), size);
      case 'barOpen': return fence(this.ctx, '|', '|', this.group(size, 'barOpen', 'barClose'), size);
      case 'frac': {
        this.next();
        const inner = this.scriptSize(size, SCALE.frac);
        const num = this.group(inner, 'lbrace', 'rbrace');
        const den = this.group(inner, 'lbrace', 'rbrace');
        return frac(num, den, size);
      }
      case 'fn':
        this.next();
        return this.func(t, size);
      case 'num':
        this.next();
        return this.glyph(this.numberText(t), size);
      case 'var':
        this.next();
        return this.glyph(t.value, size, true);
      case 'const':
        this.next();
        return t.value === 'pi' ? this.glyph('π', size) : this.glyph(t.value, size, true);
      default:
        throw new Unsupported();
    }
  }

  func(token, size) {
    if (token.value === 'sqrt') return this.root(size);
    let head = this.glyph(token.name ?? token.value, size);
    if (this.isType('sub')) {
      this.next();
      head = row([head, shift(this.scriptUnit(this.scriptSize(size, SCALE.sup)), -DROP * size)]);
    }
    if (this.isOp('^')) {
      this.next();
      head = row([head, shift(this.script(size), RAISE * size)]);
    }
    // 괄호 인수는 바로 붙이고, 그 밖의 인수 앞은 조금 띄운다(sin x).
    return this.isType('lparen') ? head : row([head, space(SPACE.fn * size)]);
  }

  root(size) {
    let index = null;
    if (this.isType('lbrack')) index = this.group(this.scriptSize(size, SCALE.index), 'lbrack', 'rbrack');
    let body;
    if (this.isType('lbrace')) body = this.group(size, 'lbrace', 'rbrace');
    else if (this.isType('lparen')) body = this.group(size, 'lparen', 'rparen');
    else body = this.atom(size);
    return radical(body, index, size);
  }
}

function expression(ctx, src, size, slots) {
  const layout = new MathLayout(ctx, src, size, slots);
  const box = layout.rowUntil(size, []);
  if (!layout.atEnd()) throw new Unsupported();
  return box;
}

// 라벨 글 전체를 조판한다. 'y=…', 'f(x)=…', 식만, 이름만 모두 받는다.
// 조판할 수 없으면 예외 대신 한 줄 조판으로 돌려준다.
export function layoutMath(ctx, text, { fontSize, slots = false }) {
  try {
    const eq = text.indexOf('=');
    if (eq >= 0) {
      const left = text.slice(0, eq);
      // 좌변이 이름이면 그대로, 식이면(음함수 x^2+y^2=4) 식으로 조판한다.
      const leftBox = NAME_LEFT.test(left)
        ? plainRow(ctx, left.trim(), fontSize)
        : expression(ctx, left, fontSize, slots);
      const gap = space(SPACE.rel * fontSize);
      return row([
        leftBox,
        gap, glyph(ctx, '=', fontSize), gap,
        expression(ctx, text.slice(eq + 1), fontSize, slots),
      ]);
    }
    return expression(ctx, text, fontSize, slots);
  } catch {
    return plainRow(ctx, text, fontSize);
  }
}

export function drawMath(ctx, text, x, baselineY, { fontSize, color = '#000', lineScale = 1, slots = false }) {
  ctx.save();
  const box = layoutMath(ctx, text, { fontSize, slots });
  box.draw(ctx, x, baselineY, { color, lineScale });
  ctx.restore();
  return box;
}
