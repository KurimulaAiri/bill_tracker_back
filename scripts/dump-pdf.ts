/* eslint-disable no-console */
// 临时工具：输出建行信用卡 PDF Tj 行结构
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as iconv from 'iconv-lite';

const pdfPath = path.resolve(__dirname, '../../../docs/入账示例/xykmx_20260902133648/xykmx_20260902133648.pdf');

function decodeTjBytes(str: string): string {
  // 将 JS 字符串转成字节流：合并 \u0000+ASCII 的 UTF-16BE 形式，其余保留低字节
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 0 && i + 1 < str.length && str.charCodeAt(i + 1) >= 0x20 && str.charCodeAt(i + 1) < 0x7f) {
      i++;
      bytes.push(str.charCodeAt(i));
    } else {
      bytes.push(c & 0xff);
    }
  }
  try {
    return iconv.decode(Buffer.from(bytes), 'gbk');
  } catch {
    return str;
  }
}

// 解码 Tj 内的转义序列
function unescapeTj(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

const data = fs.readFileSync(pdfPath);
const content = data.toString('latin1');
const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
let m: RegExpExecArray | null;
const texts: string[] = [];
while ((m = re.exec(content)) !== null) {
  const raw = m[1];
  try {
    const dec = zlib.inflateSync(Buffer.from(raw, 'latin1'));
    texts.push(dec.toString('latin1'));
  } catch {
    texts.push(raw);
  }
}
const output = texts.join('\n');
const lines = output.split(/\r?\n/);
let curX = 0;
let curY = 0;
const items: { x: number; y: number; text: string }[] = [];
for (const line of lines) {
  let mm = line.match(/^1 0 0 1 ([\d.]+) ([\d.]+) Tm$/);
  if (mm) {
    curX = parseFloat(mm[1]);
    curY = parseFloat(mm[2]);
    continue;
  }
  mm = line.match(/^\((.+)\)\s*Tj$/);
  if (mm) {
    const body = mm[1];
    const unescaped = unescapeTj(body);
    const decoded = decodeTjBytes(unescaped);
    items.push({ x: curX, y: curY, text: decoded });
  }
}
// 聚行 (y 容差 2)
const rows = new Map<number, { x: number; y: number; text: string }[]>();
for (const it of items) {
  let key = -1;
  for (const k of rows.keys()) {
    if (Math.abs(k - it.y) < 2) { key = k; break; }
  }
  if (key === -1) { key = it.y; rows.set(key, []); }
  rows.get(key)!.push(it);
}
const sortedYs = [...rows.keys()].sort((a, b) => b - a); // y 从大到小 = 从上到下
console.log('== 行数:', sortedYs.length, ' 首个y:', sortedYs[0], ' 末个y:', sortedYs[sortedYs.length - 1]);
let count = 0;
for (const y of sortedYs) {
  const row = rows.get(y)!.sort((a, b) => a.x - b.x);
  const joined = row.map((r) => `${Math.round(r.x)}:${r.text}`).join(' | ');
  if (count < 60) console.log(y.toFixed(1), joined.slice(0, 400));
  count++;
}