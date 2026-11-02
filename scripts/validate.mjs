#!/usr/bin/env node
/* SoloChat 插件市场校验：node scripts/validate.mjs */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const KINDS = ['skills', 'tools', 'agents', 'prompts'];
const errs = [];
const warns = [];
const fail = (m) => errs.push(m);
const warn = (m) => warns.push(m);

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { fail(path.relative(ROOT, p) + ' 不是合法 JSON：' + e.message); return null; }
}
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const index = readJson(path.join(ROOT, 'index.json'));
const pluginsDir = path.join(ROOT, 'plugins');
const dirs = fs.existsSync(pluginsDir)
  ? fs.readdirSync(pluginsDir).filter((d) => fs.statSync(path.join(pluginsDir, d)).isDirectory())
  : [];

if (index) {
  if (index.schema !== 'solochat-plugin-market/1') fail('index.json schema 应为 solochat-plugin-market/1');
  const listed = new Map((index.plugins || []).map((p) => [p.id, p]));
  for (const d of dirs) if (!listed.has(d)) fail('目录 plugins/' + d + ' 没在 index.json 里登记');
  for (const [id, p] of listed) {
    if (!dirs.includes(id)) fail('index.json 里的 ' + id + ' 没有对应目录');
    if (p.path !== 'plugins/' + id) fail(id + '：path 应为 plugins/' + id);
    for (const k of ['name', 'version', 'desc', 'author', 'license']) if (!p[k]) fail(id + '：index.json 缺字段 ' + k);
  }
}

for (const d of dirs) {
  const dir = path.join(pluginsDir, d);
  const rel = 'plugins/' + d;
  const manP = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manP)) { fail(rel + '：缺 manifest.json'); continue; }
  const man = readJson(manP);
  if (!man) continue;
  if (!man.name) fail(rel + '：manifest 缺 name');
  if (!man.version) fail(rel + '：manifest 缺 version');
  if (!man.desc) warn(rel + '：manifest 建议写 desc');
  if (!man.license) warn(rel + '：manifest 建议写 license');

  let declared = 0;
  for (const k of KINDS) {
    for (const f of man[k] || []) {
      declared++;
      const fp = path.join(dir, typeof f === 'string' ? f : f.file || f.path || '');
      if (!fs.existsSync(fp)) { fail(rel + '：' + k + ' 里列的 ' + f + ' 不存在'); continue; }
      const text = fs.readFileSync(fp, 'utf8');
      if (k === 'tools') {
        let t;
        try { t = JSON.parse(text); } catch { fail(path.relative(ROOT, fp) + ' 不是合法 JSON'); continue; }
        if (!t.name) fail(path.relative(ROOT, fp) + ' 缺 name');
        if ((t.type || 'http') !== 'http') fail(path.relative(ROOT, fp) + '：只允许声明式 http 工具');
        if (!t.url) fail(path.relative(ROOT, fp) + ' 缺 url');
        if (t.code || t.js || t.script) fail(path.relative(ROOT, fp) + '：不允许携带可执行代码');
        if (!/^https:\/\//.test(t.url || '')) warn(path.relative(ROOT, fp) + '：url 建议用 https');
      } else {
        const fm = frontmatter(text);
        if (!fm) fail(path.relative(ROOT, fp) + ' 缺 frontmatter');
        else if (!fm.name) fail(path.relative(ROOT, fp) + ' frontmatter 缺 name');
        if (fm && k === 'agents' && !fm.tools) warn(path.relative(ROOT, fp) + '：智能体建议显式写 tools 白名单');
      }
    }
    /* 目录里有、清单里没列的文件 */
    const sub = path.join(dir, k);
    if (fs.existsSync(sub)) {
      for (const f of fs.readdirSync(sub)) {
        if (!/^[^.]/.test(f)) continue;
        const has = (man[k] || []).some((x) => (typeof x === 'string' ? x : x.file || x.path) === k + '/' + f);
        if (!has) warn(rel + '：' + k + '/' + f + ' 没写进 manifest');
      }
    }
  }
  if (!declared) fail(rel + '：manifest 里没有任何条目');
}

for (const w2 of warns) console.warn('warn  ' + w2);
if (errs.length) {
  for (const e of errs) console.error('error ' + e);
  console.error('\n校验失败：' + errs.length + ' 个错误');
  process.exit(1);
}
console.log('校验通过：' + dirs.length + ' 个插件，' + warns.length + ' 个提醒');
