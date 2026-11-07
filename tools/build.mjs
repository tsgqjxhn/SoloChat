#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const MARK_CSS = '<!--@@CSS@@-->';
const MARK_THEME = '<!--@@JS_THEME@@-->';
const MARK_SVG = '<!--@@SVG_SYMBOLS@@-->';
const MARK_APP = '<!--@@JS_APP@@-->';

function fail(msg) {
  console.error('BUILD FAIL: ' + msg);
  process.exit(1);
}

function readUtf8(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) fail('缺文件: ' + rel);
  return fs.readFileSync(p, 'utf8');
}

function build() {
  const tpl = readUtf8(path.join('src', 'index.template.html'));
  const marks = [MARK_CSS, MARK_THEME, MARK_SVG, MARK_APP];
  for (const m of marks) {
    const n = tpl.split(m).length - 1;
    if (n !== 1) fail('标记 ' + m + ' 出现 ' + n + ' 次（应为 1）');
  }
  const css = readUtf8(path.join('src', 'css', 'app.css'));
  const theme = readUtf8(path.join('src', 'js', '00-theme.js'));
  const svg = readUtf8(path.join('src', 'svg', 'symbols.svg'));
  const appDir = path.join(ROOT, 'src', 'js', 'app');
  if (!fs.existsSync(appDir)) fail('缺目录: src/js/app');
  const segNames = fs.readdirSync(appDir).filter(function (n) { return /\.js$/i.test(n); }).sort();
  if (!segNames.length) fail('src/js/app 下没有 .js 分段文件');
  const app = segNames.map(function (n) { return fs.readFileSync(path.join(appDir, n), 'utf8'); }).join('');

  let out = tpl;
  out = out.replace(MARK_CSS, function () { return css; });
  out = out.replace(MARK_THEME, function () { return theme; });
  out = out.replace(MARK_SVG, function () { return svg; });
  out = out.replace(MARK_APP, function () { return app; });
  return out;
}

try {
  const out = build();
  const bytes = Buffer.byteLength(out, 'utf8');
  if (CHECK) {
    const diskPath = path.join(ROOT, 'index.html');
    if (!fs.existsSync(diskPath)) fail('缺文件: index.html');
    const disk = fs.readFileSync(diskPath, 'utf8');
    if (out === disk) {
      console.log('BUILD OK ' + bytes);
      process.exit(0);
    }
    let off = 0;
    const lim = Math.max(out.length, disk.length);
    while (off < lim && out[off] === disk[off]) off++;
    const ctx = 40;
    console.error('BUILD FAIL: 内容不一致，首个差异偏移 ' + off);
    console.error('disk: ' + JSON.stringify(disk.slice(Math.max(0, off - ctx), off + ctx)));
    console.error('built: ' + JSON.stringify(out.slice(Math.max(0, off - ctx), off + ctx)));
    process.exit(1);
  }
  fs.writeFileSync(path.join(ROOT, 'index.html'), out, 'utf8');
  console.log('BUILD OK ' + bytes);
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}
