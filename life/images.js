// 生活园写文章、写园地条目时上传图片。要先加载 life.js（用它的 API、getToken）。
// 会员才能传：初级会员一篇最多 1 张，高级会员最多 9 张。图片在手机上先压缩成 JPEG（长边 1600 像素），
// 再传到服务器，正文里插入一行 ![](图片地址)。
const IMAGE_SIDE = 1600;
const IMAGE_BYTES = 1200 * 1024;
const IMAGE_LEVELS = ['', '初级会员', '高级会员'];

// 正文里已经有几张本站上传的图片（和服务器的算法一样，同一张只算一次）
function countImages(text) {
  const keys = new Set();
  for (const m of text.matchAll(/\/img\/(u\d+\/[0-9a-f]{24}\.(?:jpg|png|webp))\b/g)) keys.add(m[1]);
  return keys.size;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('打不开这张图片，换一张试试'));
    };
    img.src = url;
  });
}

async function shrinkImage(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    source = await loadImage(file);
  }
  const w = source.width, h = source.height;
  const scale = Math.min(1, IMAGE_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // 透明的 PNG 变成白底
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  let blob = null;
  for (const quality of [0.82, 0.7, 0.55]) {
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('这张图片处理不了，换一张试试');
    if (blob.size <= IMAGE_BYTES) break;
  }
  return blob;
}

async function sendImage(blob) {
  const res = await fetch(`${API}/life/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || '上传失败'), { status: res.status });
  return data.url;
}

// textarea：正文框；button：「图片」按钮；hint：说明文字；say：显示提示的函数；unit：每篇 / 每条
function setupImages({ textarea, button, hint, say, onInsert, unit = '篇' }) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.hidden = true;
  button.after(input);
  let limit = 0, level = 0, busy = false;

  function refresh() {
    const used = countImages(textarea.value);
    button.hidden = !limit;
    hint.hidden = !limit;
    button.disabled = busy || used >= limit;
    if (limit) {
      hint.textContent = `${IMAGE_LEVELS[level]}每${unit}最多放 ${limit} 张图片，已放 ${used} 张。`
        + '图片会压缩后插在光标处，方括号里可以写图片说明；删掉那一行就是不要这张图了。';
    }
  }

  function insertLine(url) {
    const head = textarea.value.slice(0, textarea.selectionStart);
    const before = !head ? '' : head.endsWith('\n\n') ? '' : head.endsWith('\n') ? '\n' : '\n\n';
    textarea.setRangeText(`${before}![](${url})\n\n`, textarea.selectionStart, textarea.selectionEnd, 'end');
  }

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    const room = limit - countImages(textarea.value);
    if (!files.length || room <= 0) return;
    if (files.length > room) say(`最多还能放 ${room} 张，只传前 ${room} 张。`);
    busy = true;
    refresh();
    try {
      const chosen = files.slice(0, room);
      for (let i = 0; i < chosen.length; i++) {
        button.textContent = chosen.length > 1 ? `上传中 ${i + 1}/${chosen.length}…` : '上传中…';
        insertLine(await sendImage(await shrinkImage(chosen[i])));
        if (onInsert) onInsert();
      }
      if (files.length <= room) say('图片已插入，记得保存。');
    } catch (err) {
      say(errorText(err));
    }
    busy = false;
    button.textContent = '图片';
    refresh();
  });
  textarea.addEventListener('input', refresh);

  return {
    setLevel(info) {
      level = info.level || 0;
      limit = info.imageLimit || 0;
      refresh();
    },
    refresh,
  };
}
