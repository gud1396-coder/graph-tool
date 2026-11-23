// 주석 상태의 되돌리기·다시 하기 스택. 스냅샷은 깊은 복사로 보관한다.

const clone = (value) => JSON.parse(JSON.stringify(value));

export function makeHistory(limit = 50) {
  const past = [];
  const future = [];
  return {
    record(before) {
      past.push(clone(before));
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo(current) {
      if (past.length === 0) return null;
      future.push(clone(current));
      return past.pop();
    },
    redo(current) {
      if (future.length === 0) return null;
      past.push(clone(current));
      return future.pop();
    },
  };
}
