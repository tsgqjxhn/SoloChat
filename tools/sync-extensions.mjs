#!/usr/bin/env node
/*
 * 把外部的 extensions/ 同步到 dist/：
 *   plugins/  → dist/plugins   （运行时 + 市场清单）
 *   packages/ → dist/packages  （扩展包，并生成市场索引 index.json）
 * 主应用仓库不保存扩展运行时与扩展包；扩展目录是独立 Git 仓库。
 *
 * 用法：node tools/sync-extensions.mjs
 * 缺失扩展目录时只警告不失败，便于单独 clone 主应用；--strict 时改为失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT_ROOT = path.resolve(ROOT, '..', 'extensions');
const PLUGINS_SRC = path.join(EXT_ROOT, 'plugins');
const PACKAGES_SRC = path.join(EXT_ROOT, 'packages');
const PLUGINS_DST = path.join(ROOT, 'dist', 'plugins');
const PACKAGES_DST = path.join(ROOT, 'dist', 'packages');
const STRICT = process.argv.includes('--strict');

function fail(msg) {
  console.error('EXT SYNC FAIL: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(EXT_ROOT)) {
  const msg = '没有找到外部扩展目录：' + EXT_ROOT;
  if (STRICT) fail(msg);
  console.warn('EXT SYNC SKIP: ' + msg);
  process.exit(0);
}

/* ---------- 1. 运行时插件：extensions/plugins → dist/plugins ---------- */
let pluginNote = '未找到，跳过';
if (fs.existsSync(PLUGINS_SRC)) {
  try {
    fs.mkdirSync(PLUGINS_DST, { recursive: true });
    fs.cpSync(PLUGINS_SRC, PLUGINS_DST, { recursive: true, force: true });
    pluginNote = '已同步 ' + fs.readdirSync(PLUGINS_DST).length + ' 项';
  } catch (e) {
    fail('同步 plugins 失败：' + (e && e.message || e));
  }
} else if (STRICT) {
  fail('没有找到：' + PLUGINS_SRC);
} else {
  console.warn('EXT SYNC WARN: 没有找到 ' + PLUGINS_SRC + '，跳过 plugins');
}

/* ---------- 2. 扩展包：extensions/packages → dist/packages ---------- */
let copied = 0;
let packageNote = '未找到，跳过';
if (fs.existsSync(PACKAGES_SRC)) {
  try {
    fs.mkdirSync(PACKAGES_DST, { recursive: true });
    /* 先生成索引前删除旧索引，避免复制失败时留下过期市场清单 */
    const oldIndex = path.join(PACKAGES_DST, 'index.json');
    if (fs.existsSync(oldIndex)) fs.rmSync(oldIndex);

    fs.cpSync(PACKAGES_SRC, PACKAGES_DST, { recursive: true, force: true });
    copied = fs.readdirSync(PACKAGES_SRC, { withFileTypes: true })
      .filter(function (d) { return d.isDirectory(); }).length;
    packageNote = '已复制 ' + copied + ' 个目录';
  } catch (e) {
    fail('复制 packages 失败：' + (e && e.message || e));
  }
} else if (STRICT) {
  fail('没有找到：' + PACKAGES_SRC);
} else {
  console.warn('EXT SYNC WARN: 没有找到 ' + PACKAGES_SRC + '，跳过 packages');
}

/* ---------- 3. 生成 dist/packages/index.json（与远端市场格式兼容） ---------- */
let indexed = 0;
if (fs.existsSync(PACKAGES_SRC)) {
  const packages = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(PACKAGES_SRC, { withFileTypes: true })
      .filter(function (d) { return d.isDirectory(); });
  } catch (e) {
    fail('读取 packages 目录失败：' + (e && e.message || e));
  }

  dirs.forEach(function (d) {
    const name = d.name;
    if (name === '_template') return;
    const mf = path.join(PACKAGES_SRC, name, 'manifest.json');
    if (!fs.existsSync(mf)) return;

    let man;
    try {
      man = JSON.parse(fs.readFileSync(mf, 'utf8'));
    } catch (e) {
      const msg = 'manifest.json 不是合法 JSON：' + path.relative(EXT_ROOT, mf) + '（' + (e && e.message || e) + '）';
      if (STRICT) fail(msg);
      console.warn('EXT SYNC WARN: ' + msg + '，已跳过');
      return;
    }
    if (!man || typeof man !== 'object') return;

    const items = {};
    ['tools', 'skills', 'agents', 'prompts'].forEach(function (k) {
      items[k] = Array.isArray(man[k]) ? man[k].length : 0;
    });

    packages.push({
      name: String(man.name || name),
      id: name,
      version: String(man.version || ''),
      desc: String(man.description || man.desc || ''),
      path: name,
      items: items
    });
  });

  packages.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });

  const indexPath = path.join(PACKAGES_DST, 'index.json');
  try {
    fs.writeFileSync(indexPath, JSON.stringify({ raw: 'packages/', plugins: packages }, null, 2) + '\n', 'utf8');
    indexed = packages.length;
  } catch (e) {
    fail('写入 ' + path.relative(ROOT, indexPath) + ' 失败：' + (e && e.message || e));
  }
}

console.log('EXT SYNC OK');
console.log('  plugins  → dist/plugins（' + pluginNote + '）');
console.log('  packages → dist/packages（' + packageNote + '）');
console.log('  index    → dist/packages/index.json（' + indexed + ' 个扩展包）');
