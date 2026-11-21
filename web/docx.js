// Read only the main document. No relationships, embedded objects or URLs are opened.
const WordReader = (() => {
  const limit = 12 * 1024 * 1024;
  const namespaces = new Set([
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main"
  ]);
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  function tag(node) { return namespaces.has(node.namespaceURI) ? node.localName : ""; }
  function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  }
  async function mainPart(file) {
    if (file.size > 25 * 1024 * 1024) throw Error("请选择 25 MB 以内的 .docx 文件。");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const u16 = p => view.getUint16(p, true);
    const u32 = p => view.getUint32(p, true);
    let end = bytes.length - 22;
    const floor = Math.max(0, end - 65535);
    for (; end >= floor; end--) {
      if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
    }
    if (end < floor) throw Error("无法读取文档。请用 Word 另存为未加密的 .docx。");
    let p = u32(end + 16);
    for (let i = 0; i < u16(end + 10); i++) {
      if (u32(p) !== 0x02014b50) throw Error("Word 文件目录损坏。");
      const nameLen = u16(p + 28);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (name === "word/document.xml") {
        const method = u16(p + 10), size = u32(p + 24), packed = u32(p + 20);
        if (size > limit || u16(p + 8) & 1) throw Error("正文超出读取上限，或文档已加密。");
        const local = u32(p + 42);
        if (u32(local) !== 0x04034b50) throw Error("Word 压缩包损坏。");
        const start = local + 30 + u16(local + 26) + u16(local + 28);
        if (start + packed > bytes.length) throw Error("Word 压缩包不完整。");
        let data = bytes.subarray(start, start + packed);
        if (method === 8) {
          const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
          const reader = stream.getReader();
          const out = new Uint8Array(size);
          let offset = 0;
          for (;;) {
            const {value, done} = await reader.read();
            if (done) break;
            if (offset + value.length > size) { await reader.cancel(); throw Error("正文长度异常。"); }
            out.set(value, offset);
            offset += value.length;
          }
          if (offset !== size) throw Error("正文数据不完整。");
          data = out;
        } else if (method !== 0) throw Error("不支持这种压缩方式，请另存为普通 .docx。");
        if (data.length !== size || crc32(data) !== u32(p + 16)) throw Error("正文校验失败。");
        if (data[0] === 255 && data[1] === 254) return new TextDecoder("utf-16le").decode(data);
        if (data[0] === 254 && data[1] === 255) return new TextDecoder("utf-16be").decode(data);
        return utf8.decode(data);
      }
      p += 46 + nameLen + u16(p + 30) + u16(p + 32);
    }
    throw Error("未找到 Word 正文。请选择标准 .docx 文件。");
  }
  function extract(xml) {
    if (/<!DOCTYPE/i.test(xml)) throw Error("文档 XML 含不支持的声明。");
    const dom = new DOMParser().parseFromString(xml, "application/xml");
    const body = Array.from(dom.documentElement.children).find(n => tag(n) === "body");
    if (!body || tag(dom.documentElement) !== "document") throw Error("Word 正文结构异常。");
    let paragraphs = 0, tables = 0;
    const children = n => Array.from(n.children);
    const transparent = new Set(["hyperlink","smartTag","ins","moveTo","sdt","sdtContent","customXml","fldSimple","dir","bdo"]);
    function inline(n) {
      const t = tag(n);
      if (t === "t") return n.textContent;
      if (t === "tab") return "\t";
      if (t === "br" || t === "cr") return "\n";
      if (t === "r") {
        const props = children(n).find(x => tag(x) === "rPr");
        if (props && children(props).some(x => ["vanish","webHidden"].includes(tag(x)) &&
          !["0","off","false"].includes(x.getAttributeNS(x.namespaceURI, "val")))) return "";
      }
      return t === "r" || transparent.has(t) ? children(n).map(inline).join("") : "";
    }
    function blocks(parent) {
      const lines = [];
      for (const n of children(parent)) {
        const t = tag(n);
        if (t === "p") {
          const value = children(n).map(inline).join("").trim();
          if (value) { paragraphs++; lines.push(value); }
        } else if (t === "tbl") {
          tables++;
          for (const row of children(n).filter(x => tag(x) === "tr")) {
            const cells = children(row).filter(x => tag(x) === "tc").map(cell => blocks(cell).join(" / "));
            if (cells.some(Boolean)) lines.push(cells.join(" ｜ "));
          }
        } else if (transparent.has(t)) lines.push(...blocks(n));
      }
      return lines;
    }
    const text = blocks(body).join("\n");
    if (!text) throw Error("没有读到正文或普通表格。图片中的文字需要手动输入。");
    if (text.length > 60000) throw Error("单次最多处理 6 万字符，请按章节拆分文档。");
    return {text, paragraphs, tables};
  }
  return {read: async file => extract(await mainPart(file)), extract};
})();
