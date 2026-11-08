/* Soul S1：长期记忆核心（文件优先的网页版）——USER / MEMORY 两层，每轮注入。
   存储：localStorage sc.soul.v1；可导出 Markdown。入口：/memory 或模式 Soul。 */
(function(){
  'use strict';
  var KEY = 'sc.soul.v1';
  function load(){
    try { var o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; return { user: String(o.user || ''), memory: String(o.memory || ''), updated: o.updated || 0 }; }
    catch (e) { return { user: '', memory: '', updated: 0 }; }
  }
  function save(o){
    o.updated = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  }
  function prompt(){
    var o = load(), L = [];
    if (o.user.trim()) L.push('【用户画像】\n' + o.user.trim().slice(0, 600));
    if (o.memory.trim()) L.push('【长期记忆】\n' + o.memory.trim().slice(0, 1200));
    return L.length ? 'Soul 记忆（长期、跨会话；以此为准，冲突时问用户）：\n' + L.join('\n\n') : '';
  }
  function remember(text){
    var t = String(text || '').trim();
    if (!t) return '';
    var o = load();
    var d = new Date(), p = function(n){ return (n < 10 ? '0' : '') + n; };
    var stamp = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    o.memory = (o.memory.trim() ? o.memory.trim() + '\n' : '') + '- [' + stamp + '] ' + t.replace(/\s+/g, ' ');
    save(o);
    return stamp;
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
      save({ user: uTa.value.slice(0, 600), memory: mTa.value.slice(0, 1200) });
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
  window.SOUL = { prompt: prompt, remember: remember, open: open, load: load, save: save };
})();
