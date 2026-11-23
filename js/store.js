// 작업 중 상태를 브라우저에 백업한다.
// 저장소를 인자로 받아 Node 에서 시험할 수 있게 한다.
// 사생활 보호 창이나 사이트 데이터를 막은 환경에서는 접근 자체가 던지므로
// 모든 호출을 try 로 감싼다.

export const BACKUP_KEY = 'exam-graph-tool.backup.v1';

export function saveBackup(storage, payload) {
  if (!storage) return false;
  try {
    storage.setItem(BACKUP_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadBackup(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(BACKUP_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearBackup(storage) {
  if (!storage) return;
  try {
    storage.removeItem(BACKUP_KEY);
  } catch {
    // 지우지 못해도 할 수 있는 일이 없다.
  }
}

// 백업을 폼 값과 곡선 설정·보조선으로 나눈다. 예전 백업에는 뒤의 두 필드가
// 없으므로 기본값을 채운다. 모양이 어긋나도 화면이 멈추지 않게 한다.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPoint = (q) => isObj(q) && Number.isFinite(q.x) && Number.isFinite(q.y);

// 읽을 수 없는 보조선은 버린다. 하나라도 어긋나면 그리는 쪽이 던져 화면이 멈춘다.
function isValidGuide(a) {
  if (!isObj(a) || a.type !== 'guide') return false;
  if (!Array.isArray(a.pts) || a.pts.length !== 2 || !a.pts.every(isPoint)) return false;
  if (!isObj(a.style)) return false;
  if (a.mark === null) return true;
  return isObj(a.mark) && (a.mark.axis === 'x' || a.mark.axis === 'y')
    && Number.isFinite(a.mark.value) && typeof a.mark.text === 'string';
}

export function normalizeBackup(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { curveStyles, annots, ...form } = payload;
  const isPlainObject = curveStyles && typeof curveStyles === 'object' && !Array.isArray(curveStyles);
  return {
    form,
    curveStyles: isPlainObject ? curveStyles : {},
    annots: Array.isArray(annots) ? annots.filter(isValidGuide) : [],
  };
}

// ---------- 그래프 파일 ----------
// 그린 그림을 사용자 컴퓨터의 파일(.graph.json)로 저장하고 불러온다.
// 형식 표시와 버전을 넣어 다른 JSON 이나 나중 형식을 가려낸다.

export const GRAPH_FILE_FORMAT = 'exam-graph-tool';
export const GRAPH_FILE_VERSION = 1;

export function toGraphFile(payload, savedAt = new Date().toISOString()) {
  const { curveStyles = {}, annots = [], ...form } = payload;
  return {
    format: GRAPH_FILE_FORMAT,
    version: GRAPH_FILE_VERSION,
    savedAt,
    form,
    curveStyles,
    annots,
  };
}

// 읽을 수 없으면 까닭을 담은 Error 를 던진다. 보조선 검사는 백업과 같다.
export function fromGraphFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('그래프 파일로 읽을 수 없다. JSON 형식이 깨졌다');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== GRAPH_FILE_FORMAT) {
    throw new Error('그래프 도구 파일이 아니다');
  }
  if (!(Number(data.version) <= GRAPH_FILE_VERSION)) {
    throw new Error('더 새 버전의 그래프 도구에서 만든 파일이다. 도구를 새로 고친 뒤 다시 연다');
  }
  const form = data.form && typeof data.form === 'object' && !Array.isArray(data.form) ? data.form : {};
  return normalizeBackup({ ...form, curveStyles: data.curveStyles, annots: data.annots });
}
