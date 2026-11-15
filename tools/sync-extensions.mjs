#!/usr/bin/env node
/*
 * 把外部的 extensions/plugins（运行时 + 市场清单）同步到 dist/plugins。
 * 主应用仓库不保存扩展运行时；扩展目录是独立 Git 仓库。
 *
 * 用法：node tools/sync-extensions.mjs
 * 缺失扩展目录时只警告不失败，便于单独 clone 主应用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(ROOT, '..', 'extensions', 'plugins');
const DST = path.join(ROOT, 'dist', 'plugins');
const STRICT = process.argv.includes('--strict');

if (!fs.existsSync(SRC)) {
  const msg = '没有找到外部扩展目录：' + SRC;
  if (STRICT) { console.error('EXT SYNC FAIL: ' + msg); process.exit(1); }
  console.warn('EXT SYNC SKIP: ' + msg);
  process.exit(0);
}

fs.mkdirSync(DST, { recursive: true });
fs.cpSync(SRC, DST, { recursive: true, force: true });
const files = fs.readdirSync(DST);
console.log('EXT SYNC OK', path.relative(ROOT, DST), files.join(', '));
