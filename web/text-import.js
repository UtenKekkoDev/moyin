'use strict';

async function readTextMaterial(file) {
  if (file.size > 256 * 1024) throw Error('单次最多处理 6 万字符，请按章节拆分文本。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  let text;
  try {
    text = new TextDecoder(encoding, {fatal:true}).decode(bytes).replace(/\r\n?/g, '\n');
  } catch {
    throw Error('无法识别文本编码，请另存为 UTF-8 再导入。');
  }
  if (/[\u0000-\u0008\u000e-\u001f]/u.test(text)) throw Error('文件含有二进制数据，请选择纯文本文件。');
  if (!text.trim()) throw Error('没有读到正文。');
  if (text.length > 60000) throw Error('单次最多处理 6 万字符，请按章节拆分文本。');
  return {text, info:text.split('\n').length+' 行 · '+encoding.toUpperCase()};
}
