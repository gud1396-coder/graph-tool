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

function insertImplicitMultiply(tokens) {
  const out = [];
  for (const token of tokens) {
    const prev = out[out.length - 1];
    if (prev && ENDS_VALUE.has(prev.type) && STARTS_VALUE.has(token.type)) {
      out.push({ type: 'op', value: '*', pos: token.pos });
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
    while (this.isOp('*') || this.isOp('/')) {
      if (stopAtFunction) {
        const after = this.tokens[this.i + 1];
        if (after && after.type === 'fn') break;
      }
      const op = this.next().value;
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
      this.expect('rparen', "닫는 괄호 ')'");
      return inner;
    }

    if (token.type === 'barOpen') {
      this.next();
      const inner = this.parseExpression();
      this.expect('barClose', "닫는 절대값 막대 '|'");
      return { type: 'call', name: 'abs', args: [inner] };
    }

    if (token.type === 'fn') {
      return this.parseCall();
    }

    throw new ParseError(`여기에 올 수 없는 '${token.value}'`, token.pos);
  }

  parseCall() {
    const token = this.next();
    const name = token.value;
    const args = [];

    if (this.peek() && this.peek().type === 'lparen') {
      this.next();
      args.push(this.parseExpression());
      while (this.peek() && this.peek().type === 'comma') {
        this.next();
        args.push(this.parseExpression());
      }
      this.expect('rparen', "닫는 괄호 ')'");
    } else {
      args.push(this.parseTerm(true));
    }

    const [min, max] = arityOf(name);
    if (args.length < min || args.length > max) {
      const want = min === max ? `${min}개` : `${min}개 또는 ${max}개`;
      throw new ParseError(`${name} 의 인수는 ${want}여야 한다`, token.pos);
    }

    return { type: 'call', name, args };
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
    throw new ParseError(`읽을 수 없는 '${token.value}'`, token.pos);
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
