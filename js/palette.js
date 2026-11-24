// 식 입력칸 위 LaTeX 버튼 팔레트의 계산. DOM 에 의존하지 않는다.
// 버튼 얼굴(face)은 typeset.js 가 빈 칸을 □ 로 그려 보여 준다.

export const PALETTE = [
  { id: 'frac', group: 'structure', snippet: '\\frac{}{}', face: '\\frac{}{}', title: '\\frac{}{} — 분수' },
  { id: 'sqrt', group: 'structure', snippet: '\\sqrt{}', face: '\\sqrt{}', title: '\\sqrt{} — 제곱근' },
  { id: 'root', group: 'structure', snippet: '\\sqrt[]{}', face: '\\sqrt[]{}', title: '\\sqrt[n]{} — n제곱근' },
  { id: 'pow', group: 'structure', snippet: '^{}', face: '{}^{}', title: '^{} — 지수' },
  { id: 'pi', group: 'symbol', snippet: '\\pi', face: '\\pi', title: '\\pi — 원주율 π' },
  { id: 'abs', group: 'symbol', snippet: '\\left|\\right|', face: '\\left|{}\\right|', title: '\\left| \\right| — 절댓값' },
  { id: 'paren', group: 'symbol', snippet: '\\left(\\right)', face: '\\left({}\\right)', title: '\\left( \\right) — 크기 맞춤 괄호' },
  { id: 'cdot', group: 'symbol', snippet: '\\cdot ', face: '\\cdot', title: '\\cdot — 곱하기 점' },
];

// i 가 빈 칸인가: {} [] 의 사이, 또는 \left( \left| 바로 뒤에 \right 가 오는 자리.
export function isSlot(text, i) {
  if ((text[i - 1] === '{' || text[i - 1] === '[') && (text[i] === '}' || text[i] === ']')) return true;
  return /\\left[(|]$/.test(text.slice(0, i)) && text.startsWith('\\right', i);
}

function slotsOf(text) {
  const out = [];
  for (let i = 1; i <= text.length; i += 1) {
    if (isSlot(text, i)) out.push(i);
  }
  return out;
}

// 선택 [start, end) 를 문구로 바꾼다. 선택한 글자는 첫 빈 칸에 넣는다.
export function insertSnippet(value, start, end, snippet) {
  const selected = value.slice(start, end);
  const slots = slotsOf(snippet);
  let insert = snippet;
  let cursor;
  if (slots.length === 0) {
    cursor = start + snippet.length;
  } else if (selected) {
    insert = snippet.slice(0, slots[0]) + selected + snippet.slice(slots[0]);
    cursor = slots.length > 1 ? start + slots[1] + selected.length : start + insert.length;
  } else {
    cursor = start + slots[0];
  }
  return { text: value.slice(0, start) + insert + value.slice(end), insert, from: start, to: end, cursor };
}

// 커서 뒤, 같은 줄에서 다음 빈 칸. 없으면 null.
export function nextSlot(value, cursor) {
  const lineEnd = value.indexOf('\n', cursor);
  const stop = lineEnd === -1 ? value.length : lineEnd;
  for (let i = cursor + 1; i <= stop; i += 1) {
    if (isSlot(value, i)) return i;
  }
  return null;
}
