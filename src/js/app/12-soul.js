/* Soul 记忆核心（S1 + S2 + S3 网页版）
   - USER（画像）/ MEMORY（长期事实）两层；localStorage sc.soul.v1
   - S2：敏感信息拒写、相似条目替换（冲突不再并存）、/forget 删除
   - S3：按本轮问题做词法检索，Top-K 注入（USER 始终注入），不再整段塞满
   入口：/memory、/forget、Soul 空态按钮。 */
(function(){
  'use strict';
  var KEY = 'sc.soul.v1';
  var MEM_MAX = 1200, USER_MAX = 600, TOPK = 6;
  /* v0.4.1：持续进化 */
  var EVO_KEY = 'sc.soul.evo.v1', EVO_AT = 'sc.soul.evoAt', EVO_ON = 'sc.soul.evoOn', EVO_TURNS = 'sc.soul.evoTurns';
  var EVO_EVERY = 6, EVO_DELAY = 15000;
  var _evoBusy = false, _evoFresh = false;

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
    /* v0.4.1：累计成功轮数，够 6 轮就延迟安排一次自动进化（不打断流式） */
    try {
      var n = (+localStorage.getItem(EVO_TURNS) || 0) + 1;
      localStorage.setItem(EVO_TURNS, String(n));
      if (n >= EVO_EVERY && evoOn() && !_evoFresh){
        _evoFresh = true;
        setTimeout(maybeEvolve, EVO_DELAY);
      }
    } catch (e) {}
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
  /* ===== v0.4.1：自动进化（记忆 + 可复用技能） ===== */
  function evoOn(v){
    if (typeof v === 'boolean'){
      try { localStorage.setItem(EVO_ON, v ? '1' : '0'); } catch (e) {}
      return v;
    }
    try { return localStorage.getItem(EVO_ON) !== '0'; } catch (e) { return true; }
  }
  function evoLog(){
    try { var a = JSON.parse(localStorage.getItem(EVO_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function evoSave(list){
    try { localStorage.setItem(EVO_KEY, JSON.stringify((list || []).slice(-30))); } catch (e) {}
  }
  function evoTurns(){ try { return +localStorage.getItem(EVO_TURNS) || 0; } catch (e) { return 0; } }
  function evoResetTurns(){ try { localStorage.setItem(EVO_TURNS, '0'); } catch (e) {} }
  function evolve(force){
    if (!force && !evoOn()) return Promise.resolve({ ok: false, reason: '自动进化已关闭' });
    if (_evoBusy) return Promise.resolve({ ok: false, reason: '进化正在进行中' });
    var S0 = (typeof S !== 'undefined') ? S : null;
    if (!window.NET || !NET.chatOnce) return Promise.resolve({ ok: false, reason: '联网组件未加载' });
    if (!S0 || !S0.cfg || !S0.cfg.currentModel) return Promise.resolve({ ok: false, reason: '还没有选择模型' });
    if (!S0.cfg.baseURL && !(NET.isMock && NET.isMock())) return Promise.resolve({ ok: false, reason: '还没有配置 Base URL' });
    var logs = dailyText(3);
    if (logs.length < 200) return Promise.resolve({ ok: false, reason: '最近日记太少（再聊几轮）' });
    _evoBusy = true;
    var oldMem = lines(load().memory).map(function(l){ return entryOf(l).text; });
    var skillNames = [];
    try { skillNames = EXT.registry().filter(function(x){ return x.kind === 'skill' && x.on !== false; }).map(function(x){ return x.name; }); } catch (e) {}
    var _P = profile();
    var _pers = String(_P.personality || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    var sys = '你是 Soul 的自主进化器。当前人格：' + (_P.name || 'Soul') + '；性格/边界：' + (_pers || '温暖、直接、可靠，尊重用户偏好')
      + '。提炼时不要违背这个人的说话方式与边界。\n'
      + '读下面最近的对话与已有记忆/技能，只做两件事：\n'
      + '1) 提炼稳定、可长期复用的事实或偏好（写进长期记忆）；\n'
      + '2) 如果这次任务形成了可重复的成功流程，写/更新一个技能。\n'
      + '只输出 JSON，不要解释：{"memory":["- 稳定事实/偏好"],"skill":{"name":"lowercase-slug","title":"...","desc":"...","body":"# ..."},"note":"一句话"}\n'
      + '约束：memory ≤6 条、每条 ≤80 字；没有就空数组。skill 只在流程可复用且这次确实成功时返回，否则给 null；'
      + '正文必须含「何时用 / 步骤 / 坑 / 验证」四段，≤1800 字。不要编造，不要写密钥/密码/token/证件/卡号，不要重复已有记忆或技能。';
    var usr = '【已有长期记忆】\n' + (oldMem.join('\n') || '（空）') +
      '\n\n【已有技能】\n' + (skillNames.join('、') || '（无）') +
      '\n\n【最近 3 天日记】\n' + logs.slice(0, 8000);
    return NET.chatOnce([{ role: 'system', content: sys }, { role: 'user', content: usr }], { temperature: 0.1, maxTokens: 1200, timeout: 60000 })
      .then(function(r){
        var txt = String((r && r.content) || '');
        var m = /\{[\s\S]*\}/.exec(txt);
        if (!m) throw new Error('模型没有返回 JSON');
        var j = JSON.parse(m[0]);
        var applied = 0;
        (j.memory || []).slice(0, 6).forEach(function(s){
          var t = String(s || '').replace(/^[-•]\s*/, '').replace(/^\[[0-9]{4}-[0-9]{2}-[0-9]{2}\]\s*/, '').trim();
          if (!t || t.length > 80) return;
          if (sensitive(t)) return;
          if (oldMem.some(function(x){ return sim(x, t) >= 0.65; })) return;
          var rr = remember(t);
          if (rr && rr.ok) applied++;
        });
        var skName = '';
        var sk = j.skill;
        if (sk && typeof sk === 'object'){
          var nm = String(sk.name || '').toLowerCase().trim();
          var body = String(sk.body || '').trim();
          if (/^[a-z][a-z0-9-]{1,24}$/.test(nm) && body && body.length <= 1800 && !sensitive(body)){
            try {
              var up = EXT.upsert({ kind: 'skill', name: nm, title: String(sk.title || nm).slice(0, 80),
                desc: String(sk.desc || '').slice(0, 160), body: body, modes: ['soul', 'work', 'agent'] });
              if (up && up.ok) skName = nm;
            } catch (e) {}
          }
        }
        var note = String(j.note || '').replace(/\s+/g, ' ').slice(0, 200);
        var log = evoLog();
        log.push({ ts: Date.now(), mem: applied, skill: skName, note: note });
        evoSave(log);
        try { localStorage.setItem(EVO_AT, String(Date.now())); } catch (e) {}
        evoResetTurns();
        return { ok: true, mem: applied, skill: skName, note: note };
      })
      .catch(function(e){ return { ok: false, reason: (e && e.message) || String(e) }; })
      .then(function(res){ _evoBusy = false; _evoFresh = false; return res; });
  }
  function maybeEvolve(){
    /* 自动进化只在 Soul 模式运行：切到 Chat/Work/Agent 后，logTurn 排下的定时器不能再写记忆/技能 */
    if (typeof S === 'undefined' || !S || !S.cfg || S.cfg.mode !== 'soul'){ _evoFresh = false; return; }
    if (!evoOn()){ _evoFresh = false; return; }
    if (evoTurns() < EVO_EVERY){ _evoFresh = false; return; }
    var S0 = (typeof S !== 'undefined') ? S : null;
    if (S0 && (S0.sending || (S0.pend || 0) > 0)){
      setTimeout(maybeEvolve, EVO_DELAY);
      return;
    }
    _evoFresh = true;
    evolve(false).then(function(r){
      if (r && r.ok){
        var bits = [];
        if (r.mem) bits.push('记忆 +' + r.mem);
        if (r.skill) bits.push('技能 ' + r.skill);
        try { UI.toast('Soul 自动进化：' + (bits.join(' · ') || r.note || '完成')); } catch (e) {}
      } else {
        _evoFresh = false;
      }
    });
  }
  function evoStatus(){
    var last = 0; try { last = +localStorage.getItem(EVO_AT) || 0; } catch (e) {}
    var skills = 0;
    try { skills = EXT.registry().filter(function(x){ return x.kind === 'skill' && x.on !== false; }).length; } catch (e) {}
    return { on: evoOn(), at: last, mem: lines(load().memory).length, skills: skills, turns: evoTurns(), log: evoLog() };
  }
  function evoRow(it){
    var row = mk('div', 'soul-skill-row');
    var when = it && it.ts ? new Date(it.ts).toLocaleString() : '';
    var bits = [];
    if (it.mem) bits.push('记忆 +' + it.mem);
    if (it.skill) bits.push('技能 ' + it.skill);
    row.appendChild(mk('span', null, when + ' · ' + (bits.join(' · ') || '无变更') + (it.note ? ' · ' + it.note : '')));
    return row;
  }
  function openEvo(){
    var st = evoStatus();
    var mask = mk('div', 'soul-mask'), box = mk('div', 'soul-box'), head = mk('div', 'soul-head');
    head.appendChild(mk('b', null, 'Soul · 进化日志'));
    var close = mk('button', 'soul-btn', '关闭'); head.appendChild(close);
    var lbl = mk('div', 'soul-lbl', '自动进化：每 6 轮成功对话后在后台提炼记忆/技能（可关闭）');
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = st.on;
    var cbRow = mk('label', 'soul-foot');
    cbRow.appendChild(cb); cbRow.appendChild(mk('span', 'soul-status', '开启自动进化'));
    cb.onchange = function(){ evoOn(!!cb.checked); try { UI.toast(cb.checked ? '已开启自动进化' : '已关闭自动进化'); } catch (e) {} };
    var stat = mk('div', 'soul-status',
      '上次进化：' + (st.at ? new Date(st.at).toLocaleString() : '还没有') +
      ' · 记忆 ' + st.mem + ' 条 · 技能 ' + st.skills + ' 个 · 距下次还差 ' + Math.max(0, EVO_EVERY - st.turns) + ' 轮');
    var list = mk('div', 'soul-skills');
    if (!st.log.length) list.appendChild(mk('div', 'soul-status', '还没有进化记录。'));
    st.log.slice(-30).reverse().slice(0, 12).forEach(function(it){ list.appendChild(evoRow(it)); });
    var foot = mk('div', 'soul-foot');
    var now = mk('button', 'soul-btn soul-primary', '立即进化');
    var mem = mk('button', 'soul-btn', '编辑长期记忆');
    var status = mk('span', 'soul-status', '');
    foot.appendChild(status); foot.appendChild(mem); foot.appendChild(now);
    box.appendChild(head); box.appendChild(lbl); box.appendChild(cbRow); box.appendChild(stat); box.appendChild(list); box.appendChild(foot);
    mask.appendChild(box); document.body.appendChild(mask);
    function closeFn(){ mask.remove(); }
    close.onclick = closeFn;
    mask.addEventListener('click', function(e){ if (e.target === mask) closeFn(); });
    mem.onclick = function(){ closeFn(); openFull(); };
    now.onclick = function(){
      now.disabled = true; status.textContent = '进化中…';
      evolve(true).then(function(r){
        now.disabled = false;
        if (r && r.ok){
          status.textContent = '完成：记忆 +' + r.mem + (r.skill ? ' · 技能 ' + r.skill : '') + (r.note ? ' · ' + r.note : '');
          var log = evoLog();
          list.textContent = '';
          log.slice(-30).reverse().slice(0, 12).forEach(function(it){ list.appendChild(evoRow(it)); });
        } else {
          status.textContent = '未执行：' + ((r && r.reason) || '未知原因');
        }
      });
    };
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
  /* ===== v0.4.1：完全自主 —— 扩展目录 + 自主准则 ===== */
  function clip(s, n){
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  /* 全部已启用扩展的紧凑目录；按 kind+name 稳定排序；总长 ≤7000，工具/技能优先，prompt 最后 */
  function catalog(){
    var reg = [];
    try { if (typeof EXT !== 'undefined' && EXT && EXT.registry) reg = EXT.registry() || []; } catch (e) { reg = []; }
    var G = { tool: [], skill: [], agent: [], plugin: [], mcp: [], prompt: [] };
    reg.forEach(function(it){
      if (!it || it.on === false || !it.kind) return;
      var k = it.kind, nm = String(it.name || it.title || '').trim();
      if (!G[k] || !nm) return;
      if (k === 'plugin') G.plugin.push(nm);
      else if (k === 'prompt') G.prompt.push({ name: nm, body: String(it.body || it.desc || '') });
      else if (k === 'mcp') G.mcp.push(nm + (it.url ? ' ' + it.url : ''));
      else G[k].push(nm + (it.desc || it.title ? '：' + clip(it.desc || it.title, 90) : ''));
    });
    ['tool', 'skill', 'agent', 'plugin', 'mcp', 'prompt'].forEach(function(k){
      if (k === 'prompt') G[k].sort(function(a, b){ return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
      else G[k].sort();
    });
    var MAX = 7000, out = [], used = 0;
    function section(title, list, cap){
      if (!list || !list.length) return;
      var avail = MAX - used;
      if (avail < 80) return;
      var head = title + '\n', body = list.join('\n');
      var txt = head + body;
      if (cap && txt.length > cap) txt = txt.slice(0, cap) + '\n…（已截断）';
      if (txt.length > avail) txt = txt.slice(0, Math.max(0, avail - 24)) + '\n…（目录过长已截断）';
      out.push(txt); used += txt.length + 2;
    }
    var head = '【扩展目录（全部已启用，Soul 可自选）】';
    out.push(head); used += head.length + 1;
    section('工具（围栏首行：```工具名 参数）：', G.tool);
    section('技能（先看目录，需要时 ```skill 名字 取全文）：', G.skill);
    section('智能体（```agent 名字 任务）：', G.agent);
    section('插件：', G.plugin);
    section('MCP：', G.mcp);
    var pl = [];
    var pcap = 3000, pused = 0;
    G.prompt.forEach(function(p){
      if (pused >= pcap) return;
      var body = clip(p.body, 600);
      var line = '- ' + p.name + '：' + body;
      if (pused + line.length > pcap) line = line.slice(0, Math.max(0, pcap - pused)) + '…';
      pl.push(line); pused += line.length + 1;
    });
    section('提示词（可直接参考，不必声明调用）：', pl, pcap);
    var txt = out.join('\n\n');
    return txt.length > MAX ? txt.slice(0, MAX) : txt;
  }
  function autonomyPrompt(){
    return '【Soul 自主准则】\n'
      + '- 你是 Soul。用户不需要、也不能替你勾选插件/技能/工具；全部扩展（已启用）对你开放，按任务自选最少必要工具。\n'
      + '- 先看下面的扩展目录再动手；调用工具就是在回复里写围栏，围栏首行是工具名和参数。\n'
      + '- 不要声称调用了不存在的工具；工具失败就按错误修正一次，仍失败就说明卡在哪一步。\n'
      + '- 高风险或不可逆操作（删除、覆盖、执行命令、装软件、付费、上传）仍按现有权限逐次确认，不要绕过。\n'
      + '- 长期记忆与技能由系统在后台自动沉淀；不要编造「已写入记忆」「已创建技能」。';
  }
  /* ===== v0.4.2：Soul 人格（脸 / 性格 / 声音 / 能力 / 记忆 / 身体） ===== */
  function pdef(){
    var d = (typeof DEF_CFG !== 'undefined' && DEF_CFG.soulProfile) ? DEF_CFG.soulProfile : {
      name: 'Soul', avatar: '', avatarEmoji: '🌙', personality: '',
      voice: { enabled: false, name: '', rate: 1 }, sttLang: 'zh-CN',
      abilities: { llm: '', image: true, imageModel: '', video: false, videoBase: '', videoModel: '', search: false, attach: false },
      body: { agent: true, files: true, browser: true, commands: true, subagents: true },
      memory: { autoEvolve: true, saveLocal: true }
    };
    return pmerge({}, d);
  }
  function pmerge(base, extra){
    var out = {}, k;
    if (base && typeof base === 'object'){
      for (k in base){
        if (!Object.prototype.hasOwnProperty.call(base, k)) continue;
        var v = base[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = pmerge({}, v);
        else if (Array.isArray(v)) out[k] = v.slice();
        else out[k] = v;
      }
    }
    if (extra && typeof extra === 'object'){
      for (k in extra){
        if (!Object.prototype.hasOwnProperty.call(extra, k)) continue;
        var e = extra[k];
        if (e && typeof e === 'object' && !Array.isArray(e) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]))
          out[k] = pmerge(out[k], e);
        else out[k] = e;
      }
    }
    return out;
  }
  function profile(){
    var cur = (typeof S !== 'undefined' && S.cfg && S.cfg.soulProfile) ? S.cfg.soulProfile : {};
    var out = pmerge(pdef(), cur);
    /* TTS 总开关与 Soul 声音开关保持同一真相（兼容早期只改 cfg.ttsEnabled 的配置） */
    if (typeof S !== 'undefined' && S.cfg && typeof S.cfg.ttsEnabled === 'boolean'){
      if (!out.voice || typeof out.voice !== 'object') out.voice = pmerge(pdef().voice, {});
      out.voice.enabled = !!S.cfg.ttsEnabled;
    }
    return out;
  }
  function setProfile(patch){
    var next = pmerge(profile(), patch || {});
    try { setCfg({ soulProfile: next }); } catch (e) { if (S && S.cfg) S.cfg.soulProfile = next; }
    try { saveCfg(); } catch (e) {}
    return next;
  }
  function avatar(){
    var p = profile(), a = String(p.avatar || '');
    if (/^data:image\//i.test(a)) return a;
    return p.avatarEmoji || '🌙';
  }
  function profilePrompt(){
    var p = profile(), a = p.abilities || {}, b = p.body || {}, m = p.memory || {};
    var name = String(p.name || 'Soul').slice(0, 40);
    var pers = String(p.personality || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
      || '温暖、直接、可靠；先理解人再谈任务；不敷衍、不空话，能动手就动手。';
    var imgModelName = a.imageModel || ((S && S.cfg && S.cfg.imgModel) || '');
    var vidModelName = a.videoModel || ((S && S.cfg && S.cfg.videoModel) || '');
    var img = (a.image !== false) ? ('开' + (imgModelName ? '（' + imgModelName + '）' : '')) : '关';
    var vid = a.video ? ('开' + (vidModelName ? '（' + vidModelName + '）' : '')) : '关';
    var llm = a.llm || ((S && S.cfg && S.cfg.currentModel) || '跟随当前模型');
    var body = [];
    if (b.agent !== false) body.push('Agent 能力');
    if (b.files !== false) body.push('可读写文件');
    if (b.commands !== false) body.push('可执行命令');
    if (b.browser !== false) body.push('可开浏览器');
    if (b.subagents !== false) body.push('可派子智能体');
    return '【Soul 人格】\n'
      + '名字：' + name + '\n'
      + '性格/说话方式：' + pers + '\n'
      + '能力：LLM ' + llm + ' / 生图 ' + img + ' / 生视频 ' + vid + ' / 联网 ' + (a.search ? '开' : '关') + ' / 附件 ' + (a.attach ? '开' : '关') + '\n'
      + '身体：' + (body.join(' / ') || '（无）') + '\n'
      + '记忆：本地自主进化（' + (m.autoEvolve !== false ? '开' : '关') + '）';
  }
  function speak(text){
    if (!window.VOICE) return Promise.reject(new Error('语音组件未加载'));
    return VOICE.speak(text);
  }
  function listen(cb){
    if (!window.VOICE) return Promise.reject(new Error('语音组件未加载'));
    return VOICE.listen(cb);
  }
  function speakLast(){
    if (!window.VOICE) return Promise.reject(new Error('语音组件未加载'));
    return VOICE.speakLast();
  }
  function openProfile(){
    var P = profile();
    var mask = mk('div', 'soul-mask'), box = mk('div', 'soul-box');
    var head = mk('div', 'soul-head');
    var title = mk('b', null, 'Soul · ' + (P.name || 'Soul'));
    head.appendChild(title);
    var close = mk('button', 'soul-btn', '关闭'); head.appendChild(close);
    var tabs = mk('div', 'soul-tabs'), panes = mk('div', 'soul-panes');
    var saveState = {};
    function cur(){ return profile(); }
    function saved(k){
      if (!saveState[k]) return;
      saveState[k].textContent = '已保存 ' + new Date().toLocaleTimeString();
    }
    function pane(k){
      var d = mk('div', 'soul-pane'); d.id = 'soul-profile-' + k; d.style.display = 'none';
      panes.appendChild(d); return d;
    }
    function tabBtn(k, label){
      var b = mk('button', 'soul-tab', label);
      b.onclick = function(){
        Array.prototype.forEach.call(tabs.children, function(x){ x.classList.remove('on'); });
        Array.prototype.forEach.call(panes.children, function(x){ x.style.display = 'none'; });
        b.classList.add('on');
        var p = document.getElementById('soul-profile-' + k); if (p) p.style.display = 'block';
      };
      tabs.appendChild(b); return b;
    }
    function field(label, node){
      var d = mk('div', 'soul-field');
      d.appendChild(mk('label', null, label)); d.appendChild(node);
      return d;
    }
    function inp(type, value, ph){
      var i = mk('input', 'soul-inp');
      i.type = type || 'text'; i.value = value == null ? '' : String(value);
      if (ph) i.placeholder = ph;
      return i;
    }
    function chk(checked, label){
      var l = mk('label', 'soul-check');
      var c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!checked;
      l.appendChild(c); l.appendChild(mk('span', null, label));
      return { row: l, box: c };
    }
    function syncFace(){
      var av = avatar();
      var targets = document.querySelectorAll('.sp-face');
      for (var i = 0; i < targets.length; i++){
        var t = targets[i]; t.textContent = '';
        if (/^data:image\//i.test(av)){ var im = document.createElement('img'); im.src = av; im.alt = 'Soul 头像'; t.appendChild(im); }
        else t.textContent = av;
      }
    }
    /* 1. 脸 */
    var pFace = pane('face');
    var faceBox = mk('div', 'soul-face');
    var faceWrap = mk('div', 'soul-profile-face');
    var faceSide = mk('div', 'soul-face-side');
    function paintFace(){
      var p = cur(), av = String(p.avatar || '');
      faceBox.textContent = '';
      if (/^data:image\//i.test(av)){ var im = document.createElement('img'); im.src = av; im.alt = 'Soul 头像'; faceBox.appendChild(im); }
      else faceBox.appendChild(mk('span', null, p.avatarEmoji || '🌙'));
    }
    var nameInp = inp('text', P.name || 'Soul', 'Soul 的名字');
    nameInp.id = 'sp-name';
    var nameTimer = null;
    nameInp.addEventListener('input', function(){
      clearTimeout(nameTimer);
      nameTimer = setTimeout(function(){
        var nm = String(nameInp.value || '').trim().slice(0, 40) || 'Soul';
        setProfile({ name: nm });
        title.textContent = 'Soul · ' + nm;
        saved('face');
      }, 300);
    });
    faceSide.appendChild(field('名字', nameInp));
    var emoRow = mk('div', 'soul-emoji-row');
    ['🌙','🦊','🧠','🌊','🐱','🦉','🌸','⚡','🪐','🐳','🤖','👤'].forEach(function(e){
      var eb = mk('button', 'soul-emoji', e);
      eb.type = 'button';
      eb.onclick = function(){ setProfile({ avatarEmoji: e, avatar: '' }); paintFace(); syncFace(); saved('face'); };
      emoRow.appendChild(eb);
    });
    faceSide.appendChild(emoRow);
    var upRow = mk('div', 'soul-foot');
    var fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none';
    var up = mk('button', 'soul-btn', '上传图片');
    var clrFace = mk('button', 'soul-btn', '用 emoji');
    saveState.face = mk('span', 'soul-status', '本地保存');
    upRow.appendChild(up); upRow.appendChild(clrFace); upRow.appendChild(saveState.face);
    faceSide.appendChild(upRow);
    faceWrap.appendChild(faceBox); faceWrap.appendChild(faceSide);
    pFace.appendChild(faceWrap); pFace.appendChild(mk('div', 'soul-note', '脸只存在本地；上传图片会裁成 128×128 的 data URL，不联网。'));
    pFace.appendChild(fi);
    up.onclick = function(){ fi.click(); };
    fi.onchange = function(){
      var f = fi.files && fi.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function(){
        var im = new Image();
        im.onload = function(){
          try {
            var c = document.createElement('canvas'); c.width = 128; c.height = 128;
            var ctx = c.getContext('2d'), r = Math.max(128 / im.width, 128 / im.height);
            var w = im.width * r, h = im.height * r;
            ctx.drawImage(im, (128 - w) / 2, (128 - h) / 2, w, h);
            setProfile({ avatar: c.toDataURL('image/jpeg', 0.9) });
            paintFace(); syncFace(); saved('face');
          } catch (e) {
            setProfile({ avatar: String(rd.result || '') });
            paintFace(); syncFace(); saved('face');
          }
        };
        im.onerror = function(){ try { UI.toast('图片读取失败', true); } catch (e) {} };
        im.src = String(rd.result || '');
      };
      rd.readAsDataURL(f);
    };
    clrFace.onclick = function(){ setProfile({ avatar: '' }); paintFace(); syncFace(); saved('face'); };
    /* 2. 性格 */
    var pPers = pane('pers');
    var ta = mk('textarea', 'soul-ta soul-ta-lg');
    ta.id = 'sp-personality';
    ta.value = P.personality || '';
    ta.placeholder = '例：叫用户「老板」；说话简短直接，先给结论；不确定就说不确定，不编造；不主动灌鸡汤；遇到高风险操作先提醒。';
    var persTimer = null;
    saveState.pers = mk('span', 'soul-status', '输入 300ms 后自动保存');
    ta.addEventListener('input', function(){
      clearTimeout(persTimer);
      persTimer = setTimeout(function(){
        setProfile({ personality: String(ta.value || '').slice(0, 1200) });
        saveState.pers.textContent = '已保存 ' + new Date().toLocaleTimeString();
      }, 300);
    });
    pPers.appendChild(mk('div', 'soul-lbl', '性格 / 说话方式 / 边界（会进入 Soul 的 system prompt；≤1200 字）'));
    pPers.appendChild(ta); pPers.appendChild(saveState.pers);
    /* 3. 声音 */
    var pVoice = pane('voice');
    var vp = P.voice || {};
    var ttsRow = chk(!!(S.cfg.ttsEnabled || vp.enabled), '启用语音合成（TTS）');
    ttsRow.box.id = 'sp-tts';
    ttsRow.box.onchange = function(){
      var on = !!ttsRow.box.checked;
      setProfile({ voice: { enabled: on } });
      try { setCfg({ ttsEnabled: on }); saveCfg(); } catch (e) {}
      document.body.classList.toggle('voice-tts', on);
      if (!on && window.VOICE) VOICE.stop();
      saved('voice');
    };
    pVoice.appendChild(ttsRow.row);
    var vSel = document.createElement('select'); vSel.className = 'soul-inp';
    function fillVoices(){
      var list = [];
      try { list = (window.VOICE && VOICE.voices) ? VOICE.voices() : []; } catch (e) { list = []; }
      var old = vSel.value;
      vSel.textContent = '';
      vSel.appendChild(mk('option', null, '系统默认'));
      (list || []).forEach(function(v){
        var o = mk('option', null, (v.name || '声音') + (v.lang ? ' · ' + v.lang : ''));
        o.value = v.name || '';
        vSel.appendChild(o);
      });
      var want = (cur().voice || {}).name || old || '';
      if (want) vSel.value = want;
    }
    fillVoices();
    vSel.onchange = function(){ setProfile({ voice: { name: vSel.value || '' } }); try { setCfg({ ttsVoice: vSel.value || '' }); saveCfg(); } catch (e) {} saved('voice'); };
    pVoice.appendChild(field('声音（浏览器/系统提供的语音）', vSel));
    var rateVal = document.createElement('span'); rateVal.className = 'soul-status';
    var rate = document.createElement('input'); rate.type = 'range'; rate.min = '0.5'; rate.max = '2'; rate.step = '0.1'; rate.value = String(vp.rate || 1); rate.style.width = '100%';
    function showRate(){ rateVal.textContent = '语速 ' + Number(rate.value).toFixed(1) + '×'; }
    showRate();
    rate.addEventListener('input', showRate);
    rate.addEventListener('change', function(){ setProfile({ voice: { rate: Number(rate.value) || 1 } }); try { setCfg({ ttsRate: Number(rate.value) || 1 }); saveCfg(); } catch (e) {} saved('voice'); });
    var rateField = field('语速', rate); rateField.appendChild(rateVal); pVoice.appendChild(rateField);
    var testRow = mk('div', 'soul-foot');
    var test = mk('button', 'soul-btn', '试听');
    test.onclick = function(){
      if (!window.VOICE) return void UI.toast('语音组件未加载', true);
      VOICE.speak('你好，我是 ' + (cur().name || 'Soul') + '。这是当前的声音。')
        .catch(function(e){ UI.toast('试听失败：' + ((e && e.message) || e), true); });
    };
    testRow.appendChild(test); testRow.appendChild(saveState.voice = mk('span', 'soul-status', '本地保存'));
    pVoice.appendChild(testRow);
    var sttLang = inp('text', P.sttLang || 'zh-CN', '如 zh-CN / en-US');
    sttLang.onchange = function(){ setProfile({ sttLang: String(sttLang.value || '').trim() || 'zh-CN' }); try { setCfg({ sttLang: String(sttLang.value || '').trim() || 'zh-CN' }); saveCfg(); } catch (e) {} saved('voice'); };
    pVoice.appendChild(field('语音输入语言（STT）', sttLang));
    var voiceChanged = function(){ fillVoices(); };
    try { if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', voiceChanged); } catch (e) {}
    /* 4. 能力 */
    var pAb = pane('ab');
    var ab = P.abilities || {};
    var llmSel = document.createElement('select'); llmSel.className = 'soul-inp';
    var mlist = (S.cfg.models || []).slice();
    (S.cfg.presets || []).forEach(function(pg){
      (pg.models || []).forEach(function(m){ if (m && mlist.indexOf(m) < 0) mlist.push(m); });
    });
    if (S.cfg.currentModel && mlist.indexOf(S.cfg.currentModel) < 0) mlist.unshift(S.cfg.currentModel);
    if (!mlist.length) mlist.push('');
    mlist.forEach(function(m){
      var o = mk('option', null, m ? modelLabel(m) : '跟随当前模型'); o.value = m;
      llmSel.appendChild(o);
    });
    llmSel.value = ab.llm || S.cfg.currentModel || '';
    llmSel.onchange = function(){
      setProfile({ abilities: { llm: llmSel.value || '' } });
      if (llmSel.value){ try { setCfg({ currentModel: llmSel.value }); saveCfg(); } catch (e) {} }
      saved('ab');
    };
    pAb.appendChild(field('LLM 模型（只影响 Soul 的对话模型）', llmSel));
    var imgRow = chk(ab.image !== false, '生图');
    imgRow.box.id = 'sp-img';
    var imgModel = inp('text', ab.imageModel || S.cfg.imgModel || '', '如 gpt-image-1');
    imgModel.id = 'sp-img-model';
    imgRow.box.onchange = function(){
      var on = !!imgRow.box.checked;
      setProfile({ abilities: { image: on } });
      if (on && imgModel.value) { try { setCfg({ imgModel: imgModel.value }); saveCfg(); } catch (e) {} }
      saved('ab');
    };
    imgModel.addEventListener('change', function(){
      setProfile({ abilities: { imageModel: String(imgModel.value || '').trim() } });
      try { setCfg({ imgModel: String(imgModel.value || '').trim() || S.cfg.imgModel }); saveCfg(); } catch (e) {}
      saved('ab');
    });
    var imgWrap = mk('div', 'soul-grid2'); imgWrap.appendChild(imgRow.row); imgWrap.appendChild(field('生图模型', imgModel));
    pAb.appendChild(imgWrap);
    var vidRow = chk(!!ab.video, '生视频');
    vidRow.box.id = 'sp-video';
    var vBase = inp('text', ab.videoBase || S.cfg.videoBase || '', 'https://api.example.com/v1');
    vBase.id = 'sp-video-base';
    var vModel = inp('text', ab.videoModel || S.cfg.videoModel || '', '如 sora-2 / veo-3');
    vModel.id = 'sp-video-model';
    var vSize = document.createElement('select'); vSize.className = 'soul-inp';
    vSize.id = 'sp-video-size';
    ['1280x720','720x1280','1024x1024','1920x1080'].forEach(function(v){
      var o = mk('option', null, v); o.value = v;
      vSize.appendChild(o);
    });
    vSize.value = S.cfg.videoSize || '1280x720';
    function syncVideoCfg(){
      try {
        setCfg({ videoBase: String(vBase.value || '').trim(), videoModel: String(vModel.value || '').trim(), videoSize: vSize.value || '1280x720' });
        saveCfg();
      } catch (e) {}
    }
    vidRow.box.onchange = function(){
      var on = !!vidRow.box.checked;
      setProfile({ abilities: { video: on } });
      syncVideoCfg();
      saved('ab');
    };
    vBase.addEventListener('change', function(){ setProfile({ abilities: { videoBase: String(vBase.value || '').trim() } }); syncVideoCfg(); saved('ab'); });
    vModel.addEventListener('change', function(){ setProfile({ abilities: { videoModel: String(vModel.value || '').trim() } }); syncVideoCfg(); saved('ab'); });
    pAb.appendChild(vidRow.row);
    pAb.appendChild(field('生视频 Base URL（空=不可用；Key 跟随当前 API Key）', vBase));
    pAb.appendChild(field('生视频模型', vModel));
    vSize.addEventListener('change', function(){ syncVideoCfg(); saved('ab'); });
    pAb.appendChild(field('生视频尺寸', vSize));
    var schRow = chk(!!ab.search, '联网搜索');
    schRow.box.id = 'sp-search';
    schRow.box.onchange = function(){
      var on = !!schRow.box.checked;
      setProfile({ abilities: { search: on } });
      try { setCfg({ webSearch: on }); saveCfg(); } catch (e) {}
      saved('ab');
    };
    pAb.appendChild(schRow.row);
    var atRow = chk(!!ab.attach, '附件（保持开启时，Soul 仍按极简输入区隐藏上传按钮；可拖放/粘贴）');
    atRow.box.id = 'sp-attach';
    atRow.box.onchange = function(){ setProfile({ abilities: { attach: !!atRow.box.checked } }); saved('ab'); };
    pAb.appendChild(atRow.row);
    pAb.appendChild(mk('div', 'soul-note', '能力开关会同步到实际请求字段（imgModel / imgBase / videoBase / videoModel / webSearch）。'));
    pAb.appendChild(saveState.ab = mk('span', 'soul-status', '本地保存'));
    /* 5. 记忆 */
    var pMem = pane('mem');
    var mm = P.memory || {};
    var autoRow = chk(mm.autoEvolve !== false, '自动进化（每 6 轮成功对话后在后台提炼记忆/技能）');
    autoRow.box.id = 'sp-auto';
    autoRow.box.onchange = function(){
      var on = !!autoRow.box.checked;
      setProfile({ memory: { autoEvolve: on } });
      evoOn(on);
      saved('mem');
    };
    pMem.appendChild(autoRow.row);
    var localRow = chk(mm.saveLocal !== false, '本地保存（宿主内同时写 USER.md / MEMORY.md / DREAMS.md）');
    localRow.box.onchange = function(){ setProfile({ memory: { saveLocal: !!localRow.box.checked } }); saved('mem'); };
    pMem.appendChild(localRow.row);
    var st = evoStatus();
    pMem.appendChild(mk('div', 'soul-status', '记忆 ' + st.mem + ' 条 · 技能 ' + st.skills + ' 个 · 上次进化 ' + (st.at ? new Date(st.at).toLocaleString() : '还没有')));
    pMem.appendChild(mk('div', 'soul-note', '本地文件：' + (window.NET && NET.bridge && NET.bridge.ok ? '%USERPROFILE%\\SoloChat\\memory（USER.md / MEMORY.md / DREAMS.md）' : '浏览器 localStorage（sc.soul.v1）；桌面版会额外落盘')));
    var memRow = mk('div', 'soul-foot');
    var openMem = mk('button', 'soul-btn', '打开完整记忆');
    openMem.onclick = function(){ closeFn(); openFull(); };
    memRow.appendChild(openMem); memRow.appendChild(saveState.mem = mk('span', 'soul-status', ''));
    pMem.appendChild(memRow);
    /* 6. 身体 */
    var pBody = pane('body');
    var bd = P.body || {};
    var bodyMap = [
      ['agent', 'Agent 能力总开关'],
      ['files', '文件读写（工作区内）'],
      ['commands', '执行命令（逐次确认）'],
      ['browser', '打开浏览器 / 读页面'],
      ['subagents', '派子智能体']
    ];
    var bodyBoxes = {};
    bodyMap.forEach(function(it){
      var row = chk(bd[it[0]] !== false, it[1]);
      row.box.setAttribute('data-sp-body', it[0]);
      row.box.onchange = function(){
        var patch = {}; patch[it[0]] = !!row.box.checked;
        setProfile({ body: patch }); saved('body');
      };
      bodyBoxes[it[0]] = row.box;
      pBody.appendChild(row.row);
    });
    pBody.appendChild(mk('div', 'soul-note', '身体开关会写进人格提示；高风险/不可逆操作仍由现有权限系统逐次确认，不能被人格绕过。'));
    pBody.appendChild(saveState.body = mk('span', 'soul-status', '本地保存'));
    /* 7. 进化 */
    var pEvo = pane('evo');
    var st2 = evoStatus();
    pEvo.appendChild(mk('div', 'soul-lbl', '持续进化：每 6 轮成功对话后在后台提炼稳定记忆与可复用技能'));
    pEvo.appendChild(mk('div', 'soul-status', '上次进化：' + (st2.at ? new Date(st2.at).toLocaleString() : '还没有') + ' · 累计记忆 ' + st2.mem + ' 条 · 技能 ' + st2.skills + ' 个'));
    var evoRow = mk('div', 'soul-foot');
    var evoNow = mk('button', 'soul-btn soul-primary', '立即进化');
    var evoLogBtn = mk('button', 'soul-btn', '查看日志');
    var evoStat = mk('span', 'soul-status', '');
    evoRow.appendChild(evoStat); evoRow.appendChild(evoLogBtn); evoRow.appendChild(evoNow);
    pEvo.appendChild(evoRow);
    evoNow.onclick = function(){
      evoNow.disabled = true; evoStat.textContent = '进化中…';
      evolve(true).then(function(r){
        evoNow.disabled = false;
        evoStat.textContent = (r && r.ok) ? ('完成：记忆 +' + r.mem + (r.skill ? ' · 技能 ' + r.skill : '')) : ('未执行：' + ((r && r.reason) || '未知'));
      });
    };
    evoLogBtn.onclick = function(){ closeFn(); openEvo(); };
    /* 组装 */
    box.appendChild(head); box.appendChild(tabs); box.appendChild(panes);
    var foot = mk('div', 'soul-foot');
    foot.appendChild(mk('span', 'soul-status', '所有修改即时保存；关闭不撤销。'));
    foot.appendChild(close);
    box.appendChild(foot);
    mask.appendChild(box); document.body.appendChild(mask);
    function closeFn(){
      try { if (window.speechSynthesis) speechSynthesis.removeEventListener('voiceschanged', voiceChanged); } catch (e) {}
      mask.remove();
      try { if (typeof UI !== 'undefined' && UI.updateEmpty) UI.updateEmpty(); } catch (e) {}
    }
    close.onclick = closeFn;
    mask.addEventListener('click', function(e){ if (e.target === mask) closeFn(); });
    var first = tabBtn('face', '脸'); tabBtn('pers', '性格'); tabBtn('voice', '声音'); tabBtn('ab', '能力'); tabBtn('mem', '记忆'); tabBtn('body', '身体'); tabBtn('evo', '进化');
    first.classList.add('on'); pFace.style.display = 'block';
    paintFace(); syncFace();
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
    var memBlock = L.length
      ? 'Soul 记忆（长期、跨会话；以文件为准，冲突时问用户；本轮用到 ' + used + ' 条）：\n' + L.join('\n\n')
      : '';
    var cat = catalog();
    var pers = profilePrompt();
    return (memBlock ? memBlock + '\n\n' : '') + autonomyPrompt() + (pers ? '\n\n' + pers : '') + (cat ? '\n\n' + cat : '');
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
  function candidate(text, auto){
    var t = String(text || '').trim().replace(/\s+/g, ' ');
    if (!t || t.length < 6 || t.length > 160) return auto ? { ok: false, action: 'skip', text: t } : null;
    if (sensitive(t)) return auto ? { ok: false, action: 'rejected', text: t } : null;
    if (!/(我喜欢|我习惯|我通常|我一般|我每周|我每天|以后都|以后别|下次别|别再|记住我|我的.{0,8}是|我在用|我住|我叫)/.test(t)) return auto ? { ok: false, action: 'skip', text: t } : null;
    var list = pendingLoad();
    if (list.some(function(x){ return sim(x.text, t) >= 0.55; })) return auto ? { ok: false, action: 'dup', text: t } : null;
    if (lines(load().memory).some(function(l){ return sim(entryOf(l).text, t) >= 0.55; })) return auto ? { ok: false, action: 'dup', text: t } : null;
    /* v0.4.1：自动沉淀 —— 过敏感与去重后直接写长期记忆，不再进待确认 */
    if (auto === true){
      var r = remember(t);
      return { ok: !!r.ok, action: r.ok ? (r.action || 'add') : 'rejected', text: t };
    }
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
    return { last: last, turns: Math.floor(today.length / 2), mem: memN, user: o.user.trim() ? 1 : 0, name: (profile().name || 'Soul') };
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
        var p = document.getElementById('soul-pane-' + k); if (p) p.style.display = 'block';
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
    /* v0.4.1：进化页签 */
    var pE = pane('evo');
    var st0 = evoStatus();
    pE.appendChild(mk('div', 'soul-lbl', '持续进化：每 6 轮成功对话后在后台自动提炼稳定记忆与可复用技能'));
    var ecb = document.createElement('input'); ecb.type = 'checkbox'; ecb.checked = st0.on;
    var ecbRow = mk('label', 'soul-foot');
    ecbRow.appendChild(ecb);
    ecbRow.appendChild(mk('span', 'soul-status', '开启自动进化（关掉后只保留 /evolve 手动执行）'));
    ecb.onchange = function(){
      evoOn(!!ecb.checked);
      status.textContent = ecb.checked ? '已开启自动进化' : '已关闭自动进化';
    };
    pE.appendChild(ecbRow);
    pE.appendChild(mk('div', 'soul-status',
      '上次进化：' + (st0.at ? new Date(st0.at).toLocaleString() : '还没有') +
      ' · 累计记忆 ' + st0.mem + ' 条 · 技能 ' + st0.skills + ' 个'));
    var eActions = mk('div', 'soul-foot');
    var eNow = mk('button', 'soul-btn soul-primary', '立即进化');
    var eLog = mk('button', 'soul-btn', '查看日志');
    eActions.appendChild(eNow); eActions.appendChild(eLog);
    pE.appendChild(eActions);
    var eList = mk('div', 'soul-skills');
    if (!st0.log.length) eList.appendChild(mk('div', 'soul-status', '还没有进化记录。'));
    st0.log.slice(-30).reverse().slice(0, 6).forEach(function(it){ eList.appendChild(evoRow(it)); });
    pE.appendChild(eList);
    eNow.onclick = function(){
      eNow.disabled = true;
      evolve(true).then(function(r){
        eNow.disabled = false;
        status.textContent = (r && r.ok) ? ('已进化：记忆 +' + r.mem + (r.skill ? ' · 技能 ' + r.skill : '')) : ('未执行：' + ((r && r.reason) || '未知'));
        eList.textContent = '';
        evoLog().slice(-30).reverse().slice(0, 6).forEach(function(it){ eList.appendChild(evoRow(it)); });
      });
    };
    eLog.onclick = function(){ closeFn(); openEvo(); };
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
    var first = tabBtn('user', '用户画像'); tabBtn('mem', '长期记忆'); tabBtn('pend', '待确认'); tabBtn('day', '日记'); tabBtn('time', '时间线'); tabBtn('skill', '技能'); tabBtn('evo', '进化');
    first.classList.add('on'); pU.style.display = 'block';
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
    timeline: timeline, maybeDream: maybeDream, semOn: semOn,
    /* v0.4.1：完全自主 + 持续进化 */
    catalog: catalog, autonomyPrompt: autonomyPrompt, evolve: evolve, evoLog: evoLog, evoOn: evoOn,
    evoStatus: evoStatus, openEvo: openEvo, maybeEvolve: maybeEvolve,
    /* v0.4.2：人格设置 + 声音代理 */
    profile: profile, setProfile: setProfile, avatar: avatar, openProfile: openProfile, profilePrompt: profilePrompt,
    speak: speak, listen: listen, speakLast: speakLast };
})();
