// 시험 출제용 그래프 도구 — 수식 토크나이저 · 파서 · 평가기
//
// 로그 규약이 JavaScript 기본값과 다르다.
//   log(x)    상용로그 (밑 10)
//   ln(x)     자연로그
//   log(a, x) 밑이 a인 로그

export class ParseError extends Error {
  constructor(message, pos) {
    super(message);
    this.name = 'ParseError';
    this.pos = pos;
  }
}

export const FUNCTION_NAMES = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh',
  'exp', 'sqrt', 'cbrt', 'abs', 'floor', 'ceil', 'round', 'sign',
  'min', 'max', 'log', 'ln',
]);

export const CONSTANT_NAMES = new Set(['pi', 'e']);

// 최장 일치를 위해 긴 이름부터 본다.
const NAMES_BY_LENGTH = [...FUNCTION_NAMES, ...CONSTANT_NAMES]
  .sort((a, b) => b.length - a.length);

const OPERATORS = new Set(['+', '-', '*', '/', '^']);

// LaTeX 함수 명령 → 이 앱의 함수 이름.
const LATEX_FUNCTIONS = {
  sin: 'sin', cos: 'cos', tan: 'tan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  arcsin: 'asin', arccos: 'acos', arctan: 'atan',
  exp: 'exp', ln: 'ln', log: 'log', sqrt: 'sqrt',
};

// \ 다음의 명령 이름을 읽는다. \left \right 는 뒤따르는 괄호 글자까지 읽는다.
function readCommand(src, i) {
  const match = /^[A-Za-z]+/.exec(src.slice(i + 1));
  if (!match) {
    throw new ParseError(`지원하지 않는 명령 '\\${src[i + 1] ?? ''}'`, i);
  }
  const name = match[0];
  const end = i + 1 + name.length;
  if (name !== 'left' && name !== 'right') return { name, end };
  let j = end;
  while (src[j] === ' ') j += 1;
  const fence = src[j];
  if (fence !== '(' && fence !== ')' && fence !== '|') {
    throw new ParseError(`\\${name} 뒤에는 ( ) | 만 쓴다`, i);
  }
  return { name, fence, end: j + 1 };
}

function commandToken(name, pos) {
  if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
    return { type: 'frac', value: `\\${name}`, pos };
  }
  if (name === 'pi') return { type: 'const', value: 'pi', pos };
  if (name === 'cdot') return { type: 'op', value: '*', glyph: '·', pos };
  if (name === 'times') return { type: 'op', value: '*', glyph: '×', pos };
  const fn = LATEX_FUNCTIONS[name];
  if (fn) return { type: 'fn', value: fn, name, latex: true, pos };
  throw new ParseError(`지원하지 않는 명령 '\\${name}'`, pos);
}

// 앞 토큰이 값의 끝이고 뒤 토큰이 값의 시작이면 곱셈을 끼워 넣는다.
const ENDS_VALUE = new Set(['num', 'var', 'const', 'rparen', 'barClose']);
const STARTS_VALUE = new Set(['num', 'var', 'const', 'fn', 'lparen', 'barOpen']);

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function isLetter(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function rawTokens(src) {
  const out = [];
  let i = 0;
  let barOpen = false;
  let inBracket = false;

  while (i < src.length) {
    const ch = src[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
      const start = i;
      while (i < src.length && isDigit(src[i])) i += 1;
      if (src[i] === '.') {
        i += 1;
        while (i < src.length && isDigit(src[i])) i += 1;
      }
      out.push({ type: 'num', value: Number(src.slice(start, i)), pos: start });
      continue;
    }

    if (isLetter(ch)) {
      const name = NAMES_BY_LENGTH.find((n) => src.startsWith(n, i));
      if (name) {
        out.push({
          type: FUNCTION_NAMES.has(name) ? 'fn' : 'const',
          value: name,
          pos: i,
        });
        i += name.length;
      } else {
        out.push({ type: 'var', value: ch, pos: i });
        i += 1;
      }
      continue;
    }

    if (ch === '\\') {
      const cmd = readCommand(src, i);
      if (cmd.fence === '|') {
        const opening = cmd.name === 'left';
        if (opening && barOpen) throw new ParseError('절대값 막대는 겹쳐 쓸 수 없다', i);
        if (!opening && !barOpen) throw new ParseError("\\right| 에 맞는 '\\left|' 가 없다", i);
        out.push({ type: opening ? 'barOpen' : 'barClose', value: '|', pos: i, sized: true });
        barOpen = opening;
      } else if (cmd.fence) {
        out.push({ type: cmd.fence === '(' ? 'lparen' : 'rparen', value: cmd.fence, pos: i, sized: true });
      } else {
        out.push(commandToken(cmd.name, i));
      }
      i = cmd.end;
      continue;
    }

    if (ch === '{') { out.push({ type: 'lbrace', value: '{', pos: i }); i += 1; continue; }
    if (ch === '}') { out.push({ type: 'rbrace', value: '}', pos: i }); i += 1; continue; }
    if (ch === '_') { out.push({ type: 'sub', value: '_', pos: i }); i += 1; continue; }

    if (ch === '[') {
      const prev = out[out.length - 1];
      if (prev && prev.type === 'fn' && prev.value === 'sqrt' && prev.latex) {
        out.push({ type: 'lbrack', value: '[', pos: i });
        inBracket = true;
        i += 1;
        continue;
      }
    }
    if (ch === ']' && inBracket) {
      out.push({ type: 'rbrack', value: ']', pos: i });
      inBracket = false;
      i += 1;
      continue;
    }

    if (OPERATORS.has(ch)) {
      out.push({ type: 'op', value: ch, pos: i });
      i += 1;
      continue;
    }

    if (ch === '(') { out.push({ type: 'lparen', value: '(', pos: i }); i += 1; continue; }
    if (ch === ')') { out.push({ type: 'rparen', value: ')', pos: i }); i += 1; continue; }
    if (ch === ',') { out.push({ type: 'comma', value: ',', pos: i }); i += 1; continue; }

    if (ch === '|') {
      // 절대값 막대는 여는 것과 닫는 것이 번갈아 나온다. 중첩은 지원하지 않는다.
      out.push({ type: barOpen ? 'barClose' : 'barOpen', value: '|', pos: i });
      barOpen = !barOpen;
      i += 1;
      continue;
    }

    throw new ParseError(`쓸 수 없는 기호 '${ch}'`, i);
  }

  if (barOpen) {
    throw new ParseError('절대값 막대가 닫히지 않았다', src.length);
  }

  return out;
}

// \log_2 x 의 밑, \sin^2 x 의 지수처럼 함수에 붙은 한 토큰짜리 첨자 바로 뒤에는 곱셈을
// 끼우지 않는다. 그 다음 토큰은 함수의 인수다.
function isScriptEnd(out) {
  const n = out.length;
  const before = out[n - 2];
  if (before && before.type === 'sub') return true;
  const fn = out[n - 3];
  return Boolean(before && fn && before.type === 'op' && before.value === '^' && fn.type === 'fn');
}

function insertImplicitMultiply(tokens) {
  const out = [];
  for (const token of tokens) {
    const prev = out[out.length - 1];
    if (prev && ENDS_VALUE.has(prev.type) && STARTS_VALUE.has(token.type) && !isScriptEnd(out)) {
      out.push({ type: 'op', value: '*', pos: token.pos, implicit: true });
    }
    out.push(token);
  }
  return out;
}

export function tokenize(src) {
  return insertImplicitMultiply(rawTokens(src));
}

const ARITY = {
  min: [2, 2],
  max: [2, 2],
  log: [1, 2],
};

function arityOf(name) {
  return ARITY[name] ?? [1, 1];
}

const INVERSE_NAMES = { sin: '\\arcsin', cos: '\\arccos', tan: '\\arctan' };

function isMinusOne(node) {
  return node.type === 'unary' && node.arg.type === 'num' && node.arg.value === 1;
}

// 식 안에 홀로 남은 토큰을 알리는 말.
function strayMessage(token, fallback) {
  if (token.type === 'rbrace') return "여는 중괄호 없이 '}'";
  if (token.type === 'sub') return '첨자 _ 는 \\log_a 에서만 쓴다';
  return fallback;
}

class Parser {
  constructor(tokens, allowedVars, src) {
    this.tokens = tokens;
    this.allowed = new Set(allowedVars);
    this.src = src;
    this.i = 0;
  }

  peek() {
    return this.tokens[this.i];
  }

  next() {
    return this.tokens[this.i++];
  }

  atEnd() {
    return this.i >= this.tokens.length;
  }

  endPos() {
    return this.src.length;
  }

  expect(type, what) {
    const token = this.peek();
    if (!token || token.type !== type) {
      throw new ParseError(`${what}가 필요하다`, token ? token.pos : this.endPos());
    }
    return this.next();
  }

  isOp(value) {
    const token = this.peek();
    return Boolean(token) && token.type === 'op' && token.value === value;
  }

  isType(type) {
    const token = this.peek();
    return Boolean(token) && token.type === type;
  }

  // 중괄호가 걸린 생략된 곱셈. 토크나이저는 중괄호를 모르므로 여기서 읽는다.
  implicitNext() {
    const token = this.peek();
    if (!token) return false;
    if (token.type === 'frac' || token.type === 'lbrace') return true;
    const prev = this.tokens[this.i - 1];
    return Boolean(prev) && prev.type === 'rbrace' && STARTS_VALUE.has(token.type);
  }

  // { … } 묶음. 빈 묶음은 팔레트로 넣고 아직 채우지 않은 칸이다.
  parseGroup() {
    const open = this.expect('lbrace', "여는 중괄호 '{'");
    if (this.isType('rbrace')) throw new ParseError('빈 칸 {}', open.pos);
    const inner = this.parseExpression();
    this.expect('rbrace', "닫는 중괄호 '}'");
    return inner;
  }

  parseFrac() {
    const token = this.next();
    const need = '\\frac 에는 {분자}{분모} 두 칸이 필요하다';
    if (!this.isType('lbrace')) throw new ParseError(need, token.pos);
    const num = this.parseGroup();
    if (!this.isType('lbrace')) throw new ParseError(need, token.pos);
    const den = this.parseGroup();
    return { type: 'binary', op: '/', left: num, right: den };
  }

  // 함수 인수: (…, …) 목록, {…} 묶음, 또는 괄호 없는 항.
  parseArguments() {
    const args = [];
    if (this.isType('lparen')) {
      this.next();
      args.push(this.parseExpression());
      while (this.isType('comma')) {
        this.next();
        args.push(this.parseExpression());
      }
      this.expect('rparen', "닫는 괄호 ')'");
    } else if (this.isType('lbrace')) {
      args.push(this.parseGroup());
    } else {
      args.push(this.parseTerm(true));
    }
    return args;
  }

  // \log_ 의 밑: {…} 묶음이나 숫자·변수·상수 토큰 하나.
  parseLogBase() {
    if (this.isType('lbrace')) return this.parseGroup();
    const token = this.peek();
    if (!token || !['num', 'var', 'const'].includes(token.type)) {
      throw new ParseError('\\log_ 뒤에 밑이 필요하다', token ? token.pos : this.endPos());
    }
    return this.parsePrimary();
  }

  parseRoot(token) {
    const open = this.next();
    const bad = () => new ParseError('\\sqrt[n] 의 n 은 2 이상의 정수', open.pos);
    const n = this.peek();
    if (!n || n.type !== 'num' || !Number.isInteger(n.value) || n.value < 2) throw bad();
    this.next();
    if (!this.isType('rbrack')) throw bad();
    this.next();
    const args = this.parseArguments();
    if (args.length !== 1) throw new ParseError('sqrt 의 인수는 1개여야 한다', token.pos);
    return { type: 'call', name: 'root', args: [{ type: 'num', value: n.value }, args[0]] };
  }

  parseExpression() {
    let left = this.parseTerm();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value;
      left = { type: 'binary', op, left, right: this.parseTerm() };
    }
    return left;
  }

  // stopAtFunction 이 참이면 다음 인수가 함수일 때 멈춘다.
  // 괄호 없는 함수 호출에서 'sin x cos x' 를 sin(x)*cos(x) 로 읽기 위한 장치다.
  parseTerm(stopAtFunction = false) {
    let left = this.parseUnary();
    for (;;) {
      let op;
      if (this.isOp('*') || this.isOp('/')) {
        if (stopAtFunction) {
          const after = this.tokens[this.i + 1];
          if (after && after.type === 'fn') break;
        }
        op = this.next().value;
      } else if (this.implicitNext()) {
        if (stopAtFunction && this.peek().type === 'fn') break;
        op = '*';
      } else {
        break;
      }
      left = { type: 'binary', op, left, right: this.parseUnary() };
    }
    return left;
  }

  parseUnary() {
    if (this.isOp('-')) {
      this.next();
      return { type: 'unary', op: '-', arg: this.parseUnary() };
    }
    if (this.isOp('+')) {
      this.next();
      return this.parseUnary();
    }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePrimary();
    if (this.isOp('^')) {
      this.next();
      return { type: 'binary', op: '^', left: base, right: this.parseUnary() };
    }
    return base;
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) {
      throw new ParseError('수식이 끝나지 않았다', this.endPos());
    }

    if (token.type === 'num') {
      this.next();
      return { type: 'num', value: token.value };
    }

    if (token.type === 'const') {
      this.next();
      return { type: 'const', name: token.value };
    }

    if (token.type === 'var') {
      this.next();
      if (!this.allowed.has(token.value)) {
        throw new ParseError(`쓸 수 없는 변수 '${token.value}'`, token.pos);
      }
      return { type: 'var', name: token.value };
    }

    if (token.type === 'lparen') {
      this.next();
      const inner = this.parseExpression();
      this.expect('rparen', token.sized ? "\\left( 에 맞는 '\\right)'" : "닫는 괄호 ')'");
      return inner;
    }

    if (token.type === 'barOpen') {
      this.next();
      const inner = this.parseExpression();
      this.expect('barClose', token.sized ? "\\left| 에 맞는 '\\right|'" : "닫는 절대값 막대 '|'");
      return { type: 'call', name: 'abs', args: [inner] };
    }

    if (token.type === 'lbrace') return this.parseGroup();
    if (token.type === 'frac') return this.parseFrac();

    if (token.type === 'fn') {
      return this.parseCall();
    }

    throw new ParseError(strayMessage(token, `여기에 올 수 없는 '${token.value}'`), token.pos);
  }

  parseCall() {
    const token = this.next();
    const name = token.value;

    if (name === 'sqrt' && this.isType('lbrack')) return this.parseRoot(token);

    let base = null;
    if (this.isType('sub')) {
      const sub = this.next();
      if (name !== 'log') throw new ParseError('첨자 _ 는 \\log_a 에서만 쓴다', sub.pos);
      base = this.parseLogBase();
    }

    let power = null;
    if (this.isOp('^')) {
      const caret = this.next();
      power = this.isType('lbrace') ? this.parseGroup() : this.parseUnary();
      if (isMinusOne(power)) {
        const arc = INVERSE_NAMES[name];
        throw new ParseError(arc ? `역함수는 ${arc} x 로 쓴다` : '^{-1} 로 역함수를 나타낼 수 없다', caret.pos);
      }
    }

    const args = this.parseArguments();
    if (base) {
      if (args.length !== 1) throw new ParseError('\\log_a 뒤에는 인수 하나만 쓴다', token.pos);
      args.unshift(base);
    }

    const [min, max] = arityOf(name);
    if (args.length < min || args.length > max) {
      const want = min === max ? `${min}개` : `${min}개 또는 ${max}개`;
      throw new ParseError(`${name} 의 인수는 ${want}여야 한다`, token.pos);
    }

    const call = { type: 'call', name, args };
    return power ? { type: 'binary', op: '^', left: call, right: power } : call;
  }
}

export function parse(src, allowedVars = ['x']) {
  const tokens = tokenize(src);
  if (tokens.length === 0) {
    throw new ParseError('수식이 비어 있다', 0);
  }
  const parser = new Parser(tokens, allowedVars, src);
  const ast = parser.parseExpression();
  if (!parser.atEnd()) {
    const token = parser.peek();
    throw new ParseError(strayMessage(token, `읽을 수 없는 '${token.value}'`), token.pos);
  }
  return ast;
}

const CONSTANT_VALUES = {
  pi: Math.PI,
  e: Math.E,
};

// 한국 교과 규약을 따른다. JavaScript 기본값과 다르므로 바꾸지 않는다.
const UNARY_FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  ln: Math.log,
  log: Math.log10,
};

export function evaluate(node, vars) {
  switch (node.type) {
    case 'num':
      return node.value;

    case 'const':
      return CONSTANT_VALUES[node.name];

    case 'var':
      return vars[node.name];

    case 'unary':
      return -evaluate(node.arg, vars);

    case 'binary': {
      const a = evaluate(node.left, vars);
      const b = evaluate(node.right, vars);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '^': return a ** b;
        default: return NaN;
      }
    }

    case 'call': {
      const name = node.name;
      if (name === 'min' || name === 'max') {
        const a = evaluate(node.args[0], vars);
        const b = evaluate(node.args[1], vars);
        return name === 'min' ? Math.min(a, b) : Math.max(a, b);
      }
      if (name === 'log' && node.args.length === 2) {
        const base = evaluate(node.args[0], vars);
        const value = evaluate(node.args[1], vars);
        return Math.log(value) / Math.log(base);
      }
      if (name === 'root') {
        const n = evaluate(node.args[0], vars);
        const a = evaluate(node.args[1], vars);
        if (n % 2 === 1) return Math.sign(a) * Math.abs(a) ** (1 / n);
        return a < 0 ? NaN : a ** (1 / n);
      }
      const fn = UNARY_FUNCTIONS[name];
      return fn(evaluate(node.args[0], vars));
    }

    default:
      return NaN;
  }
}

export function evalAt(src, x) {
  return evaluate(parse(src), { x });
}
