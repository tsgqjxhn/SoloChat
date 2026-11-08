/* Soul 记忆核心（S1 + S2 + S3 网页版）
   - USER（画像）/ MEMORY（长期事实）两层；localStorage sc.soul.v1
   - S2：敏感信息拒写、相似条目替换（冲突不再并存）、/forget 删除
   - S3：按本轮问题做词法检索，Top-K 注入（USER 始终注入），不再整段塞满
   入口：/memory、/forget、Soul 空态按钮。 */
(function(){
  'use strict';
  var KEY = 'sc.soul.v1';
  var MEM_MAX = 1200, USER_MAX = 600, TOPK = 6;

  function load(){
    try { var o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; return { user: String(o.user || ''), memory: String(o.memory || ''), updated: o.updated || 0 }; }
    catch (e) { return { user: '', memory: '', updated: 0 }; }
  }
  function save(o){
    o.updated = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
    /* S7：文件优先 —— 宿主内同步落盘（失败静默，浏览器版继续用 localStorage） */
    try {
      if (window.NET && NET.mem){
        NET.mem('save', 'USER.md', '# USER.md\n\n' + o.user + '\n').catch(function(){});
        NET.mem('save', 'MEMORY.md', '# MEMORY.md\n\n' + o.memory + '\n').catch(function(){});
      }
    } catch (e) {}
  }
  /* S4：日记（每天一段，供 Dreaming 提炼） */
  var DKEY = 'sc.soul.daily.v1', DRKEY = 'sc.soul.dreams.v1';
  function loadDaily(){
    try { return JSON.parse(localStorage.getItem(DKEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function logTurn(u, a){
    u = String(u || '').trim(); a = String(a || '').trim();
    if (!u && !a) return;
    var d = loadDaily(), day = stamp(), list = d[day] || [];
    if (u) list.push('U: ' + u.slice(0, 220));
    if (a) list.push('A: ' + a.replace(/\s+/g, ' ').slice(0, 360));
    d[day] = list.slice(-40);
    var days = Object.keys(d).sort();
    while (days.length > 14){ delete d[days.shift()]; }
    try { localStorage.setItem(DKEY, JSON.stringify(d)); } catch (e) {}
  }
  function dailyText(n){
    var d = loadDaily(), days = Object.keys(d).sort().slice(-n), out = [];
    days.forEach(function(k){ out.push('## ' + k + '\n' + (d[k] || []).join('\n')); });
    return out.join('\n\n');
  }
  function dreams(){
    try { return String(localStorage.getItem(DRKEY) || ''); } catch (e) { return ''; }
  }
  function saveDreams(txt){
    try { localStorage.setItem(DRKEY, txt); } catch (e) {}
    try { if (window.NET && NET.mem) NET.mem('save', 'DREAMS.md', txt).catch(function(){}); } catch (e) {}
  }
  function dream(){
    if (!window.NET || !NET.chatOnce) return Promise.reject(new Error('联网组件未加载'));
    var logs = dailyText(7);
    if (logs.length < 40) return Promise.reject(new Error('最近 7 天日记太少（至少聊几轮再巩固）'));
    var sys = '你是长期记忆巩固器。从下面 7 天对话里提炼稳定事实、偏好、决定、未完成承诺。'
      + '只输出 JSON：{"memory":["- 事实1","- 事实2"],"summary":"一句话"}。最多 8 条，每条 ≤60 字；不要编造，不要重复已有记忆。';
    return NET.chatOnce([
      { role: 'system', content: sys },
      { role: 'user', content: '【已有记忆】\n' + lines(load().memory).join('\n') + '\n\n【最近 7 天】\n' + logs }
    ], { temperature: 0.1, maxTokens: 900, timeout: 60000 }).then(function(r){
      var txt = (r && r.content) || '';
      var m = /\{[\s\S]*\}/.exec(txt);
      if (!m) throw new Error('模型没有返回 JSON');
      var j = JSON.parse(m[0]);
      var before = load().memory, added = 0;
      (j.memory || []).slice(0, 8).forEach(function(s){
        var t = String(s || '').replace(/^[-•]\s*/, '').trim();
        if (!t) return;
        var rr = remember(t);
        if (rr.ok) added++;
      });
      var after = load().memory;
      var rec = '\n\n## ' + new Date().toLocaleString() + '\n'
        + '摘要：' + String(j.summary || '（无）') + '\n'
        + '新增/更新 ' + added + ' 条。\n'
        + '<details><summary>本次巩固前快照</summary>\n\n```\n' + (before || '（空）') + '\n```\n</details>\n';
      saveDreams((dreams() || '# DREAMS.md\n') + rec);
      save({ user: load().user, memory: after });
      return { added: added, summary: String(j.summary || '') };
    });
  }
  function rollback(){
    var txt = dreams();
    var m = /```\n([\s\S]*?)\n```\s*<\/details>/.exec(txt);
    if (!m) return false;
    var o = load(); o.memory = m[1].trim() === '（空）' ? '' : m[1];
    save(o);
    return true;
  }
  /* S7：启动时把磁盘里的 USER/MEMORY/DREAMS 读回（文件优先） */
  function hydrate(){
    if (!window.NET || !NET.mem) return Promise.resolve(false);
    return NET.mem('load').then(function(r){
      var files = (r && r.files) || (r && r.data && r.data.files) || [];
      function pick(n){ for (var i = 0; i < files.length; i++) if (String(files[i].name).toUpperCase() === n) return files[i]; return null; }
      var u = pick('USER.MD'), m = pick('MEMORY.MD'), d = pick('DREAMS.MD');
      function body(f){ return String(f.text || '').replace(/^#\s+\w+\.md\s*/i, '').trim(); }
      var o = load(), changed = false;
      if (u && body(u) !== o.user){ o.user = body(u); changed = true; }
      if (m && body(m) !== o.memory){ o.memory = body(m); changed = true; }
      if (changed){ o.updated = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
      if (d && body(d)) { try { localStorage.setItem(DRKEY, body(d)); } catch (e) {} }
      return changed;
    }).catch(function(){ return false; });
  }
  function stamp(){
    var d = new Date(), p = function(n){ return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function lines(mem){
    return String(mem || '').split('\n').map(function(s){ return s.trim(); }).filter(function(s){ return /^- \[/.test(s); });
  }
  function entryOf(line){
    var m = /^- \[([0-9-]{8,10})\]\s*([\s\S]*)$/.exec(line);
    return { date: m ? m[1] : '', text: m ? m[2] : line, line: line };
  }
  function toks(s){
    s = String(s || '').toLowerCase();
    var out = (s.match(/[a-z0-9_]{2,}/g) || []).slice();
    var cjk = s.replace(/[^\u4e00-\u9fa5]+/g, ' ');
    cjk.split(/\s+/).forEach(function(seg){
      for (var i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
    });
    return out;
  }
  function sim(a, b){
    var A = toks(a), B = toks(b);
    if (!A.length || !B.length) return 0;
    var sa = {}, sb = {}, inter = 0;
    A.forEach(function(t){ sa[t] = 1; });
    B.forEach(function(t){ sb[t] = 1; });
    for (var k in sa) if (sb[k]) inter++;
    return inter / Math.sqrt(Object.keys(sa).length * Object.keys(sb).length);
  }
  function daysAgo(d){
    var t = Date.parse(d + 'T00:00:00');
    if (isNaN(t)) return 365;
    return Math.max(0, (Date.now() - t) / 86400000);
  }
  function prior(text){
    return /(喜欢|偏好|习惯|决定|约定|承诺|不要|别|以后|每次|称呼|名字)/.test(text) ? 1 : 0.4;
  }
  function semOn(){ try { return localStorage.getItem('sc.soul.sem') !== '0'; } catch (e) { return true; } }
  function ngrams(s){
    var t = String(s || '').toLowerCase().replace(/\s+/g, ''), v = {};
    for (var i = 0; i < t.length; i++){
      v[t.charAt(i)] = (v[t.charAt(i)] || 0) + 1;
      if (i < t.length - 1){ var bg = t.slice(i, i + 2); v[bg] = (v[bg] || 0) + 1.5; }
    }
    return v;
  }
  function ncos(a, b){
    var A = ngrams(a), B = ngrams(b), ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return 0;
    var dot = 0, na = 0, nb = 0;
    ka.forEach(function(k){ na += A[k] * A[k]; if (B[k]) dot += A[k] * B[k]; });
    kb.forEach(function(k){ nb += B[k] * B[k]; });
    return dot / Math.sqrt(na * nb);
  }
  function score(q, e){
    var rel = sim(q, e.text);
    if (semOn()) rel = 0.6 * rel + 0.4 * ncos(q, e.text); /* 本地字符向量：不改词也能命中近义表述 */
    if (rel <= 0.03) return 0;
    var rec = Math.exp(-daysAgo(e.date) / 30);
    return 0.55 * rel + 0.25 * rec + 0.20 * prior(e.text);
  }
  /* S4：每日自动巩固（只跑一次/天；可 /dream auto off 关闭） */
  function maybeDream(){
    try {
      if (localStorage.getItem('sc.soul.autoDream') === '0') return;
      var last = +(localStorage.getItem('sc.soul.dreamAt') || 0);
      if (Date.now() - last < 86400000) return;
      if (!window.NET || !NET.chatOnce) return;
      if (typeof S === 'undefined' || !S.cfg || !S.cfg.currentModel || !S.cfg.baseURL) return;
      if (dailyText(3).length < 120) return;
      localStorage.setItem('sc.soul.dreamAt', String(Date.now()));
      dream().then(function(r){ try { UI.toast('自动巩固：新增/更新 ' + r.added + ' 条'); } catch (e) {} })
        .catch(function(){ try { localStorage.removeItem('sc.soul.dreamAt'); } catch (e) {} });
    } catch (e) {}
  }
  /* S2：敏感信息拒写（宁可少记，不可泄密） */
  function sensitive(t){
    return /(api[\s_-]?key|密钥|密码|passw(or)?d|secret|token|sk-[A-Za-z0-9_-]{8,}|身份证|银行卡|信用卡|卡号|\b\d{16,19}\b|家庭住址|门牌)/i.test(t);
  }
  function remember(text){
    var t = String(text || '').trim().replace(/\s+/g, ' ');
    if (!t) return { ok: false, msg: '内容为空' };
    if (sensitive(t)) return { ok: false, msg: '含密钥/密码/证件/卡号等敏感信息，已拒写' };
    var o = load(), list = lines(o.memory), best = -1, bs = 0;
    list.forEach(function(l, i){
      var s = sim(t, entryOf(l).text);
      if (s > bs){ bs = s; best = i; }
    });
    var d = stamp(), action = 'add', old = '';
    if (best >= 0 && bs >= 0.38){
      old = entryOf(list[best]).text;
      list[best] = '- [' + d + '] ' + t;
      action = 'update';
    } else {
      list.push('- [' + d + '] ' + t);
    }
    var mem = list.join('\n');
    while (mem.length > MEM_MAX && list.length > 1){ list.shift(); mem = list.join('\n'); }
    o.memory = mem.slice(-MEM_MAX);
    save(o);
    return { ok: true, action: action, old: old, date: d, msg: action === 'update' ? '已更新：' + old + ' → ' + t : '已记入 MEMORY.md' };
  }
  function forget(q){
    var o = load(), list = lines(o.memory), keep = [], n = 0;
    list.forEach(function(l){
      if (sim(q, entryOf(l).text) >= 0.3){ n++; } else keep.push(l);
    });
    o.memory = keep.join('\n');
    save(o);
    return n;
  }
  function search(q){
    return lines(load().memory).map(entryOf).map(function(x){ return { e: x, s: score(q, x) }; })
      .filter(function(x){ return x.s > 0.12; })
      .sort(function(a, b){ return b.s - a.s; })
      .slice(0, TOPK * 2)
      .map(function(x){ return x.e; });
  }
  function prompt(q){
    var o = load(), L = [], used = 0;
    if (o.user.trim()) L.push('【用户画像】\n' + o.user.trim().slice(0, USER_MAX));
    var list = lines(o.memory).map(entryOf);
    if (list.length){
      var picked;
      var hasQ = !!(q && String(q).trim());
      if (hasQ){
        picked = list.map(function(e){ return { e: e, s: score(q, e) }; })
          .filter(function(x){ return x.s > 0.12; })
          .sort(function(a, b){ return b.s - a.s; })
          .slice(0, TOPK).map(function(x){ return x.e; });
      }
      if ((!picked || !picked.length) && !hasQ) picked = list.slice(-TOPK); /* 无问题（如预热）才给最近几条 */
      if (picked && picked.length){
        var budget = 1200, out = [];
        picked.forEach(function(e){
          var line = '- [' + e.date + '] ' + e.text;
          if (budget - line.length < 0) return;
          out.push(line); budget -= line.length;
        });
        used = out.length;
        if (out.length) L.push('【本轮相关记忆】\n' + out.join('\n'));
      }
    }
    if (!L.length) return '';
    return 'Soul 记忆（长期、跨会话；以文件为准，冲突时问用户；本轮用到 ' + used + ' 条）：\n' + L.join('\n\n');
  }
  function mk(tag, cls, txt){ var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function open(){
    var o = load();
    var mask = mk('div', 'soul-mask');
    var box = mk('div', 'soul-box');
    var head = mk('div', 'soul-head');
    head.appendChild(mk('b', null, 'Soul · 长期记忆'));
    var close = mk('button', 'soul-btn', '关闭');
    head.appendChild(close);
    var uLbl = mk('div', 'soul-lbl', 'USER.md · 用户画像（称呼、语气、忌讳、长期项目；≤600 字）');
    var uTa = mk('textarea', 'soul-ta');
    uTa.value = o.user; uTa.placeholder = '例：称呼我「老公」；喜欢简洁直接的答案；常做 SoloChat / Echo 项目。';
    var mLbl = mk('div', 'soul-lbl', 'MEMORY.md · 长期事实（决定、约定、重要事件；≤1200 字）');
    var mTa = mk('textarea', 'soul-ta soul-ta-lg');
    mTa.value = o.memory; mTa.placeholder = '例：- [2026-11-08] 决定把主应用保持单文件 index.html。';
    var foot = mk('div', 'soul-foot');
    var status = mk('span', 'soul-status', '本地保存，不上传');
    var exp = mk('button', 'soul-btn', '导出 .md');
    var clr = mk('button', 'soul-btn', '清空');
    var sv = mk('button', 'soul-btn soul-primary', '保存');
    foot.appendChild(status); foot.appendChild(exp); foot.appendChild(clr); foot.appendChild(sv);
    box.appendChild(head); box.appendChild(uLbl); box.appendChild(uTa); box.appendChild(mLbl); box.appendChild(mTa); box.appendChild(foot);
    mask.appendChild(box); document.body.appendChild(mask);
    function closeFn(){ mask.remove(); }
    close.onclick = closeFn;
    mask.addEventListener('click', function(e){ if (e.target === mask) closeFn(); });
    uTa.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeFn(); });
    sv.onclick = function(){
      save({ user: uTa.value.slice(0, USER_MAX), memory: mTa.value.slice(-MEM_MAX) });
      status.textContent = '已保存 ' + new Date().toLocaleTimeString();
    };
    clr.onclick = function(){
      if (!confirm('清空 USER 与 MEMORY？此操作不可撤销（建议先导出）。')) return;
      save({ user: '', memory: '' });
      uTa.value = ''; mTa.value = ''; status.textContent = '已清空';
    };
    exp.onclick = function(){
      var cur = load();
      var md = '# USER.md\n\n' + cur.user + '\n\n# MEMORY.md\n\n' + cur.memory + '\n';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
      a.download = 'soul-memory.md'; a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 3000);
    };
    uTa.focus();
  }
  /* S2：隐式候选（不直接写长期记忆，先进待确认） */
  var PKEY = 'sc.soul.pending.v1';
  function pendingLoad(){
    try { return JSON.parse(localStorage.getItem(PKEY) || '[]') || []; } catch (e) { return []; }
  }
  function pendingSave(list){ try { localStorage.setItem(PKEY, JSON.stringify(list.slice(-30))); } catch (e) {} }
  function candidate(text){
    var t = String(text || '').trim().replace(/\s+/g, ' ');
    if (!t || t.length < 6 || t.length > 160) return null;
    if (sensitive(t)) return null;
    if (!/(我喜欢|我习惯|我通常|我一般|我每周|我每天|以后都|以后别|下次别|别再|记住我|我的.{0,8}是|我在用|我住|我叫)/.test(t)) return null;
    var list = pendingLoad();
    if (list.some(function(x){ return sim(x.text, t) >= 0.55; })) return null;
    if (lines(load().memory).some(function(l){ return sim(entryOf(l).text, t) >= 0.55; })) return null;
    var sc = 0.45 + (/(喜欢|习惯|每周|每天|以后|别)/.test(t) ? 0.3 : 0) + (t.length <= 60 ? 0.2 : 0);
    var item = { id: 'p' + Date.now().toString(36), text: t, ts: Date.now(), score: Math.min(1, sc) };
    list.push(item); pendingSave(list);
    return item;
  }
  function pendingList(){ return pendingLoad(); }
  function pendingAccept(id){
    var list = pendingLoad(), hit = null;
    list = list.filter(function(x){ if (x.id === id){ hit = x; return false; } return true; });
    pendingSave(list);
    if (!hit) return false;
    remember(hit.text);
    return true;
  }
  function pendingDrop(id){
    var list = pendingLoad(), n = list.length;
    list = list.filter(function(x){ return x.id !== id; });
    pendingSave(list);
    return n - list.length;
  }
  /* S8：时间线（按天） */
  function timeline(){
    var d = loadDaily(), out = [];
    Object.keys(d).sort().reverse().forEach(function(k){
      var list = d[k] || [];
      out.push({ date: k, turns: Math.floor(list.length / 2), chars: list.join('').length });
    });
    return out;
  }
  var CKEY = 'sc.soul.cron.v1';
  function cronLoad(){
    try { return JSON.parse(localStorage.getItem(CKEY) || '[]') || []; } catch (e) { return []; }
  }
  function cronSave(list){ try { localStorage.setItem(CKEY, JSON.stringify(list)); } catch (e) {} }
  function cronAdd(at, prompt){
    at = String(at || '').trim(); prompt = String(prompt || '').trim();
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(at)) return { ok: false, msg: '时间格式要 HH:MM（如 09:00）' };
    if (!prompt) return { ok: false, msg: '缺少任务内容' };
    var list = cronLoad();
    var id = 'c' + Date.now().toString(36);
    list.push({ id: id, at: at, prompt: prompt, enabled: true, lastRun: '' });
    cronSave(list);
    return { ok: true, id: id };
  }
  function cronDel(id){
    var list = cronLoad(), n = list.length;
    list = list.filter(function(x){ return x.id !== id; });
    cronSave(list);
    return n - list.length;
  }
  function cronList(){ return cronLoad(); }
  function dueTasks(now){
    var d = new Date(), hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2), day = stamp();
    return cronLoad().filter(function(t){ return t.enabled !== false && t.at === hm && t.lastRun !== day + ' ' + t.at; });
  }
  function markRun(t){
    var list = cronLoad();
    list.forEach(function(x){ if (x.id === t.id) x.lastRun = stamp() + ' ' + t.at; });
    cronSave(list);
  }
  function showCronCard(t){
    var d = mk('div', 'cron-card');
    d.appendChild(mk('b', null, '⏰ 定时任务'));
    d.appendChild(mk('div', 'cron-txt', t.prompt));
    var run = mk('button', 'soul-btn soul-primary', '执行');
    var skip = mk('button', 'soul-btn', '忽略');
    d.appendChild(run); d.appendChild(skip);
    var host = document.getElementById('msg-list') || document.body;
    host.appendChild(d);
    run.onclick = function(){
      d.remove();
      var i = document.getElementById('input'), b = document.getElementById('btn-send');
      if (!i || !b) return;
      i.value = t.prompt; i.dispatchEvent(new Event('input', { bubbles: true }));
      b.click();
    };
    skip.onclick = function(){ d.remove(); };
    try { UI.toast('定时任务到点：' + t.prompt.slice(0, 30)); } catch (e) {}
    try { if (window.NET && NET.notify) NET.notify('Soul 定时任务', t.prompt); } catch (e) {}
  }
  function tick(){
    try {
      dueTasks().forEach(function(t){ markRun(t); showCronCard(t); });
    } catch (e) {}
  }
  function heartbeat(){
    var o = load(), daily = loadDaily(), today = daily[stamp()] || [];
    var memN = lines(o.memory).length;
    var last = '';
    try {
      var list = (S.sessions || []).slice().sort(function(a, b){ return (b.updated || 0) - (a.updated || 0); });
      if (list.length) last = list[0].title || '';
    } catch (e) {}
    return { last: last, turns: Math.floor(today.length / 2), mem: memN, user: o.user.trim() ? 1 : 0 };
  }
  /* S8：四页签记忆面板（画像 / 记忆 / 日记 / 技能）+ 导入 */
  function openFull(){
    var o = load();
    var mask = mk('div', 'soul-mask'), box = mk('div', 'soul-box');
    var head = mk('div', 'soul-head');
    head.appendChild(mk('b', null, 'Soul · 记忆与成长'));
    var close = mk('button', 'soul-btn', '关闭'); head.appendChild(close);
    var tabs = mk('div', 'soul-tabs');
    var panes = mk('div', 'soul-panes');
    function tabBtn(k, label){
      var b = mk('button', 'soul-tab', label);
      b.onclick = function(){
        Array.prototype.forEach.call(tabs.children, function(x){ x.classList.remove('on'); });
        Array.prototype.forEach.call(panes.children, function(x){ x.style.display = 'none'; });
        b.classList.add('on');
        var p = document.getElementById('soul-pane-' + k); if (p) p.style.display = '';
      };
      tabs.appendChild(b);
      return b;
    }
    function pane(k){
      var d = mk('div', 'soul-pane'); d.id = 'soul-pane-' + k; d.style.display = 'none';
      panes.appendChild(d); return d;
    }
    var pU = pane('user'), pM = pane('mem'), pD = pane('day'), pS = pane('skill');
    pU.appendChild(mk('div', 'soul-lbl', 'USER.md · 用户画像（称呼、语气、忌讳、长期项目；≤600 字）'));
    var uTa = mk('textarea', 'soul-ta soul-ta-lg');
    uTa.value = o.user; uTa.placeholder = '例：称呼我「老公」；喜欢简洁直接的答案；常做 SoloChat / Echo 项目。';
    pU.appendChild(uTa);
    pM.appendChild(mk('div', 'soul-lbl', 'MEMORY.md · 长期事实（决定、约定、重要事件；≤1200 字）'));
    var search = mk('input', 'soul-search'); search.placeholder = '搜索记忆（回车过滤）';
    var mTa = mk('textarea', 'soul-ta soul-ta-lg');
    mTa.value = o.memory; mTa.placeholder = '例：- [2026-11-08] 决定把主应用保持单文件 index.html。';
    var hits = mk('div', 'soul-hits');
    search.onkeydown = function(e){
      if (e.key !== 'Enter') return;
      var q = search.value.trim(); hits.textContent = '';
      if (!q) return;
      var list = lines(mTa.value).filter(function(l){ return l.indexOf(q) >= 0; });
      hits.textContent = list.length ? ('命中 ' + list.length + ' 条：\n' + list.join('\n')) : '没有匹配';
      hits.style.display = 'block';
    };
    pM.appendChild(search); pM.appendChild(hits); pM.appendChild(mTa);
    pD.appendChild(mk('div', 'soul-lbl', '最近 7 天日记（每天聊完自动记录；/dream 用来巩固）'));
    var dp = mk('pre', 'soul-pre', dailyText(7) || '还没有日记。在 Soul 模式聊几轮就会记录。');
    pD.appendChild(dp);
    pS.appendChild(mk('div', 'soul-lbl', '技能（/learn 生成，/skill-drop 删除）'));
    var sl = mk('div', 'soul-skills');
    try {
      var skills = (typeof EXT !== 'undefined' && EXT.registry) ? EXT.registry().filter(function(x){ return x.kind === 'skill'; }) : [];
      if (!skills.length) sl.appendChild(mk('div', 'soul-status', '还没有技能。'));
      skills.forEach(function(s){
        var row = mk('div', 'soul-skill-row');
        row.appendChild(mk('span', null, s.name + (s.desc ? ' · ' + s.desc : '')));
        var del = mk('button', 'soul-btn', '删除');
        del.onclick = function(){
          if (!confirm('删除技能 ' + s.name + '？')) return;
          try { EXT.del(s.name); row.remove(); } catch (e) { alert('删除失败：' + e.message); }
        };
        row.appendChild(del); sl.appendChild(row);
      });
    } catch (e) {}
    pS.appendChild(sl);
    /* 待确认（隐式候选） */
    var pP = pane('pend');
    pP.appendChild(mk('div', 'soul-lbl', '待确认 · 从聊天里自动挑出的偏好/事实（采纳才写入长期记忆）'));
    var pl = mk('div', 'soul-skills');
    var pend = pendingList();
    if (!pend.length) pl.appendChild(mk('div', 'soul-status', '暂无候选。聊到「我喜欢…」「以后都…」会自动进这里。'));
    pend.slice().reverse().forEach(function(it){
      var row = mk('div', 'soul-skill-row');
      row.appendChild(mk('span', null, it.text));
      var ok = mk('button', 'soul-btn soul-primary', '采纳');
      var no = mk('button', 'soul-btn', '丢弃');
      ok.onclick = function(){ pendingAccept(it.id); row.remove(); status.textContent = '已写入 MEMORY'; };
      no.onclick = function(){ pendingDrop(it.id); row.remove(); };
      row.appendChild(ok); row.appendChild(no); pl.appendChild(row);
    });
    pP.appendChild(pl);
    /* 时间线 */
    var pT = pane('time');
    pT.appendChild(mk('div', 'soul-lbl', '记忆时间线（按天统计最近对话）'));
    var tl = mk('div', 'soul-skills');
    var rows = timeline();
    if (!rows.length) tl.appendChild(mk('div', 'soul-status', '还没有记录。'));
    rows.forEach(function(r){
      var row = mk('div', 'soul-skill-row');
      row.appendChild(mk('span', null, r.date + ' · ' + r.turns + ' 轮 · ' + r.chars + ' 字'));
      tl.appendChild(row);
    });
    pT.appendChild(tl);
    var foot = mk('div', 'soul-foot');
    var status = mk('span', 'soul-status', '本地保存；宿主内同时写 %USERPROFILE%\\SoloChat\\memory');
    var fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.md,.txt'; fi.style.display = 'none';
    var imp = mk('button', 'soul-btn', '导入 .md');
    var exp = mk('button', 'soul-btn', '导出 .md');
    var clr = mk('button', 'soul-btn', '清空');
    var sv = mk('button', 'soul-btn soul-primary', '保存');
    foot.appendChild(status); foot.appendChild(imp); foot.appendChild(exp); foot.appendChild(clr); foot.appendChild(sv);
    box.appendChild(head); box.appendChild(tabs); box.appendChild(panes); box.appendChild(foot); box.appendChild(fi);
    mask.appendChild(box); document.body.appendChild(mask);
    function closeFn(){ mask.remove(); }
    close.onclick = closeFn;
    mask.addEventListener('click', function(e){ if (e.target === mask) closeFn(); });
    var first = tabBtn('user', '用户画像'); tabBtn('mem', '长期记忆'); tabBtn('pend', '待确认'); tabBtn('day', '日记'); tabBtn('time', '时间线'); tabBtn('skill', '技能');
    first.classList.add('on'); pU.style.display = '';
    imp.onclick = function(){ fi.click(); };
    fi.onchange = function(){
      var f = fi.files && fi.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function(){
        var t = String(rd.result || '');
        var um = /#\s*USER\.md\s*([\s\S]*?)(?=#\s*MEMORY\.md|$)/i.exec(t);
        var mm = /#\s*MEMORY\.md\s*([\s\S]*)$/i.exec(t);
        if (um) uTa.value = um[1].trim().slice(0, USER_MAX);
        if (mm) mTa.value = mm[1].trim().slice(-MEM_MAX);
        if (!um && !mm){ mTa.value = (mTa.value + '\n' + t.trim()).trim().slice(-MEM_MAX); }
        status.textContent = '已载入，点「保存」生效';
      };
      rd.readAsText(f, 'utf-8');
    };
    sv.onclick = function(){
      save({ user: uTa.value.slice(0, USER_MAX), memory: mTa.value.slice(-MEM_MAX) });
      status.textContent = '已保存 ' + new Date().toLocaleTimeString();
    };
    clr.onclick = function(){
      if (!confirm('清空 USER 与 MEMORY？此操作不可撤销（建议先导出）。')) return;
      save({ user: '', memory: '' });
      uTa.value = ''; mTa.value = ''; status.textContent = '已清空';
    };
    exp.onclick = function(){
      var cur = load();
      var md = '# USER.md\n\n' + cur.user + '\n\n# MEMORY.md\n\n' + cur.memory + '\n';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
      a.download = 'soul-memory.md'; a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 3000);
    };
    uTa.focus();
  }
  function openDreams(){
    var mask = mk('div', 'soul-mask'), box = mk('div', 'soul-box'), head = mk('div', 'soul-head');
    head.appendChild(mk('b', null, 'Soul · Dreaming 记录'));
    var close = mk('button', 'soul-btn', '关闭'); head.appendChild(close);
    var pre = mk('pre', 'soul-pre', dreams() || '还没有巩固记录。聊几轮后执行 /dream。');
    var foot = mk('div', 'soul-foot');
    var rb = mk('button', 'soul-btn soul-primary', '回滚上一次巩固');
    foot.appendChild(rb);
    box.appendChild(head); box.appendChild(pre); box.appendChild(foot);
    mask.appendChild(box); document.body.appendChild(mask);
    function closeFn(){ mask.remove(); }
    close.onclick = closeFn;
    mask.addEventListener('click', function(e){ if (e.target === mask) closeFn(); });
    rb.onclick = function(){
      var ok = rollback();
      alert(ok ? '已回滚到上一次巩固前的 MEMORY' : '没有可回滚的快照');
      if (ok) closeFn();
    };
  }
  window.SOUL = { prompt: prompt, remember: remember, forget: forget, search: search, open: openFull, load: load, save: save,
    logTurn: logTurn, daily: dailyText, dream: dream, dreams: dreams, rollback: rollback, hydrate: hydrate, openDreams: openDreams,
    cronAdd: cronAdd, cronList: cronList, cronDel: cronDel, tick: tick, heartbeat: heartbeat,
    candidate: candidate, pendingList: pendingList, pendingAccept: pendingAccept, pendingDrop: pendingDrop,
    timeline: timeline, maybeDream: maybeDream, semOn: semOn };
})();
