#!/usr/bin/env node
/* SoloChat 插件市场校验：node scripts/validate.mjs */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const KINDS = ['skills', 'tools', 'agents', 'prompts'];
const KIND_OF = { skills: 'skill', tools: 'tool', agents: 'agent', prompts: 'prompt' };
const FIELD_TYPES = new Set(['text', 'password', 'url', 'model', 'number', 'select', 'boolean', 'textarea']);
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
/* v1：manifest.items[] 是主格式；旧的四数组仍兼容 */
function entriesOf(man) {
  const out = [];
  for (const k of KINDS) {
    for (const f of man[k] || []) {
      const file = typeof f === 'string' ? f : (f && (f.file || f.path));
      if (file) out.push({ kind: KIND_OF[k], file, config: (f && f.config) || null, where: k });
    }
  }
  for (const it of man.items || []) {
    if (!it || typeof it !== 'object') continue;
    const file = it.file || it.path;
    if (!file) { fail('manifest.items[] 有条目缺 file'); continue; }
    out.push({ kind: it.kind || 'skill', file, config: it.config || null, where: 'items' });
  }
  return out;
}
function checkConfig(list, where) {
  if (list == null) return;
  if (!Array.isArray(list)) { fail(where + '：config 必须是数组'); return; }
  const seen = new Set();
  for (const f of list) {
    if (!f || typeof f !== 'object') { fail(where + '：config 条目必须是对象'); continue; }
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(String(f.key || ''))) fail(where + '：config key 非法（' + f.key + '）');
    if (seen.has(f.key)) fail(where + '：config key 重复（' + f.key + '）');
    seen.add(f.key);
    if (f.type && !FIELD_TYPES.has(f.type)) fail(where + '：config ' + f.key + ' 类型不支持：' + f.type);
    if (f.scope && !['item', 'package'].includes(f.scope)) fail(where + '：config ' + f.key + ' scope 只能是 item / package');
    if (f.secret && f.type && f.type !== 'password') warn(where + '：config ' + f.key + ' 有 secret 但 type 不是 password');
  }
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
  checkConfig(man.config, rel + ' manifest.config');

  const entries = entriesOf(man);
  if (!entries.length) fail(rel + '：manifest 里没有任何条目');
  const listedByDir = { skills: new Set(), tools: new Set(), agents: new Set(), prompts: new Set() };

  for (const e of entries) {
    const k = e.kind + 's';
    if (!KINDS.includes(k)) { fail(rel + '：不认识的 kind ' + e.kind); continue; }
    const fp = path.join(dir, e.file);
    listedByDir[k].add(e.file.replace(/\\/g, '/'));
    if (!fs.existsSync(fp)) { fail(rel + '：' + e.where + ' 里列的 ' + e.file + ' 不存在'); continue; }
    const text = fs.readFileSync(fp, 'utf8');
    if (e.kind === 'tool') {
      let t;
      try { t = JSON.parse(text); } catch { fail(path.relative(ROOT, fp) + ' 不是合法 JSON'); continue; }
      if (!t.name) fail(path.relative(ROOT, fp) + ' 缺 name');
      if ((t.type || 'http') !== 'http') fail(path.relative(ROOT, fp) + '：只允许声明式 http 工具');
      if (!t.url) fail(path.relative(ROOT, fp) + ' 缺 url');
      if (t.code || t.js || t.script) fail(path.relative(ROOT, fp) + '：不允许携带可执行代码');
      if (!/^https:\/\//.test(t.url || '')) warn(path.relative(ROOT, fp) + '：url 建议用 https');
      checkConfig(t.config, path.relative(ROOT, fp) + ' config');
    } else {
      const fm = frontmatter(text);
      if (!fm) fail(path.relative(ROOT, fp) + ' 缺 frontmatter');
      else if (!fm.name) fail(path.relative(ROOT, fp) + ' frontmatter 缺 name');
      if (fm && e.kind === 'agent' && !fm.tools) warn(path.relative(ROOT, fp) + '：智能体建议显式写 tools 白名单');
      /* frontmatter config 是 YAML/JSON 行，导入端会解析；这里只做类型存在性提示 */
      if (fm && Object.prototype.hasOwnProperty.call(fm, 'config') && !/^\s*[\[{]/.test(fm.config)) {
        warn(path.relative(ROOT, fp) + '：frontmatter config 建议写成 JSON 数组');
      }
    }
    checkConfig(e.config, rel + ' ' + e.where + ' ' + e.file + ' config');
  }

  /* 目录里有、清单里没列的文件 */
  for (const k of KINDS) {
    const sub = path.join(dir, k);
    if (!fs.existsSync(sub)) continue;
    for (const f of fs.readdirSync(sub)) {
      if (!/^[^.]/.test(f)) continue;
      if (!listedByDir[k].has(k + '/' + f)) warn(rel + '：' + k + '/' + f + ' 没写进 manifest');
    }
  }
}

for (const w2 of warns) console.warn('warn  ' + w2);
if (errs.length) {
  for (const e of errs) console.error('error ' + e);
  console.error('\n校验失败：' + errs.length + ' 个错误');
  process.exit(1);
}
console.log('校验通过：' + dirs.length + ' 个插件，' + warns.length + ' 个提醒');
