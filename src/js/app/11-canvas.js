/* C5：Chat 文档画布 —— 长文/代码产物可编辑、保存、版本回退。
   存储沿用快照思路：按会话分文档，localStorage 键 sc.canvas.v1。
   入口：消息「画布」按钮 / /canvas。 */
(function(){
  'use strict';
  var KEY = 'sc.canvas.v1';
  function st(){
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function put(o){ try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  function sid(){ try { return (window._S && window._S.sid) || 'draft'; } catch (e) { return 'draft'; } }
  function mk(tag, cls, txt){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function titleOf(t){
    var s = String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`_\-]/g, ' ').replace(/\s+/g, ' ').trim();
    return (s.slice(0, 24) || '未命名');
  }
  function hm(ts){
    var d = new Date(ts || Date.now());
    function p(n){ return (n < 10 ? '0' : '') + n; }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function docsOf(o, s){
    if (!Array.isArray(o[s])) o[s] = [];
    return o[s];
  }
  function curOf(o, s){
    var list = docsOf(o, s);
    var id = o._cur && o._cur[s];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || null;
  }
  var refs = null;
  function close(){
    var m = document.querySelector('.cv-mask');
    if (m) m.remove();
    refs = null;
  }
  function render(){
    var s = sid(), o = st(), list = docsOf(o, s);
    var doc = curOf(o, s);
    if (!doc){
      doc = { id: 'cv' + Date.now().toString(36), title: '未命名', text: '', ts: Date.now(), versions: [] };
      list.unshift(doc);
      o._cur = o._cur || {}; o._cur[s] = doc.id;
      put(o);
    }
    var old = document.querySelector('.cv-mask');
    if (old) old.remove();
    var mask = mk('div', 'cv-mask');
    var box = mk('div', 'cv-box');
    var head = mk('div', 'cv-head');
    head.appendChild(mk('b', 'cv-title', '画布'));
    var sel = mk('select', 'cv-docs');
    list.forEach(function(d){
      var op = mk('option', null, d.title + '（' + hm(d.ts) + '）');
      op.value = d.id;
      if (d.id === doc.id) op.selected = true;
      sel.appendChild(op);
    });
    head.appendChild(sel);
    var bNew = mk('button', 'cv-btn', '新建');
    var bClose = mk('button', 'cv-btn', '关闭');
    head.appendChild(bNew); head.appendChild(bClose);
    var ta = mk('textarea', 'cv-ta');
    ta.value = doc.text || '';
    ta.placeholder = '在这里写长文或改代码；保存后进版本历史，可回退。';
    var foot = mk('div', 'cv-foot');
    var vs = mk('select', 'cv-vers');
    var vlist = doc.versions || [];
    vs.appendChild(mk('option', null, vlist.length ? '历史版本（' + vlist.length + '）' : '暂无历史版本'));
    vs.firstChild.value = '';
    vlist.forEach(function(v, i){
      var op = mk('option', null, hm(v.ts) + ' · ' + String(v.t || '').replace(/\s+/g, ' ').slice(0, 20));
      op.value = String(i);
      vs.appendChild(op);
    });
    var bBack = mk('button', 'cv-btn', '回退');
    var status = mk('span', 'cv-status', '');
    var bSave = mk('button', 'cv-btn cv-primary', '保存');
    foot.appendChild(vs); foot.appendChild(bBack); foot.appendChild(status); foot.appendChild(bSave);
    box.appendChild(head); box.appendChild(ta); box.appendChild(foot);
    mask.appendChild(box);
    document.body.appendChild(mask);
    refs = { mask: mask, ta: ta, status: status, sel: sel, vs: vs, doc: doc, s: s };

    function autosave(){
      doc.text = ta.value;
      doc.ts = Date.now();
      if (!doc.title || doc.title === '未命名') doc.title = titleOf(ta.value);
      put(o);
    }
    function refreshVers(){
      vs.innerHTML = '';
      vs.appendChild(mk('option', null, vlist.length ? '历史版本（' + vlist.length + '）' : '暂无历史版本'));
      vs.firstChild.value = '';
      vlist.forEach(function(v, i){
        var op = mk('option', null, hm(v.ts) + ' · ' + String(v.t || '').replace(/\s+/g, ' ').slice(0, 20));
        op.value = String(i);
        vs.appendChild(op);
      });
    }
    bSave.onclick = function(){
      autosave();
      var last = doc.versions && doc.versions[0];
      if (!last || last.t !== doc.text){
        doc.versions.unshift({ t: doc.text, ts: Date.now() });
        if (doc.versions.length > 20) doc.versions.length = 20;
      }
      put(o);
      refreshVers();
      sel.options[sel.selectedIndex] && (sel.options[sel.selectedIndex].text = doc.title + '（' + hm(doc.ts) + '）');
      status.textContent = '已保存 ' + hm(doc.ts);
    };
    bBack.onclick = function(){
      var i = vs.value;
      if (i === '' || !vlist[+i]){ status.textContent = '先选一个历史版本'; return; }
      ta.value = vlist[+i].t;
      status.textContent = '已载入 ' + hm(vlist[+i].ts) + ' 的版本，点保存生效';
    };
    bNew.onclick = function(){
      autosave();
      var d = { id: 'cv' + Date.now().toString(36), title: '未命名', text: '', ts: Date.now(), versions: [] };
      list.unshift(d);
      o._cur[s] = d.id;
      put(o);
      render();
    };
    bClose.onclick = close;
    sel.onchange = function(){
      autosave();
      o._cur[s] = sel.value;
      put(o);
      render();
    };
    ta.addEventListener('keydown', function(e){
      if (e.key === 'Escape'){ e.preventDefault(); close(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')){ e.preventDefault(); bSave.onclick(); }
    });
    mask.addEventListener('click', function(e){ if (e.target === mask) close(); });
    ta.focus();
  }
  function open(text, title){
    var s = sid(), o = st(), list = docsOf(o, s);
    if (text != null){
      var d = { id: 'cv' + Date.now().toString(36), title: title || titleOf(text), text: String(text), ts: Date.now(), versions: [] };
      list.unshift(d);
      o._cur = o._cur || {}; o._cur[s] = d.id;
      put(o);
    }
    render();
  }
  function fromMsg(id){
    try {
      var msgs = (window._S && window._S.msgs) || [];
      for (var i = 0; i < msgs.length; i++){
        if (msgs[i] && msgs[i].id === id){ open(msgs[i].content || '', titleOf(msgs[i].content)); return; }
      }
    } catch (e) {}
    open('', '未命名');
  }
  function openLast(){
    try {
      var msgs = (window._S && window._S.msgs) || [];
      for (var i = msgs.length - 1; i >= 0; i--){
        if (msgs[i] && msgs[i].role === 'assistant' && msgs[i].content){ open(msgs[i].content, titleOf(msgs[i].content)); return; }
      }
    } catch (e) {}
    open('', '未命名');
  }
  window.CANVAS = { open: open, fromMsg: fromMsg, openLast: openLast, close: close };
})();
