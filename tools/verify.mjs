#!/usr/bin/env node
/* B1-4：零依赖静态闸门（Node ESM，不用 npm 包；本地手动跑，不接 CI）
     node tools/verify.mjs
   检查项：内联 <script> 语法 / index.html 体积 / 重复 id / 版本一致 / 内联脚本非空。
   每项输出 PASS/FAIL 与实测值；任一 FAIL 时 process.exit(1)。 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = path.join(ROOT, 'index.html');
const CSPROJ_PATH = path.join(ROOT, 'host', 'SoloChatHost.csproj');

const LIMIT_BYTES = 1048576;   // 1 MiB
const LIMIT_LINES = 18000;

const checks = [];
function add(name, ok, measured, detail) {
  checks.push({ name, ok: !!ok, measured: String(measured), detail: detail || '' });
}

let htmlBuf, text, csproj;
try {
  htmlBuf = fs.readFileSync(HTML_PATH);
  text = htmlBuf.toString('utf8');
  csproj = fs.readFileSync(CSPROJ_PATH, 'utf8');
} catch (e) {
  add('读取 index.html / host/SoloChatHost.csproj', false, '读取失败', String(e && e.message || e));
  report();
}

/* ---- 抽取内联 <script>（跳过带 src 的外链脚本） ---- */
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const scripts = [];
let sm;
while ((sm = SCRIPT_RE.exec(text)) !== null) {
  const attrs = sm[1] || '';
  if (/\bsrc\s*=/i.test(attrs)) continue;
  scripts.push({
    no: scripts.length + 1,
    line: text.slice(0, sm.index).split('\n').length,
    body: sm[2] || ''
  });
}

/* 1. 逐段 new Function 做语法校验（只编译，不执行） */
const syntaxErrors = [];
for (const s of scripts) {
  try {
    new Function(s.body);
  } catch (e) {
    syntaxErrors.push('第 ' + s.no + ' 段（第 ' + s.line + ' 行）：' + (e && e.message || e));
  }
}
add('1. 内联 <script> 语法（new Function）',
  scripts.length > 0 && syntaxErrors.length === 0,
  scripts.length + ' 段，解析失败 ' + syntaxErrors.length + ' 段',
  syntaxErrors.join('\n     '));

/* 2. 字节数 */
const bytes = htmlBuf.length;
add('2. index.html 字节数 ≤ ' + LIMIT_BYTES, bytes <= LIMIT_BYTES,
  bytes + ' 字节（上限 ' + LIMIT_BYTES + '）', '');

/* 3. 行数（末尾换行不计入最后一行） */
const parts = text.split(/\r?\n/);
if (parts.length && parts[parts.length - 1] === '') parts.pop();
const lines = parts.length;
add('3. index.html 行数 ≤ ' + LIMIT_LINES, lines <= LIMIT_LINES,
  lines + ' 行（上限 ' + LIMIT_LINES + '）', '');

/* 4. HTML 标记里没有重复 id —— 先剥掉 script/style/注释，避免把 JS 字符串里的 id="..." 当标记 */
const markup = text
  .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const tags = markup.match(/<[a-zA-Z][^>]*>/g) || [];
const ID_RE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ids = [];
for (const tag of tags) {
  const im = ID_RE.exec(tag);
  if (im) ids.push(im[1] || im[2] || im[3]);
}
const seen = Object.create(null);
const dups = [];
for (const id of ids) {
  if (seen[id]) dups.push(id);
  seen[id] = 1;
}
add('4. HTML 无重复 id', dups.length === 0,
  '标记 ' + tags.length + ' 个，id ' + ids.length + ' 个（唯一 ' + Object.keys(seen).length + '），重复 ' + dups.length + ' 个',
  dups.length ? '重复 id：' + Array.from(new Set(dups)).join(', ') : '');

/* 5. APP_VER 与 csproj <Version> 一致（APP_VER 形如 v0.3.93，去掉前导 v 再比） */
const av = /\bAPP_VER\s*=\s*['"]([^'"]+)['"]/.exec(text);
const cv = /<Version>\s*([^<]+?)\s*<\/Version>/.exec(csproj);
const appVer = av ? av[1].replace(/^v/i, '') : null;
const csVer = cv ? cv[1].trim() : null;
add('5. APP_VER == host/SoloChatHost.csproj <Version>',
  !!appVer && !!csVer && appVer === csVer,
  'index.html=' + (appVer || '未找到') + ' / csproj=' + (csVer || '未找到'),
  (!appVer ? 'index.html 里没找到 APP_VER；' : '') + (!csVer ? 'csproj 里没找到 <Version>；' : ''));

/* 6. 每个内联脚本非空 */
const empty = scripts.filter(function (s) { return !s.body.trim(); });
const minLen = scripts.length ? Math.min.apply(null, scripts.map(function (s) { return s.body.trim().length; })) : 0;
add('6. 每个内联 <script> 非空', scripts.length > 0 && empty.length === 0,
  scripts.length + ' 段，最短 ' + minLen + ' 字符，空段 ' + empty.length + ' 个',
  empty.length ? '空段行号：' + empty.map(function (s) { return s.line; }).join(', ') : '');

report();

function report() {
  console.log('SoloChat 静态校验 · tools/verify.mjs');
  console.log('index.html: ' + HTML_PATH);
  console.log('');
  for (const c of checks) {
    console.log('[' + (c.ok ? 'PASS' : 'FAIL') + '] ' + c.name + ' — ' + c.measured);
    if (!c.ok && c.detail) console.log('       ' + c.detail);
  }
  const failed = checks.filter(function (c) { return !c.ok; }).length;
  console.log('');
  console.log('合计 ' + checks.length + ' 项，PASS ' + (checks.length - failed) + ' / FAIL ' + failed);
  if (failed) process.exit(1);
  console.log('全部通过。');
}
