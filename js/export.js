// 목표 해상도에서 장면을 다시 그려 PNG 로 내보낸다.
// 화면용 비트맵을 확대하지 않는다.

export function renderToCanvas(createCanvas, drawScene, { width, height, scale = 2 }) {
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d');
  drawScene(ctx, canvas.width, canvas.height, scale);
  return canvas;
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 로 바꾸지 못했다'));
    }, 'image/png');
  });
}

export async function downloadPng(canvas, filename) {
  downloadBlob(await toBlob(canvas), filename);
}

// 브라우저 다운로드로 파일을 내려준다. 그래프 파일 저장의 대체 경로로도 쓴다.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function copyCanvasToClipboard(canvas) {
  // 사용자 제스처 안에서만 불러야 한다. 막히면 던지지 않고 false 를 준다.
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
  try {
    const blob = await toBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
