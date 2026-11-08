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
  function score(q, e){
    var rel = sim(q, e.text);
    if (rel <= 0.03) return 0;                    /* 与问题无关的记忆不因「新」而入选 */
    var rec = Math.exp(-daysAgo(e.date) / 30);
    return 0.55 * rel + 0.25 * rec + 0.20 * prior(e.text);
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
  window.SOUL = { prompt: prompt, remember: remember, forget: forget, search: search, open: open, load: load, save: save };
})();
