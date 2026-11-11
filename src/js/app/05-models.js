function addModelManual(id){
  if (!id){ toast('先填模型 ID', true); return; }
  if (/\s/.test(id)){ toast('模型 ID 里不能有空格', true); return; }
  var ap = AP();
  if (!ap.models) ap.models = [];
  var added = ap.models.indexOf(id) < 0;
  if (added) ap.models.push(id);
  if (!ap.currentModel) ap.currentModel = id;
  S.cfg.models = ap.models;
  mirrorPreset(); saveCfg(); renderPool(); renderComposerCtl();
  var ro = $('#ctx-ro'); if (ro) ro.value = ctxDisp();
  toast((added ? '已添加 ' : '已在池中 ') + id + '，正在获取能力信息…');
  fillMetaFromCatalog([id], true).then(function(){
    renderPool();
    var m = mMeta(id) || {};
    if (m.ctx || m.out || (m.in && m.in.length) || m.reason || m.nonChat) toast(id + '：' + mmSummary(id));
    else toast('已添加 ' + id + '，但没取到能力信息；可以点 ⚙ 手工填，或换个带版本号的完整 ID', true);
  }).catch(function(e){
    renderPool();
    toast('已添加 ' + id + '，能力获取失败：' + ((e && e.message) || e) + '（可点 ⚙ 手工填）', true);
  });
}
function mmToggleCfg(id){
    var box = $('#mdl-pool'); if (!box) return;
    var row = box.querySelector('.mdl-row[data-row="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!row) return;
    var cb = row.nextElementSibling;
    if (cb && cb.classList.contains('mdl-cfg')) cb.hidden = !cb.hidden;
  }
  function mmSave(id, key, val){
    var m = (S.cfg.modelMeta || {})[id] || {};
    if (key === 'in'){ m.in = val; }
    else if (key === 'reason'){ m.reason = val; }
    else { m[key] = Math.max(0, parseInt(val, 10) || 0); }
    m.src = 'manual';
    (S.cfg.modelMeta || (S.cfg.modelMeta = {}))[id] = m;
    saveCfg();
    var row = $('#mdl-pool') && $('#mdl-pool').querySelector('.mdl-row[data-row="' + id + '"]');
    if (row){ var cap = row.querySelector('.mdl-caps'); if (cap) cap.textContent = mmSummary(id); }
    renderCtxRing();
    var ro = $('#ctx-ro'); if (ro) ro.value = ctxDisp();
  }
  function mmDelete(id){
    var ap = AP();
    ap.models = (ap.models || []).filter(function(x){ return x !== id; });
    S.cfg.models = ap.models;
    if (ap.currentModel === id) ap.currentModel = ap.models[0] || '';
    mirrorPreset(); saveCfg(); renderPool(); renderComposerCtl();
    var ro = $('#ctx-ro'); if (ro) ro.value = ctxDisp();
  }
  function mmUse(id){
    var ap = AP();
    if (!ap.models) ap.models = [];
    if (ap.models.indexOf(id) < 0) ap.models.push(id);
    ap.currentModel = id;
    mirrorPreset(); saveCfg(); applyCtx(); renderPool(); renderComposerCtl();
    var ro = $('#ctx-ro'); if (ro) ro.value = ctxDisp();
  }
  /* 从目录补全能力：models.dev →（有缺口时）OpenRouter →（仍有缺口时）按模型名推断。
     useNet=true 才联网；默认只读 7 天缓存，切模型时零延迟静默补全。 */
  function fillMetaFromCatalog(ids, useNet){
    ids = ids || [];
    function apply(map){
      var n = 0;
      ids.forEach(function(id){
        var cur = (S.cfg.modelMeta || {})[id] || {};
        if (cur.src === 'manual') return;
        var hit = NET.catFind(map, id);
        if (!hit) return;
        var rec = {};
        if (!cur.ctx && hit.c) rec.ctx = hit.c;
        if (!cur.out && hit.o) rec.out = hit.o;
        if (!cur.in && hit.i) rec.in = hit.i;
        if (!cur.reason && hit.r) rec.reason = 'reasoning_effort';
        if (rec.ctx || rec.out || rec.in || rec.reason){ mSet(id, rec, 'catalog'); n++; }
      });
      return n;
    }
    function pending(){
      return ids.filter(function(id){
        var c = (S.cfg.modelMeta || {})[id] || {};
        return !c.ctx && !c.nonChat && c.src !== 'manual';
      });
    }
    function infer(){
      var n = 0;
      pending().forEach(function(id){
        var g = guessCaps(id);
        if (!g) return;
        mSet(id, g, 'guess');
        n++;
      });
      if (n) saveCfg();
      return n;
    }
    if (!useNet){
      var cached = NET.catalogCached();
      if (!cached) return Promise.resolve(0);
      apply(cached);
      var n0 = infer();
      return Promise.resolve(n0);
    }
    return NET.catalog().then(function(map){
      apply(map);
      if (!pending().length) return infer();
      return NET.catalogOpenRouter().then(function(map2){
        apply(map2);
        return infer();
      });
    });
  }
  /* 切模型后静默补全（只读缓存，不联网） */
  function metaLazy(){
    var id = S.cfg.currentModel;
    if (!id) return;
    var cur = mMeta(id);
    if (cur && (cur.ctx || cur.nonChat)) return;
    /* 能力表没有：先试目录缓存（含 OpenRouter 已合并部分），再按名字推断 */
    fillMetaFromCatalog([id], false).then(function(n){
      if (!n) return;
      var ro = $('#ctx-ro'); if (ro) ro.value = ctxDisp();
      if ($('#mdl-pool')) renderPool();
      renderCtxRing();
    });
  }
  function presetInput(key, type, ph){
    var v = AP()[key];
    return el('input', { class: 'f-in', type: type || 'text', 'data-preset': key, 'data-owner': AP().id, value: v == null ? '' : v, placeholder: ph || '' });
  }
  function presetField(t){
    var pk = t.getAttribute('data-preset'), p = AP();
    /* v0.5.8：输入框带着“它属于哪个配置组”的标记；切换后旧 DOM 的迟到事件一律丢弃 */
    var owner = t.getAttribute('data-owner');
    if (owner && owner !== p.id){ try { UI.openSettings(); } catch (e) {} return; }
    var v = t.type === 'checkbox' ? t.checked : t.value;
    if (pk === 'modelsText'){ p.models = v.split(/[,，]/).map(function(x){ return x.trim(); }).filter(Boolean); S.cfg.models = p.models; }
    else { p[pk] = v; if (pk === 'baseURL' || pk === 'apiKey' || pk === 'currentModel') mirrorPreset(); }
    if (pk === 'currentModel'){ // 切模型即按探测映射/模型名规则刷新上下文上限（全自动）
      applyCtx();
      var ro = $('#ctx-ro'); if (ro) ro.value = ctxDisp();
      metaLazy(); // v2.9：能力表里没有该模型时用目录缓存静默补全
    }
    saveCfg(); renderComposerCtl();
  }
  function savePkg(pack){
  if (!pack || !pack.files || !pack.files.length) return UI.toast('没有可导出的内容', true);
  if (!NET.pkgSave) return UI.toast('需要 exe 宿主版才能写入磁盘', true);
  NET.pkgSave(pack.name, pack.files, 'pick').then(function(r){
    if (r && r.canceled) return UI.toast('已取消导出');
    setCfg({ lastPkgDir: r.dir });
    UI.toast('已导出 ' + r.files + ' 个文件：' + r.dir);
  }, function(e){ UI.toast('导出失败：' + (e && e.message || e), true); });
}
function detailBox(d){
  var box = el('div', { class: 'det-box' });
  if (d && d.title) box.appendChild(el('div', { class: 'det-title', text: d.title }));
  (d.blocks || []).forEach(function(b){
    var h = el('div', { class: 'det-h' }, [ el('span', { class: 'det-k', text: b.k }) ]);
    if (b.v){
      var cp = el('button', { class: 'btn btn-ghost rn-mini', text: '复制' });
      cp.addEventListener('click', function(){ copyText(String(b.v)); });
      h.appendChild(cp);
    }
    box.appendChild(h);
    box.appendChild(el('pre', { class: 'det-pre', text: (b.v == null || b.v === '') ? '（空）' : String(b.v) }));
  });
  return box;
}
function clearDetails(keep){
  var bs = document.querySelectorAll('.det-box');
  for (var i = 0; i < bs.length; i++){
    if (bs[i] === keep) continue;
    var par = bs[i].parentElement;
    if (par) par.removeChild(bs[i]);
  }
}
function toggleDetail(host, build){
  if (!host) return;
  if (host.firstChild){ host.textContent = ''; return; }
  /* 同时只开一个详情，避免卡片里堆一片 */
  clearDetails(null);
  var others = document.querySelectorAll('.det-host');
  for (var i = 0; i < others.length; i++) if (others[i] !== host) others[i].textContent = '';
  var d;
  try { d = build(); } catch(e){ UI.toast('打不开：' + (e && e.message || e), true); return; }
  /* v0.4.4：build 可以返回 Promise（内置工具的源码要读一次自身文件） */
  if (d && typeof d.then === 'function'){
    host.appendChild(detailBox({ title: '读取中…', blocks: [{ k: '状态', v: '正在从 index.html 提取实现代码…' }] }));
    d.then(function(r){
      if ((host.textContent || '').indexOf('读取中') < 0) return;  // 期间已被收起，别把它又弹开
      host.textContent = '';
      if (r) host.appendChild(detailBox(r));
    }, function(e){
      if ((host.textContent || '').indexOf('读取中') < 0) return;
      host.textContent = '';
      host.appendChild(detailBox({ title: '读取失败', blocks: [{ k: '错误', v: (e && e.message) || String(e) }] }));
    });
    return;
  }
  host.appendChild(detailBox(d));
}
/* v1.29.2：右侧箭头 = 展开/收起这条的详情（替换原来的「查看」按钮） */
function chevBtn(host, build){
  var b = el('button', { class: 'exp-chev', type: 'button', title: '展开', 'aria-label': '展开', 'aria-expanded': 'false' });
  b.appendChild(icon('chev-r'));
  setTimeout(function(){
    try {
      var card = b.closest('.sub-card'); if (card) card.classList.add('has-chev');
      var box = b.closest('.sub-card') || b.closest('.f-row.ext-row');
      if (box && !box.__expBound){
        box.__expBound = true;
        box.addEventListener('click', function(ev){
          var t = ev.target; if (!t || !t.closest) return;
          if (t.closest('button,input,label,a,textarea,select,summary,.det-host')) return;
          b.click();
        });
      }
    } catch (e) {}
  }, 0);
  b.addEventListener('click', function(ev){
    ev.preventDefault(); ev.stopPropagation();
    toggleDetail(host, build);
    var open = !!host.firstChild;
    /* 同时只开一条：其余的箭头复位 */
    var all = document.querySelectorAll('.exp-chev.open');
    for (var i = 0; i < all.length; i++) if (all[i] !== b){ all[i].classList.remove('open'); all[i].setAttribute('aria-expanded', 'false'); all[i].title = '展开'; }
    b.classList.toggle('open', open);
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.title = open ? '收起' : '展开';
  });
  return b;
}
function buildSettings(){
    var c = S.cfg;
    var main = el('div', { class: 'set-main' });
    var wrap = el('div', {}, [main]);
    var cols = el('div', { class: 'set-cols' });
    var nav = el('div', { class: 'set-nav' });
    var body = el('div', { class: 'set-body' });
    cols.appendChild(nav); cols.appendChild(body);
    main.appendChild(cols);
    nav.appendChild(el('div', { class: 'set-title', text: '设置' }));
    /* v3.0 #1：设置搜索（按文字过滤当前页的字段行；有输入时跨页命中） */
    (function(){
      var q = el('input', { class: 'f-in', placeholder: '搜索设置项…', style: 'margin:6px 0 8px;font-size:12px' });
      nav.appendChild(q);
      q.addEventListener('input', function(){
        var kw = q.value.trim().toLowerCase();
        var pages = document.querySelectorAll('#modal .set-page');
        for (var i = 0; i < pages.length; i++){
          var rows = pages[i].querySelectorAll('.f-row, .f-grid, .f-actions, .sub');
          for (var j = 0; j < rows.length; j++){
            var row = rows[j];
            var hit = !kw || (row.textContent || '').toLowerCase().indexOf(kw) >= 0;
            row.classList.toggle('set-hide', !hit);
          }
          if (kw) pages[i].classList.add('on');
        }
        if (!kw){
          var act = nav.querySelector('button.on');
          var cur = act ? act.getAttribute('data-sp') : 'conn';
          for (var k = 0; k < pages.length; k++)
            pages[k].classList.toggle('on', pages[k].getAttribute('data-page') === cur);
        }
      });
    })();

    /* v1.16：页内顶栏助手（扩展页、提示词页各用一套；不再是设置的总上边栏） */
  function pageTabs(defs, pick){
    var bar = el('div', { class: 'pt-tabs' });
    var btns = {};
    defs.forEach(function(d){
      var b = el('button', { type: 'button', text: d[1] });
      b.addEventListener('click', function(){
        for (var k in btns) btns[k].classList.toggle('on', k === d[0]);
        pick(d[0], b);
      });
      btns[d[0]] = b; bar.appendChild(b);
    });
    if (defs.length) btns[defs[0][0]].classList.add('on');
    bar._pick = function(k){ if (btns[k]) btns[k].click(); };
    return bar;
  }
  function page(id, label, buildFn){
      var p = el('div', { class: id === 'conn' ? 'set-page on' : 'set-page', 'data-page': id });
      p.appendChild(el('h2', { text: label }));
      buildFn(p);
      body.appendChild(p);
      nav.appendChild(el('button', { class: id === 'conn' ? 'on' : '', 'data-m': 'sp', 'data-sp': id, text: label }));
    }

    /* —— 页① 连接与模型 —— */
    function acc(title, buildFn, open){
      var box = el('div', { class: 'acc' + (open ? ' open' : '') });
      var head = el('div', { class: 'acc-head', 'data-acc': '1' }, [el('span', { text: title }), icon('down')]);
      var body = el('div', { class: 'acc-body' });
      buildFn(body);
      box.appendChild(head); box.appendChild(body);
      return box;
    }
    page('conn', '连接与模型', function(p){
      p.appendChild(acc('LLM 配置', function(b){
        var psel = el('select', { class: 'f-in', id: 'psel' });
        (c.presets || []).forEach(function(pg){
          psel.appendChild(el('option', { value: pg.id, text: pg.name || '配置', selected: pg.id === c.activePreset ? '' : null }));
        });
        b.appendChild(field('配置组', el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [psel,
          el('button', { class: 'btn btn-sec', 'data-m': 'preset-new', text: '新建' }),
          el('button', { class: 'btn btn-sec', 'data-m': 'preset-rename', text: '重命名' }),
          el('button', { class: 'btn btn-danger', 'data-m': 'preset-del', text: '删除' })
        ]), '每组一套提供商配置；顶栏下拉按组切换。'));

        /* v0.4.5：供应商预设 —— 选完自动填协议/地址/鉴权/字段怪癖 */
        var apNow = AP();
        /* v0.6.2：搜索框放进下拉内部最上方（自定义 combobox，原生 select 塞不进输入框） */
        var SORT_AS = {
          doubao: 'Volcengine Ark', qwen: 'Qwen', glm: 'Zhipu', kimi: 'Moonshot', hunyuan: 'Hunyuan',
          siliconflow: 'SiliconFlow', ollama: 'Ollama', lmstudio: 'LM Studio', azure: 'Azure OpenAI',
          anthropic: 'Anthropic Claude', gemini: 'Gemini', 'openai-resp': 'OpenAI Responses',
          openai: 'OpenAI', deepseek: 'DeepSeek', openrouter: 'OpenRouter', groq: 'Groq',
          together: 'Together AI', custom: 'Custom'
        };
        function sortKeyOf(pv){
          var k = String(SORT_AS[pv.id] || pv.name || '').trim();
          if (/^[A-Za-z0-9]/.test(k)) return k;
          if (/^[A-Za-z0-9]/.test(String(pv.id || ''))) return String(pv.id);
          return '#';
        }
        /* 通用「带搜索的下拉」：点开 → 顶部搜索框 + A-Z 分组列表 */
        function mkSearchSelect(items, value, onPick, emptyText, ph){
          var cur = value || '';
          var wrap = el('div', { class: 'ss-wrap' });
          var lab = el('span', { class: 'ss-lab' });
          var btn = el('button', { class: 'f-in ss-btn', type: 'button' }, [lab, icon('down')]);
          wrap.appendChild(btn);
          var panel = el('div', { class: 'ss-panel' });
          var q = el('input', { class: 'f-in ss-q', placeholder: ph || '搜索…' });
          var list = el('div', { class: 'ss-list' });
          panel.appendChild(q); panel.appendChild(list);
          var opened = false;
          function labelOf(id){
            for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i].name;
            return '';
          }
          function syncLab(){ lab.textContent = labelOf(cur) || emptyText; }
          function render(){
            var kw = String(q.value || '').trim().toLowerCase();
            list.textContent = '';
            var groups = {};
            items.forEach(function(it){
              if (kw && (String(it.name) + ' ' + it.id + ' ' + (it.alias || '')).toLowerCase().indexOf(kw) < 0) return;
              var k0 = String(it.key || it.name || '');
              var ch = k0.charAt(0).toUpperCase();
              var k = /[A-Z]/.test(ch) ? ch : '#';
              (groups[k] = groups[k] || []).push(it);
            });
            var keys = Object.keys(groups).sort(function(a, b){
              if (a === '#') return -1;
              if (b === '#') return 1;
              return a < b ? -1 : 1;
            });
            keys.forEach(function(k){
              list.appendChild(el('div', { class: 'ss-grp', text: k }));
              groups[k].sort(function(a, b){ return String(a.key || a.name).localeCompare(String(b.key || b.name)); });
              groups[k].forEach(function(it){
                var o = el('div', { class: 'ss-opt' + (it.id === cur ? ' on' : ''), text: it.name });
                o.addEventListener('mousedown', function(e){
                  e.preventDefault();
                  cur = it.id; syncLab(); close(); onPick(it.id);
                });
                list.appendChild(o);
              });
            });
            if (!keys.length) list.appendChild(el('div', { class: 'ss-empty', text: '没有匹配的供应商' }));
          }
          function onDoc(e){ if (!panel.contains(e.target) && !btn.contains(e.target)) close(); }
          function close(){
            opened = false;
            panel.classList.remove('on');
            if (panel.parentNode) panel.parentNode.removeChild(panel);
            document.removeEventListener('mousedown', onDoc, true);
          }
          function show(){
            if (opened) return close();
            opened = true;
            var r = btn.getBoundingClientRect();
            panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - Math.max(260, r.width) - 8)) + 'px';
            panel.style.top = Math.min(r.bottom + 4, window.innerHeight - 320) + 'px';
            panel.style.width = Math.max(260, r.width) + 'px';
            document.body.appendChild(panel);
            panel.classList.add('on');
            q.value = ''; render();
            setTimeout(function(){ try { q.focus(); } catch (e) {} }, 0);
            document.addEventListener('mousedown', onDoc, true);
          }
          btn.addEventListener('click', show);
          q.addEventListener('input', render);
          q.addEventListener('keydown', function(e){
            if (e.key === 'Escape'){ close(); }
            if (e.key === 'Enter'){
              var first = list.querySelector('.ss-opt');
              if (first){ first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }
            }
          });
          syncLab();
          return { node: wrap, setValue: function(v){ cur = v; syncLab(); }, close: close };
        }
        var pvItems = NET.PROVIDERS.map(function(pv){
          return { id: pv.id, name: pv.name, key: sortKeyOf(pv),
                   alias: (SORT_AS[pv.id] || '') + ' ' + (pv.alias || '') };
        });
        var pvPick = mkSearchSelect(pvItems, apNow.provId || '',
          function(id){ if (id) applyProv(id); }, '（未选择，点这里选一家）', '搜索供应商：名字 / ID / 英文名');
        b.appendChild(field('供应商预设', pvPick.node,
          '共 ' + NET.PROVIDERS.length + ' 家（含 Atlas 目录）。点开后在顶部搜索框里输入：火山方舟搜 volcengine，千问搜 qwen，智谱搜 zhipu；列表按 A-Z 分组。'));

        b.appendChild(field('Base URL', presetInput('baseURL', 'text', 'https://api.example.com 或 mock'),
          '含 /v1、/v3 则原样，否则自动补 /v1；填 mock 离线演示；火山方舟填 https://ark.cn-beijing.volces.com/api/v3'));
        b.appendChild(field('API Key', (function(){
          var i = presetInput('apiKey', 'password', 'sk-...');
          i.autocomplete = 'off';
          return i;
        })(), '仅存本机；自研宿主可由桥注入。'));

        b.appendChild(acc('高级：协议与字段覆盖', function(ab){
          var prSel = el('select', { class: 'f-in' });
          [['openai-chat', 'openai-chat（Chat Completions）'], ['openai-responses', 'openai-responses（Responses）'],
           ['anthropic-messages', 'anthropic-messages（Claude 原生）'], ['gemini', 'gemini（generateContent）']].forEach(function(o){
            prSel.appendChild(el('option', { value: o[0], text: o[1], selected: (AP().protocol || 'openai-chat') === o[0] ? '' : null }));
          });
          prSel.addEventListener('change', function(){
            var p = AP(); p.protocol = prSel.value; mirrorPreset(); saveCfg();
            try { UI.toast('协议已切换：' + prSel.value); } catch (e) {}
          });
          ab.appendChild(field('协议', prSel, '协议决定 wire format（URL / 鉴权 / body 形状 / 流事件）；供应商只提供地址与字段差异，两者正交。'));
          function qInput(key, label, ph, hint){
            var q0 = AP().quirks || {};
            var i = el('input', { class: 'f-in', value: q0[key] == null ? '' : String(q0[key]), placeholder: ph || '' });
            i.addEventListener('change', function(){
              var p = AP(); p.quirks = p.quirks || {};
              var v = String(i.value || '').trim();
              if (v) p.quirks[key] = v; else delete p.quirks[key];
              mirrorPreset(); saveCfg();
            });
            return field(label, i, hint);
          }
          ab.appendChild(qInput('maxTokensField', '上限字段名', 'max_tokens', '有些模型只认 max_completion_tokens（OpenAI o 系列），留空用默认 max_tokens。'));
          ab.appendChild(qInput('thinkingParam', '思考开关字段', 'enable_thinking', 'enable_thinking / thinking / reasoning_effort，留空按模型名推断。'));
          ab.appendChild(qInput('reasoningField', '思考内容字段', 'reasoning_content', '响应里思考内容的字段名（reasoning_content / reasoning / thinking），留空按模型名推断。'));
          ab.appendChild(qInput('streamUsage', '流式用量', 'include_usage', 'include_usage（默认，带 stream_options）/ always（服务端恒给）/ none（不支持该参数）。'));
          ab.appendChild(qInput('chatPath', '对话路径', '/chat/completions', '接口路径覆盖，Azure 这类部署路径不同时填。'));
          ab.appendChild(qInput('modelsPath', '模型列表路径', '/models', '留空用 /models。'));
          ab.appendChild(qInput('queryVersion', 'api-version', '', 'Azure 的 api-version 查询参数，留空不加。'));
          var atSel = el('select', { class: 'f-in' });
          [['bearer', 'Authorization: Bearer（默认）'], ['x-api-key', 'x-api-key（Anthropic 系）'],
           ['api-key', 'api-key（Azure）'], ['none', '不带鉴权（本地服务）']].forEach(function(o){
            atSel.appendChild(el('option', { value: o[0], text: o[1], selected: (AP().authType || 'bearer') === o[0] ? '' : null }));
          });
          atSel.addEventListener('change', function(){ var p = AP(); p.authType = atSel.value; mirrorPreset(); saveCfg(); });
          ab.appendChild(field('鉴权方式', atSel, '目录预设会自动选好，一般不用改。'));
          var tst = el('button', { class: 'btn btn-sec', type: 'button', text: '测试连接' });
          tst.addEventListener('click', function(){ testConnBtn(tst); });
          ab.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [tst]));
          ab.appendChild(el('div', { class: 'hint',
            text: '测试三步：① 拉模型列表（验地址/鉴权）② 最小对话（验路径/参数）③ 流式（验 SSE）。任一步失败即停，结果在下方 toast 里逐条列出。' }));
        }, false));

        var ap = AP();
        var sel = el('select', { 'data-preset': 'currentModel', class: 'f-in' });
        var models = ap.models && ap.models.length ? ap.models : (ap.currentModel ? [ap.currentModel] : []);
        if (!models.length) sel.appendChild(el('option', { value: '', text: '（未获取）' }));
        for (var i = 0; i < models.length; i++)
          sel.appendChild(el('option', { value: models[i], text: modelLabel(models[i]), selected: models[i] === ap.currentModel ? '' : null }));
        var pick = el('div', { id: 'mdl-pick', hidden: true }); // v1.6：「获取列表」后的多选清单挂载点
        /* v2.9：模型池改成可视化列表——每行一个已选模型，右侧 ⚙ 能力设置 / 🗑 删除 */
        var pool = el('div', { id: 'mdl-pool', class: 'mdl-pool' });
        /* v0.4.1：模型名美化开关（只改显示，不改请求里的 id） */
        var prettyCk = el('input', { type: 'checkbox', 'data-cfg': 'prettyModel' });
        prettyCk.checked = S.cfg.prettyModel !== false;
        prettyCk.addEventListener('change', function(){ setCfg({ prettyModel: prettyCk.checked }); renderPool(); renderComposerCtl(); });
        b.appendChild(field('模型名显示', el('label', { class: 'chk-line', style: 'display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--body)' }, [
          prettyCk, el('span', { text: '驼峰化显示（deepseek-v4.1-flash → DeepSeek V4.1 Flash），连字符/下划线自动变空格' })
        ]), '只影响界面里显示的模型名，发给接口的仍然是原始 id。'));
        b.appendChild(field('模型', el('div', {}, [
          el('div', { style: 'display:flex;gap:8px;margin-bottom:8px' }, [
            sel, el('button', { class: 'btn btn-sec', 'data-m': 'fetch-models', text: '获取列表' })
          ]),
          pool, pick
        ]), '「获取列表」拉取接口模型并自动补全能力（上下文窗口 / 最大输出 / 输入类型 / 思考字段；来源为 models.dev 开源目录 + 接口 /models 字段，取不到的按模型名规则推断）。每行右侧 ⚙ 可手工校正、🗑 从池中删除；点模型名设为当前模型。'));
        renderPool(pool); // 弹层尚未挂载到文档，直接传节点渲染
        /* 打开设置即用本地目录缓存补全池内所有模型（不联网），避免列表里一堆「能力未获取」 */
        fillMetaFromCatalog(AP().models || [], false).then(function(n){
          if (!n) return;
          renderPool(pool);
          var ro0 = $('#ctx-ro'); if (ro0) ro0.value = ctxDisp();
          renderCtxRing();
        });
        b.appendChild(field('上下文上限（自动探测）', el('input', { id: 'ctx-ro', class: 'f-in', type: 'text', readonly: '', value: ctxDisp() }),
          '只读展示，不再手动设置：来自模型能力表（models.dev 目录 / 接口 /models 窗口字段 / 模型名规则三级回退）。用作上下文估算的分母与 80% 自动压缩阈值。'));

        var streamCk = el('input', { type: 'checkbox', 'data-cfg': 'stream' });
        streamCk.checked = !!c.stream;
        var bridgeCk = el('input', { type: 'checkbox', 'data-cfg': 'useBridge' });
        bridgeCk.checked = !!c.useBridge;
        b.appendChild(el('div', { class: 'f-row' }, [
          el('label', {}, [streamCk, ' 流式输出']),
          el('label', { style: 'margin-left:18px' }, [bridgeCk, ' 优先走宿主桥（' + (NET.bridge.ok ? '已检测到' : '未检测到宿主') + '）'])
        ]));

        b.appendChild(el('div', { class: 'f-grid' }, [
          field('连接超时（秒）', cfgInput('timeout.connect', 'number')),
          field('首 token 超时（秒）', cfgInput('timeout.first', 'number')),
          field('流式空闲超时（秒）', cfgInput('timeout.idle', 'number'))
        ]));
        b.appendChild(field('默认 System Prompt',
          el('textarea', { 'data-cfg': 'systemPrompt', text: c.systemPrompt || '' })));
        /* v0.8.5：原生 function calling 开关 */
        (function(){
          var ck = el('input', { type: 'checkbox', 'data-cfg': 'nativeTools' });
          ck.checked = !!c.nativeTools;
          b.appendChild(el('div', { class: 'f-row' }, [el('label', {}, [ck, ' 原生工具调用（function calling）'])]));
          b.appendChild(el('div', { class: 'hint', text: '开启后，Work / Agent 模式会把扩展里的工具、技能、智能体作为 tools 数组发给模型，模型可直接返回 tool_calls（四种协议都支持），不再依赖在正文里手写围栏。默认关；关掉时行为与以前完全一致。' }));
        })();
      }, false));

      /* —— 文档解析（v1.4；v1.5 增加 OCR 引擎；v1.5.1 由独立页并入本页） —— */
      p.appendChild(acc('文档解析', function(b){
        var oc = c.ocr || (c.ocr = Object.assign({}, DEF_CFG.ocr));
        var dpCk = el('input', { type: 'checkbox', 'data-cfg': 'docParse' });
        dpCk.checked = !!c.docParse;
        b.appendChild(el('div', { class: 'f-row' }, [el('label', {}, [dpCk, ' 启用文档解析（docx / xlsx / pptx / pdf / rtf）'])]));
        var awCk = el('input', { type: 'checkbox', 'data-cfg': 'fsAutoWrite' });
        awCk.checked = !!c.fsAutoWrite;
        b.appendChild(el('div', { class: 'f-row' }, [el('label', {}, [awCk, ' 工作区内写入免确认（自动应用），工作区外逐次确认并显示完整路径与操作内容'])]));
        var dmb = el('input', { class: 'f-in', type: 'number', step: '1', 'data-cfg': 'maxDocMB', value: c.maxDocMB });
        var imb = el('input', { class: 'f-in', type: 'number', step: '1', 'data-cfg': 'maxImgMB', value: c.maxImgMB });
        b.appendChild(el('div', { class: 'f-grid' }, [field('文本/文档上限(MB)', dmb), field('图片上限(MB)', imb)]));

        /* —— OCR 引擎（v1.5）：扫描版 PDF 交给专用文档识别模型 —— */
        var esel = el('select', { class: 'f-in', 'data-cfg': 'ocr.engine' });
        [['none', '不启用（仅本地解析）'],
           ['vision', '视觉模型识别（需模型支持视觉；PDF 需 Anthropic / Responses 协议）'],
           ['google', 'Google Document AI'],
           ['azure', 'Azure AI Document Intelligence'],
           ['aws', 'Amazon Textract'],
           ['adobe', 'Adobe PDF Services'],
           ['abbyy', 'ABBYY Vantage'],
           ['baidu', '百度智能云 OCR'],
           ['aliyun', '阿里云 OCR'],
           ['tencent', '腾讯云 OCR'],
           ['mistral', 'Mistral OCR']]
          .forEach(function(e){
            esel.appendChild(el('option', { value: e[0], text: e[1], selected: oc.engine === e[0] ? '' : null }));
          });

        var mistBox = el('div', {}, [
          field('接口地址', cfgInput('ocr.mistralBase', 'text', 'https://api.mistral.ai'),
            '官方直连填 https://api.mistral.ai；任何 Mistral OCR 兼容网关（聚合站、自建转发）填对应地址即可，自动请求 {地址}/v1/ocr。'),
          field('API Key', cfgInput('ocr.mistralKey', 'password', '在 console.mistral.ai 申请')),
          field('模型', cfgInput('ocr.mistralModel', 'text', 'mistral-ocr-latest'),
            '默认 mistral-ocr-latest；网关如限模型名可改成实际可用的 OCR 模型 ID。'),
        ]);
        var azBox = el('div', {}, [
          field('资源端点', cfgInput('ocr.azureEndpoint', 'text', 'https://你的资源名.cognitiveservices.azure.com'),
            'Azure 门户 → 文档智能（Document Intelligence）资源 → 端点与密钥。'),
          field('API Key', cfgInput('ocr.azureKey', 'password')),
          (function(){
            var s = el('select', { class: 'f-in', 'data-cfg': 'ocr.azureModel' });
            [['prebuilt-read', 'prebuilt-read（高精度 OCR）'], ['prebuilt-layout', 'prebuilt-layout（版面 + 表格结构）'], ['prebuilt-document', 'prebuilt-document（版面 + 键值对）']]
              .forEach(function(m){
                s.appendChild(el('option', { value: m[0], text: m[1], selected: oc.azureModel === m[0] ? '' : null }));
              });
            return field('文档模型', s, '纯文字识别选 prebuilt-read；含表格的文档选 prebuilt-layout（表格会按 Markdown 表格还原）。');
          })(),
          field('API 版本', cfgInput('ocr.azureApiVer', 'text', '2024-11-30'), '一般保持默认即可。'),
        ]);
        /* v0.5.0：视觉模型识别（用聊天模型直接读图/读 PDF） */
        var visBox = el('div', {}, [
          (function(){
            var sel = el('select', { class: 'f-in', 'data-cfg': 'ocr.visionModel' });
            sel.appendChild(el('option', { value: '', text: '跟随当前模型', selected: !oc.visionModel ? '' : null }));
            var ms = (AP().models || []).slice();
            if (oc.visionModel && ms.indexOf(oc.visionModel) < 0) ms.push(oc.visionModel);
            ms.forEach(function(m){
              sel.appendChild(el('option', { value: m, text: modelLabel(m), selected: oc.visionModel === m ? '' : null }));
            });
            return field('识别模型', sel, '从模型池里选一个支持视觉的模型；PDF 还需要协议是 Anthropic / Responses。');
          })(),
        ]);
        /* 百度智能云 OCR：API Key + Secret Key 换 token */
        var bdBox = el('div', {}, [
          field('API Key', cfgInput('ocr.baiduKey', 'password', '百度智能云控制台 → 应用 → API Key')),
          field('Secret Key', cfgInput('ocr.baiduSecret', 'password')),
        ]);
        /* 其它云 OCR：官方要签名/OAuth，统一走自建网关 */
        var gwBox = el('div', {}, [
          field('网关地址', cfgInput('ocr.gwEndpoint', 'text', 'https://你的网关/ocr'),
            'Google Document AI / Amazon Textract / Adobe PDF Services / ABBYY / 阿里云 / 腾讯云的官方接口都需要签名或 OAuth，本版统一走你自己的网关：POST JSON {service, mime, data(base64)}，返回 {text} 或纯文本。'),
          field('网关 Key', cfgInput('ocr.gwKey', 'password'), '可选，作为 Authorization: Bearer 发送。'),
        ]);
        function syncEng(){
          var e = esel.value || 'none';
          visBox.style.display = e === 'vision' ? '' : 'none';
          mistBox.style.display = e === 'mistral' ? '' : 'none';
          azBox.style.display = e === 'azure' ? '' : 'none';
          bdBox.style.display = e === 'baidu' ? '' : 'none';
          gwBox.style.display = (e === 'google' || e === 'aws' || e === 'adobe' || e === 'abbyy' || e === 'aliyun' || e === 'tencent') ? '' : 'none';
        }
        esel.addEventListener('change', syncEng);
        b.appendChild(field('OCR 引擎', esel,
          '只有「扫描版 / 图片型 PDF」才会用到这里的引擎；普通文档、有文本层的 PDF 一律本地解析，不需要选。'));
        b.appendChild(visBox); b.appendChild(mistBox); b.appendChild(azBox); b.appendChild(bdBox); b.appendChild(gwBox);
        syncEng();

        var oaCk = el('input', { type: 'checkbox', 'data-cfg': 'ocr.always' });
        oaCk.checked = !!oc.always;
        b.appendChild(el('div', { class: 'f-row' }, [el('label', {}, [oaCk, ' 所有 PDF 一律走 OCR（默认关：仅无文本层的扫描版自动走 OCR）'])]));
        b.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
          el('button', { class: 'btn btn-sec', 'data-m': 'ocr-test', text: '测试识别' })
        ]));
        b.appendChild(el('div', { class: 'hint', text: '测试识别：用内置样例图跑一遍当前引擎，能识别出文本即 Key/端点可用。OCR 请求自动走「通用设置」页的代理。' }));

        var dtm = el('input', { type: 'checkbox', 'data-cfg': 'docToModel' });
        dtm.checked = S.cfg.docToModel !== false;
        b.appendChild(el('div', { class: 'f-row' }, [el('label', {}, [dtm, ' 扫描版 PDF 交给模型直接读取（Anthropic / Responses 协议）'])]));
        b.appendChild(el('div', { class: 'hint', text: 'PDF 提取不到文本层时，不再直接失败：若协议是 anthropic-messages 或 openai-responses，会把原 PDF 作为 document 附件发给模型（消耗更多 token）；openai-chat / gemini 会提示改用其它协议或先转图片。' }));
        b.appendChild(el('div', { class: 'hint', text: '支持格式：docx / xlsx / pptx / pdf / rtf 及各类纯文本（代码、日志、csv 等）。单文件注入截断 256KB；PDF 优先本地提取文本层（尽力而为），扫描版在已配置 OCR 引擎时自动改走 OCR（上传上限 30MB）；xlsx 按「共享字符串+工作表单元格」提取。' }));
        b.appendChild(el('div', { class: 'hint', text: '隐私：本地解析不联网；仅当扫描版 PDF 触发 OCR 时，该文件会发送给你所选的 OCR 服务商识别。解析失败时原文件不会加入附件，可在提示中看到失败原因。关闭解析不影响文本类附件。' }));
      }, false));

      p.appendChild(acc('在线搜索', function(b){
        var psel = el('select', { 'data-cfg': 'searchProvider', class: 'f-in' });
        [['none', '不启用'],
           ['perplexity', 'Perplexity Search'],
           ['baidu', '百度 千帆搜索'],
           ['brave', 'Brave Search'],
           ['you', 'You.com'],
           ['tavily', 'Tavily'],
           ['exa', 'Exa'],
           ['serpapi', 'SerpApi'],
           ['serper', 'Serper'],
           ['firecrawl', 'Firecrawl'],
           ['google', 'Google Grounding'],
           ['bing', 'Bing Grounding'],
           ['bocha', '博查 Bocha'],
           ['jina', 'Jina Search'],
           ['searxng', 'SearXNG'],
           ['custom', '自定义']].forEach(function(pp){
          psel.appendChild(el('option', { value: pp[0], text: pp[1], selected: (c.searchProvider || 'none') === pp[0] ? '' : null }));
        });
        b.appendChild(field('搜索提供商', psel, '发送前把搜索结果注入当次上下文；配合输入区左侧的地球图标使用。'));
        b.appendChild(field('搜索 API Key', (function(){
          var i = cfgInput('searchKey', 'password', '对应提供商的控制台 Key');
          i.autocomplete = 'off';
          return i;
        })(), '仅存本机。各官网申请：google.serper.dev / serpapi.com / brave.com/search/api / tavily.com / firecrawl.dev / bochaai.com / jina.ai / exa.ai'));
        b.appendChild(field('结果条数', cfgInput('searchCount', 'number'), '1~10，默认 5。结果按条截断，总量受上下文裁剪保护。'));
        b.appendChild(field('Google Grounding 模型', cfgInput('searchModel', 'text', 'gemini-2.0-flash'),
          '仅 Google 这一项用：走 Gemini 的 google_search 工具，直接返回带引用的回答（不是 SERP 列表）。Key 用同一栏的搜索 API Key。'));
        b.appendChild(el('div', { class: 'hint', text: '说明：Google / Bing 的「Grounding」不是通用 SERP API —— Google 已按上面这种方式接入；Bing 只存在于 Azure AI Agents（需要项目端点 + agent id），本版未接入，需要 Bing 结果请用 SerpApi 选 Bing 引擎。' }));
        b.appendChild(field('SearXNG 地址', cfgInput('searchBase', 'text', 'http://127.0.0.1:8080'),
          '自建 SearXNG 根地址，无需 Key；需在其 settings.yml 的 search.formats 里开启 json。'));
        b.appendChild(field('自定义搜索 URL', cfgInput('searchCustom.url', 'text', 'https://api.example.com/search?q={q}&n={n}'),
          '支持 {q}=查询词、{n}=条数占位；返回 JSON。'));
        b.appendChild(field('结果数组路径', cfgInput('searchCustom.path', 'text', 'data.items'),
          '从响应里取结果数组的路径，如 data.items / results / web.pages。'));
        b.appendChild(el('div', { class: 'f-row', style: 'gap:8px' }, [
          el('label', { style: 'flex:1;margin:0' }, [el('span', { text: '字段：标题', style: 'font-size:12px;color:var(--muted)' }), cfgInput('searchCustom.fTitle', 'text', 'title')]),
          el('label', { style: 'flex:1;margin:0' }, [el('span', { text: '链接', style: 'font-size:12px;color:var(--muted)' }), cfgInput('searchCustom.fUrl', 'text', 'url')]),
          el('label', { style: 'flex:1;margin:0' }, [el('span', { text: '摘要/正文', style: 'font-size:12px;color:var(--muted)' }), cfgInput('searchCustom.fText', 'text', 'snippet')])
        ]));
        b.appendChild(el('div', { class: 'hint', text: '结果按 URL 归一化去重（去 utm/尾斜杠/协议差异），同查询 10 分钟内走本地缓存，不重复计费。' }));
        var rwCk = el('input', { type: 'checkbox', 'data-cfg': 'searchRewrite' });
        rwCk.checked = c.searchRewrite !== false;
        var ftCk = el('input', { type: 'checkbox', 'data-cfg': 'searchFetch' });
        ftCk.checked = c.searchFetch !== false;
        b.appendChild(el('div', { class: 'f-row' }, [
          el('label', {}, [rwCk, ' 智能搜索决策']),
          el('label', { style: 'margin-left:18px' }, [ftCk, ' 抓取网页正文'])
        ]));
        b.appendChild(field('正文抓取条数', cfgInput('searchFetchCount', 'number'),
          '智能搜索决策：联网开关打开后，先用模型自判「是否需要联网」——需要则给出简化检索词再搜索，不需要则直接作答（约 1~2 秒，失败回退原问题照常搜索）；' +
          '回答正文会自动在引用处标注 [标题](网址) 可点击链接。抓取正文：对前几条结果抓网页全文替代摘要（0~5 条，浏览器直连受 CORS 限制时自动回退摘要）。'));
      }, false));

      p.appendChild(acc('文件 Agent', function(b){
        b.appendChild(el('div', { class: 'f-row' }, [el('label', { text: '已授权工作区目录（白名单存于宿主侧 host.json）' }),
          el('div', { id: 'fs-roots', style: 'font-size:12px;color:var(--muted)' }, [el('div', { text: '加载中…' })])]));
        b.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
          el('button', { class: 'btn btn-sec', 'data-m': 'fs-addroot' }, [icon('plus'), '添加目录'])
        ]));
        b.appendChild(field('思考程度档位', cfgInput('thinkList', 'text', 'Default,enabled,disabled'),
          '逗号分隔，输入区「思考」下拉按模型选。Default 不传；enabled/disabled→thinking.type，其余→reasoning_effort。'));
        b.appendChild(el('div', { class: 'hint', text: 'AI 仅在授权目录内相对路径读写，写入逐次确认；每会话绑定一个文件夹，开始后锁定。' }));
        setTimeout(refreshFsRoots, 0); // v0.3.2：此处 #fs-roots 还没进 DOM
      }, false));

      p.appendChild(acc('生图', function(b){
        b.appendChild(field('生图模型', cfgInput('imgModel', 'text', 'gpt-image-1'),
          '用于 /v1/images/generations 的模型名，默认 gpt-image-1。'));
        var sz = el('select', { class: 'f-in', 'data-cfg': 'imgSize' });
        ['1024x1024','1024x1536','1536x1024'].forEach(function(v){
          sz.appendChild(el('option', { value: v, text: v, selected: (S.cfg.imgSize || '1024x1024') === v ? '' : null }));
        });
        b.appendChild(field('尺寸', sz));
        var ip = el('select', { class: 'f-in', 'data-cfg': 'imgPartial' });
        [0,1,2,3].forEach(function(v){
          ip.appendChild(el('option', { value: String(v), text: String(v), selected: String(S.cfg.imgPartial != null ? S.cfg.imgPartial : 2) === String(v) ? '' : null }));
        });
        b.appendChild(field('partial_images', ip, '流式生成时的中间帧数量（0–3）；上游不支持时会自动降级为非流式。'));
      }, false));
    });

    /* —— 页② 通用设置（v1.5.1：主题 / 代理 / 全局参数 / 数据 四合一） —— */
    page('general', '通用设置', function(p){
  p.appendChild(el('div', { class: 'sub', text: '执行' }));
  /* v1.29.2：从「扩展」页挪到通用设置（之前放错了页） */
  var pgRow = el('div', { class: 'f-row' });
  (function(){
  var pmSel = el('select', { class: 'f-in' });
  [['ask', '每次确认（本会话第一次写入要手动确认）'], ['auto', '自动应用（工作区内直接写）'], ['readonly', '只读（不写文件、不执行命令）']].forEach(function(o){
    pmSel.appendChild(el('option', { value: o[0], text: o[1], selected: ((S.cfg.permMode || (S.cfg.planGate === false ? 'auto' : 'ask')) === o[0]) ? '' : null }));
  });
  pmSel.addEventListener('change', function(){ setCfg({ permMode: pmSel.value, planGate: pmSel.value !== 'auto' }); });
  pgRow.appendChild(el('label', {}, ['权限模式：', pmSel]));
  })();
  p.appendChild(pgRow);
      /* 外观与行为（原「主题」页） */
      p.appendChild(el('div', { class: 'sub', text: '外观与行为' }));
      var seg = el('div', { class: 'seg' });
      [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].forEach(function(pp){
        seg.appendChild(el('button', {
          class: c.theme === pp[0] ? 'on' : '', 'data-m': 'theme', 'data-v': pp[0], text: pp[1]
        }));
      });
      p.appendChild(field('外观', seg, '浅色 = Claude 规范（奶油纸面 · 珊瑚主色）；深色 = Linear 规范（近黑 · 薰衣草蓝）。'));
/* v3.0 #7：强调色 + 字号档（只改 token，不新增尺寸） */
var acSel = el('select', { class: 'f-in', 'data-cfg': 'accent' });
[['coral', '珊瑚（默认，Claude）'], ['lavender', '薰衣草（Linear）'], ['teal', '青'], ['amber', '琥珀']].forEach(function(o){
  acSel.appendChild(el('option', { value: o[0], text: o[1], selected: (c.accent || 'coral') === o[0] ? '' : null }));
});
var fsSel = el('select', { class: 'f-in', 'data-cfg': 'fontScale' });
[['0.92', '小 92%'], ['1', '标准 100%'], ['1.12', '大 112%'], ['1.25', '特大 125%']].forEach(function(o){
  fsSel.appendChild(el('option', { value: o[0], text: o[1], selected: String(c.fontScale || 1) === o[0] ? '' : null }));
});
p.appendChild(el('div', { class: 'f-grid' }, [field('强调色', acSel), field('字号', fsSel)]));
var wrapCk = el('input', { type: 'checkbox', 'data-cfg': 'codeNoWrap' });
wrapCk.checked = !!c.codeNoWrap;
var lineCk = el('input', { type: 'checkbox', 'data-cfg': 'lineNo' });
lineCk.checked = !!c.lineNo;
var forkCk = el('input', { type: 'checkbox', 'data-cfg': 'msgFork' });
forkCk.checked = c.msgFork !== false;
var grpCk = el('input', { type: 'checkbox', 'data-cfg': 'groupSessions' });
grpCk.checked = c.groupSessions !== false;
p.appendChild(el('div', { class: 'f-row' }, [el('label', {}, [wrapCk, ' 代码块不自动换行（横向滚动）'])]));
p.appendChild(el('div', { class: 'f-row' }, [el('label', {}, [lineCk, ' 代码块显示行号'])]));
p.appendChild(el('div', { class: 'f-row' }, [el('label', {}, [forkCk, ' 消息上显示「从这里新开」分支按钮'])]));
p.appendChild(el('div', { class: 'f-row' }, [el('label', {}, [grpCk, ' 会话列表按「今天 / 昨天 / 本周 / 更早」分组'])]));
      var qbCk = el('input', { type: 'checkbox', 'data-cfg': 'quickbar' });
      qbCk.checked = !!c.quickbar;
      p.appendChild(el('div', { class: 'f-row' }, [
        el('label', {}, [qbCk, ' 任务栏快速输入条（Enter 提问，Esc / × 隐藏）'])
      ]));
      /* v0.4.0：手机端悬浮球开关（桌面无悬浮球，不显示） */
      if (document.body.classList.contains('m-phone')){
        var bbCk = el('input', { type: 'checkbox', 'data-cfg': 'bubble' });
        bbCk.checked = c.bubble !== false;
        bbCk.addEventListener('change', function(){
          setCfg({ bubble: bbCk.checked });
          try {
            if (typeof NET !== 'undefined' && NET.bridge && NET.bridge.ok) NET.bridge.send({ t: 'bubble', show: bbCk.checked });
          } catch (e) {}
        });
        p.appendChild(el('div', { class: 'f-row' }, [
          el('label', {}, [bbCk, ' 悬浮球截屏提问'])
        ]));
        p.appendChild(el('div', { class: 'hint', text: '关闭后悬浮球和常驻通知一起消失；需要时在这里重新打开。' }));
      }

      /* 网络代理（原独立「代理」页；v0.3.4 起默认直连） */
      p.appendChild(el('div', { class: 'sub', text: '网络代理' }));
      p.appendChild(field('HTTP 代理', cfgInput('proxy', 'text', 'direct'),
        '默认 direct = 直连（不走任何代理）。留空 = 跟随系统代理；也可填 http://127.0.0.1:7897（Clash / mihomo 混合端口）。格式 http://[user:pass@]host:port，缺 http:// 会自动补；走宿主桥通道：对话流式、模型列表、联网搜索、正文抓取、文档 OCR 都会使用；浏览器直连与页面内请求跟随系统代理，无法单独指定。'));
      p.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
        el('button', { class: 'btn btn-sec', 'data-m': 'proxy-test', text: '测试连通性' })
      ]));
      p.appendChild(el('div', { class: 'hint', text: '测试：经当前代理访问 gstatic 探测页（generate_204）。返回 204 即代理可用；改完地址记得先测再用。' }));
/* v3.0 #9：代理按域名分流——列出的主机一律直连（常见：本地目录/内网网关） */
p.appendChild(field('直连例外', cfgInput('proxyDirect', 'text', 'models.dev, openrouter.ai, 192.168.*'),
  '逗号分隔；命中的主机一律直连（目录、自检、本地网关用）。支持 * 通配。代理为 direct 时本项无影响。'));

      /* 全局参数（原独立「全局参数」页） */
      p.appendChild(el('div', { class: 'sub', text: '全局参数' }));
      var t = el('input', { class: 'f-in', type: 'number', step: '0.1', 'data-cfg': 'temperature', value: S.cfg.temperature });
      var m = el('input', { class: 'f-in', type: 'number', 'data-cfg': 'maxTokens', value: S.cfg.maxTokens });
      p.appendChild(el('div', { class: 'f-grid' }, [field('temperature', t), field('max_tokens', m)]));
      p.appendChild(el('div', { class: 'hint', text: 'max_tokens = 单次回复输出上限；0 = 不限制（请求不带该字段，思考过程不会被截断）。' }));

      /* 数据（原独立「数据」页） */
      p.appendChild(el('div', { class: 'sub', text: '数据' }));
      p.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
        el('button', { class: 'btn btn-sec', 'data-m': 'export' }, [icon('dl'), '导出全部 JSON']),
        el('button', { class: 'btn btn-sec', 'data-m': 'import' }, [icon('ul'), '导入 JSON']),
        el('button', { class: 'btn btn-danger', 'data-m': 'clear', text: '清空全部数据' })
      ]));
      p.appendChild(el('div', { class: 'hint', style: 'margin-top:10px', text: '全部数据在本机 WebView2（IndexedDB+localStorage），不上传。' }));
    });

    /* —— 页④ 数据与维护（v3.0） —— */
    page('data', '数据与维护', function(p){
      p.appendChild(el('div', { class: 'sub', text: '连接自检' }));
      p.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
        el('button', { class: 'btn btn-primary', 'data-m': 'self-check', text: '一键自检' }),
        el('button', { class: 'btn btn-sec', 'data-m': 'diag', text: '导出诊断包' })
      ]));
      p.appendChild(el('div', { class: 'hint', text: '依次检查：代理 / 模型列表 / 能力目录 / OCR，失败项会给出建议。' }));

      /* v1.29.0：本地诊断计数（不联网、不上传） */
    p.appendChild(el('div', { class: 'sub', text: '本地诊断' }));
    (function(){
      var box = el('div', { class: 'diag-box' });
      function row2(k, label){
        box.appendChild(el('div', { class: 'diag-row' }, [
          el('span', { class: 'diag-k', text: label }),
          el('span', { class: 'diag-v', text: String(DIAG[k] || 0) })
        ]));
      }
      row2('ok', '请求成功');
      row2('fail', '请求失败');
      row2('stop', '用户中止');
      row2('toolFail', '工具失败（按正文标记估算）');
      row2('timeouts', '超时标记');
      row2('undos', '撤销写入');
      row2('gated', '计划门禁拦截');
      p.appendChild(box);
      var pv = Object.keys(DIAG.prov || {}).sort(function(a, b){ return (DIAG.prov[b].last || 0) - (DIAG.prov[a].last || 0); }).slice(0, 5);
      if (pv.length){
        var pl = el('div', { class: 'diag-box' });
        pv.forEach(function(k){
          var it = DIAG.prov[k];
          pl.appendChild(el('div', { class: 'diag-row' }, [
            el('span', { class: 'diag-k', text: k, title: k }),
            el('span', { class: 'diag-v', text: '成功 ' + (it.ok || 0) + ' / 失败 ' + (it.fail || 0) }),
            el('span', { class: 'hint', text: it.msg ? ('最近：' + it.msg) : (it.last ? new Date(it.last).toLocaleString() : '') })
          ]));
        });
        p.appendChild(pl);
      }
      p.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
        el('button', { class: 'btn btn-sec', 'data-m': 'diag-out', text: '导出诊断计数' }),
        el('button', { class: 'btn btn-sec', 'data-m': 'diag-clear', text: '清空计数' })
      ]));
      p.appendChild(el('div', { class: 'hint', text: '只存在本机 localStorage，不含对话内容；用来判断是端点限流 / 模型不支持，还是用法问题。' }));
    })();

    p.appendChild(el('div', { class: 'sub', text: '存储' }));
      p.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
        el('button', { class: 'btn btn-sec', 'data-m': 'storage', text: '查看用量与清理' }),
        el('button', { class: 'btn btn-sec', 'data-m': 'catalog-clear', text: '清空能力目录缓存' })
      ]));
      p.appendChild(el('div', { class: 'hint', text: '目录缓存用于离线补全模型能力；清空后下次「获取列表」会重新下载，并只保留池内与最近使用的条目。' }));

      p.appendChild(el('div', { class: 'sub', text: '配置快照（不含 API Key）' }));
      p.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
        el('button', { class: 'btn btn-sec', 'data-m': 'snap-out' }, [icon('dl'), '导出快照']),
        el('button', { class: 'btn btn-sec', 'data-m': 'snap-in' }, [icon('ul'), '导入快照'])
      ]));
      p.appendChild(el('div', { class: 'hint', text: '包含配置、模型能力表、提示词与快捷键；导入按字段合并，不会覆盖密钥。' }));

      p.appendChild(el('div', { class: 'sub', text: 'Agent / Work 写入策略' }));
      p.appendChild(field('危险扩展名需确认', cfgInput('dangerExt', 'text', 'exe,bat,cmd,ps1,dll,msi,scr'),
        '逗号分隔，不带点。命中时即使开启「自动写入」也会弹确认。留空 = 全部自动。'));
      p.appendChild(field('写入白名单目录', cfgInput('writeDirs', 'text', 'C:\\work\\demo'),
        '逗号分隔的绝对路径前缀；非空时只允许写入这些目录下的文件。留空 = 不限制。'));
    });
    page('keys', '快捷键', function(p){
      var defs = [['newSession', '新建会话（应用内）'], ['search', '搜索会话'], ['theme', '切换明暗主题'],
        ['sidebar', '固定 / 收起侧栏'],
        ['quickbar', '快速输入条（全局）'], ['showMain', '显示主窗口（全局）'],
        ['newGlobal', '新建会话（全局）'], ['tempGlobal', '新建临时会话（全局）']];
      var sc = S.cfg.shortcuts || {};
      defs.forEach(function(d){
        var btn = el('button', { class: 'btn btn-sec', 'data-m': 'bindkey', 'data-k': d[0],
          text: (S.recKey === d[0]) ? '按下组合键…' : (sc[d[0]] || '未绑定') });
        p.appendChild(el('div', { class: 'f-row', style: 'display:flex;align-items:center;justify-content:space-between;gap:10px' }, [
          el('label', { text: d[1], style: 'margin:0' }), btn
        ]));
      });
      /* v3.0 #6：冲突检测（同一组合键绑了两个动作时标红） */
      (function(){
        var seen = {}, dup = [];
        defs.forEach(function(d){
          var k = String(sc[d[0]] || '').toLowerCase().trim();
          if (!k) return;
          if (seen[k]) { dup.push(k); return; }
          seen[k] = 1;
        });
        if (!dup.length) return;
        p.appendChild(el('div', { class: 'hint', style: 'color:var(--danger)', text: '组合键冲突：' + dup.join('、') + '（同一组合被绑到多个动作）' }));
        var bs = p.querySelectorAll('[data-m="bindkey"]');
        for (var i = 0; i < bs.length; i++)
          if (dup.indexOf(String(bs[i].textContent || '').toLowerCase().trim()) >= 0) bs[i].classList.add('sc-key', 'clash');
      })();
      p.appendChild(el('div', { class: 'hint', text: '「全局」= 在任何程序里都生效，需要桌面版宿主（exe）；应用内快捷键只在窗口聚焦时生效。新组合键需含 Ctrl/Alt/Meta，Esc 取消，留空可解除绑定。' }));
      p.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
        el('button', { class: 'btn btn-sec', 'data-m': 'reset-keys', text: '恢复默认快捷键' })
      ]));
    });

    /* —— 页⑤ 提示词 —— */
    /* v0.5.13：所有 password 输入加「小眼睛」，可临时明文查看 API Key（不写入任何额外存储） */
    Array.prototype.forEach.call(body.querySelectorAll('input[type=password]'), function(inp){
      if (inp.parentNode && inp.parentNode.classList && inp.parentNode.classList.contains('pw-wrap')) return;
      var wrap = el('div', { class: 'pw-wrap' });
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      var eye = el('button', { class: 'pw-eye', type: 'button', title: '显示 API Key', 'aria-label': '显示 API Key' }, [icon('eye')]);
      wrap.appendChild(eye);
      eye.addEventListener('click', function(e){
        e.preventDefault();
        var show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        eye.textContent = '';
        eye.appendChild(icon(show ? 'eye-off' : 'eye'));
        eye.title = show ? '隐藏 API Key' : '显示 API Key';
        eye.setAttribute('aria-label', eye.title);
        try { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } catch (err) {}
      });
    });
    /* v1.18：提示词并入扩展页（智能体/插件/技能/工具/提示词/MCP） */
  function buildPromptPage(p){
    var userBox = el('div'), sysBox = el('div');
    sysBox.style.display = 'none';
    p.appendChild(pageTabs([['user', '用户自定义'], ['system', '系统提示词']], function(k){
      userBox.style.display = (k === 'user') ? '' : 'none';
      sysBox.style.display = (k === 'system') ? '' : 'none';
      if (k === 'system') renderSys();
    }));
    p.appendChild(userBox); p.appendChild(sysBox);

    /* ---- 用户自定义（原来的卡片 + 编辑器） ---- */
    var box = el('div', { class: 'p-cards' }), edHost = el('div', { id: 'p-editor' });
    function editor(pr, idx){
      return el('div', { class: 'p-card edit' }, [
        el('input', { class: 'f-in', id: 'p-ed-name', placeholder: '名称（如：翻译）', value: pr ? pr.name : '' }),
        el('textarea', { class: 'f-in', id: 'p-ed-text', placeholder: '提示词内容…', style: 'min-height:88px', text: pr ? pr.text : '' }),
        el('div', { class: 'f-actions', style: 'margin:0' }, [
          el('button', { class: 'btn btn-sec', 'data-m': 'p-ed-cancel', text: '取消' }),
          el('button', { class: 'btn btn-primary', 'data-m': 'p-ed-save', 'data-i': idx==null?'':idx, text: '保存' })
        ])
      ]);
    }
    function refresh(){
      box.textContent = '';
      var ps = c.prompts || [];
      if (!ps.length) box.appendChild(el('div', { class: 'hint', text: '还没有提示词。点上方新建，对话输入 /名称 插入。' }));
      for (var i = 0; i < ps.length; i++){
        (function(pr, idx){
          box.appendChild(el('div', { class: 'p-card' }, [
            el('div', { class: 'p-name', text: '/' + pr.name }),
            el('div', { class: 'p-text', text: pr.text }),
            el('div', { class: 'f-actions', style: 'margin:0' }, [
              el('button', { class: 'btn btn-sec', 'data-m': 'p-view', 'data-i': idx, text: '查看' }),
          el('button', { class: 'btn btn-sec', 'data-m': 'p-export', 'data-i': idx, text: '导出' }),
          el('button', { class: 'btn btn-sec', 'data-m': 'p-ed-open', 'data-i': idx, text: '编辑' }),
              el('button', { class: 'btn btn-danger', 'data-m': 'p-del', 'data-i': idx, text: '删除' })
            ])
          ]));
        })(ps[i], i);
      }
    }
    userBox.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
      el('button', { class: 'btn btn-sec', 'data-m': 'p-new' }, [icon('plus'), '新建提示词'])
    ]));
    userBox.appendChild(box); userBox.appendChild(edHost);
    S._pRefresh = refresh; S._pEditor = editor;
    refresh();

    /* ---- 系统提示词（只读：模型实际收到的原文） ---- */
    function copyText(txt){
      try {
        if (window.chrome && chrome.webview && chrome.webview.postMessage) chrome.webview.postMessage({ t: 'copy', text: txt });
        else if (navigator.clipboard) navigator.clipboard.writeText(txt);
        UI.toast('已复制');
      } catch(e){ UI.toast('复制失败', true); }
    }
    function sec(title, txt, note, key){
      var card = el('div', { class: 'sub-card' });
      var head = el('div', { class: 'sc-h' }, [ el('span', { class: 'sc-name', text: title }) ]);
      var body = el('div');
      if (key && MODE.edited(key)) head.appendChild(el('span', { class: 'sc-chip', text: '已改' }));
      if (txt){
        var cp = el('button', { class: 'btn btn-ghost rn-mini', text: '复制' });
        cp.addEventListener('click', function(){ copyText(txt); });
        head.appendChild(cp);
        var exs = el('button', { class: 'btn btn-ghost rn-mini', text: '导出' });
        exs.addEventListener('click', function(){
          try { savePkg(EXT.packText(title, txt)); } catch(e){ UI.toast('导出失败：' + (e && e.message || e), true); }
        });
        head.appendChild(exs);
      }
      if (key){
        var ed = el('button', { class: 'btn btn-ghost rn-mini', text: '编辑' });
        ed.addEventListener('click', function(){
          body.textContent = '';
          var ta = el('textarea', { class: 'f-in', style: 'min-height:190px;line-height:1.6;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px', text: txt || '' });
          var save = el('button', { class: 'btn btn-primary rn-mini', text: '保存' });
          save.addEventListener('click', function(){
            var o = Object.assign({}, S.cfg.sysEdits || {});
            o[key] = ta.value;
            setCfg({ sysEdits: o });
            UI.toast('已保存：' + title + '（下一条消息生效）');
            renderSys();
          });
          var cancel = el('button', { class: 'btn btn-ghost rn-mini', text: '取消' });
          cancel.addEventListener('click', function(){ renderSys(); });
          var reset = el('button', { class: 'btn btn-ghost rn-mini', text: '恢复默认' });
          reset.addEventListener('click', function(){
            var o = Object.assign({}, S.cfg.sysEdits || {});
            delete o[key];
            setCfg({ sysEdits: o });
            UI.toast('已恢复默认：' + title);
            renderSys();
          });
          body.appendChild(ta);
          body.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start;margin:6px 0 0' }, [save, cancel, reset]));
        });
        head.appendChild(ed);
      }
      card.appendChild(head);
      if (note) card.appendChild(el('div', { class: 'sc-desc', style: 'font-size:11.5px;color:var(--muted)', text: note }));
      body.appendChild(el('pre', { text: txt || '（空）' }));
      card.appendChild(body);
      return card;
    }
    function renderSys(){
      sysBox.textContent = '';
      sysBox.appendChild(sec('Chat · 纯对话', MODE.text('chat'), S.cfg.research ? '深度研究已开，本段不生效' : '', 'chat'));
      sysBox.appendChild(sec('Chat · 深度研究', MODE.text('research'), S.cfg.research ? '开关已开' : '', 'research'));
      sysBox.appendChild(sec('Work', MODE.text('work'), '', 'work'));
      sysBox.appendChild(sec('Agent', MODE.text('agent'), '', 'agent'));
      SUB.ROLES.forEach(function(r){
        sysBox.appendChild(sec('子智能体 · ' + r.name + (r.title ? '（' + r.title + '）' : ''), (MODE.edited('sub:' + r.id) ? S.cfg.sysEdits['sub:' + r.id] : r.body),
          '', 'sub:' + r.id));
      });
      EXT.all().forEach(function(it){
        if (it.kind === 'agent' && it.on !== false)
          sysBox.appendChild(sec('子智能体 · ' + it.name + '（自定义）', it.body || '', '', 'sub:' + it.id));
      });
      EXT.all().forEach(function(it){
        if (it.kind === 'skill' && it.on !== false)
          sysBox.appendChild(sec('技能 · ' + it.name, it.body || '', it.desc || '（无说明）'));
      });
      ['chat', 'work', 'agent'].forEach(function(m){
        var ex = EXT.prompt(m);
        sysBox.appendChild(sec('扩展视角 · ' + m, ex, '这一模式下启用的自定义工具/技能摘要'));
      });
      var mcp = S.cfg.mcp || [];
      if (mcp.length) sysBox.appendChild(sec('MCP 服务器（登记）', mcp.map(function(m){ return '· ' + (m.name || m.url) + ' — ' + m.url + '（' + ((m.tools||[]).length) + ' 个工具）'; }).join('\n'), '只在「扩展 → MCP」里登记与探测'));
    }
    renderSys();
  }

  /* —— 页⑥ 关于 —— */
    /* —— 页 扩展（v0.4.0）：内置功能开关 + 自定义 tools / skills / plugins —— */
    page('ext', '扩展', function(p){
    var filter = 'agents';
    var INTRO = {
      tools: '内置能力默认全开，关掉后模型调用会被直接拒绝；下面还能加自己的声明式 http 工具。',
      agents: '子智能体：内置角色只读展示（含内部提示词），下面可以拼一个自己的组合智能体。',
      skills: '技能 = 一段说明，平时只占一行，模型需要时才用 \u0060\u0060\u0060skill 取全文。',
      plugins: '插件 = 扩展包：一个文件夹带一组技能 / 工具 / 智能体 / 提示词，导入后落到各自页面，这里只显示包与来源。',
      prompt: '提示词 = 模型这一轮看到的东西：左边是你自己的常用提示词，右边是实际拼接进系统提示词的全文（含模式、子智能体、技能、扩展与 MCP 登记）。',
    mcp: 'MCP = 外部工具服务器（HTTP JSON-RPC）。登记地址后可探测 tools/list，工具执行链路后续接。'
    };
    p.appendChild(pageTabs([['agents', '智能体'], ['plugins', '插件'], ['skills', '技能'], ['tools', '工具'], ['prompt', '提示词'], ['mcp', 'MCP']], function(k){ setFilter(k); }));
    /* 折叠面板：已有 / 市场 / 导入导出，默认全折叠，一次只开一个；MCP 仍单页 */
    var accBox = el('div', { class: 'ext-acc-box' });
    var accLocal = el('details', { class: 'ext-acc' }),
        accMarket = el('details', { class: 'ext-acc' }),
        accImport = el('details', { class: 'ext-acc' });
    var localBody, marketBody, importBody;
    [['local', accLocal, '已有'], ['market', accMarket, '市场'], ['import', accImport, '导入导出']].forEach(function(a){
      var d = a[1];
      d.open = false;
      var sum = el('summary', { text: a[2] });
      var body = el('div', { class: 'acc-body' });
      d.appendChild(sum); d.appendChild(body);
      d._sum = sum;
      if (a[0] === 'local') localBody = body;
      else if (a[0] === 'market') marketBody = body;
      else importBody = body;
      d.addEventListener('toggle', function(){
        if (!d.open) return;
        [accLocal, accMarket, accImport].forEach(function(o){ if (o !== d) o.open = false; });
        renderSection(a[0]);
      });
      accBox.appendChild(d);
    });
    p.appendChild(accBox);
    var mktExtBox = el('div'), importResult = el('div', { class: 'hint' });

    var modeBox = el('div', { class: 'sub' });
    p.appendChild(modeBox);
    function renderModeBox(){
      function cnt(mode){
        var on = 0, all = EXT.all();
        for (var i = 0; i < all.length; i++){
          var it = all[i];
          if ((it.modes || []).indexOf(mode) < 0) continue;
      if (it.kind !== 'agent') continue; // v0.3.89：这一行统计的是「智能体」，以前把内置工具也算进去了，Work 15 / Agent 13 会让人误会
          if (it.on !== false) on++;
        }
        return on;
      }
    modeBox.textContent = '自定义智能体：Chat ' + cnt('chat') + '（Chat 不派子智能体，纯对话）· Work ' + cnt('work') + ' · Agent ' + cnt('agent') +
      ' · 子智能体 ' + SUB.profiles('work').length;
    }
    renderModeBox();

    var arRow = el('div', { class: 'f-row' });
    (function(){
      var arCk = el('input', { type: 'checkbox' }); arCk.checked = !!S.cfg.autoRoute;
      arCk.addEventListener('change', function(){ setCfg({ autoRoute: arCk.checked }); });
      arRow.appendChild(el('label', {}, [arCk, ' 自动选模式（按本轮输入切 Chat / Work / Agent；切换会在输入框上方明示，可一键切回）']));
    })();
    p.appendChild(arRow);

    var list = el('div', { class: 'f-grid' });
    p.appendChild(list);

    /* ---------- 智能体：卡片 + 组合器 ---------- */
    var agentBox = el('div');
    p.appendChild(agentBox);
    function agentCard(r, builtin){
      var acl = SUB.aclOf(r);
      var card = el('div', { class: 'sub-card' });
      var head = el('div', { class: 'sc-h' }, [
        el('span', { class: 'sc-name', text: (r.title ? r.title + ' · ' : '') + r.name }),
        el('span', { class: 'sc-chip', text: '工具 ' + acl.length + ' 项' }),
        el('span', { class: 'sc-chip', text: r.writes ? '可写(暂存)' : '只读' }),
        el('span', { class: 'sc-chip', text: '轮数 ≤ ' + (r.maxTurns || 3) })
      ]);
      var ahost = el('div', { class: 'det-host' });
    var vA = chevBtn(ahost, function(){
        return { title: (r.title ? r.title + ' · ' : '') + r.name, blocks: [
          { k: '说明', v: r.desc || '（无）' },
          { k: '可用工具', v: acl.length ? acl.join(' / ') : '（无）' },
          { k: '轮次 / token', v: '≤ ' + (r.maxTurns || 3) + ' 轮，≤ ' + (r.maxTokens || 1200) + ' token' },
          { k: '读写', v: r.writes ? '可写（暂存区）' : '只读' },
          { k: '来源', v: builtin ? '内置角色' : (r.pkg ? r.pkg : '（手工添加，无包）') },
          { k: '提示词正文', v: r.body || '' }
        ]};
    });
    if (builtin) head.appendChild(el('span', { class: 'sc-chip', text: '内置' }));
      else {
        var exA = el('button', { class: 'btn btn-ghost rn-mini', text: '导出' });
        exA.addEventListener('click', function(){
          try { savePkg(EXT.exportOne(r.id)); } catch(e){ UI.toast('导出失败：' + (e && e.message || e), true); }
        });
        head.appendChild(exA);
        var del = el('button', { class: 'btn btn-ghost rn-mini', text: '删除' });
        del.addEventListener('click', function(){ EXT.del(r.id); renderAgents(); renderModeBox(); });
        head.appendChild(del);
      }
    head.appendChild(vA);   /* v1.29.2：展开箭头放右端 */
      card.appendChild(head);
      card.appendChild(el('div', { class: 'sc-desc', text: r.desc || '' }));
      card.appendChild(el('div', { class: 'sc-desc', style: 'font-size:11.5px;color:var(--muted);margin:0', text: '可用工具：' + (acl.length ? acl.join(' / ') : '无（纯推理）') }));
      card.appendChild(ahost);
      return card;
    }
    var TOOL_POOL = ['fs-read', 'fs-list', 'fs-write', 'fs-edit', 'patch', 'skill', 'web', 'search', 'get', 'agent', 'cmd', 'python'];
    function agentComposer(){
      var box = el('div', { class: 'sub-card' });
      box.appendChild(el('div', { class: 'sc-name', text: '新建组合智能体' }));
      box.appendChild(el('div', { class: 'sc-desc', text: '起个名字，勾选它能用的工具，写清它的职责和输出格式；保存后母智能体就能 \u0060\u0060\u0060agent 名字 任务 派它干活。' }));
      var nameIn = el('input', { class: 'f-in', placeholder: '显示名，如：数据分析' });
      var idIn = el('input', { class: 'f-in', placeholder: 'ID：小写字母/数字/短横，如 data-analyst' });
      var row1 = el('div', { style: 'display:flex;gap:8px;margin:6px 0' }, [nameIn, idIn]);
      nameIn.style.flex = '1'; idIn.style.flex = '1';
      box.appendChild(row1);
      var tpl = el('div', { class: 'f-actions', style: 'margin:6px 0 0;justify-content:flex-start' });
      SUB.ROLES.forEach(function(r){
        var b = el('button', { class: 'btn btn-ghost rn-mini', text: '照抄 ' + r.name });
        b.addEventListener('click', function(){
          ta.value = r.body || ''; nameIn.value = nameIn.value || (r.title || r.name);
          idIn.value = idIn.value || (r.name + '-' + Math.random().toString(36).slice(2, 5));
          TOOL_POOL.forEach(function(t){ cks[t].checked = (SUB.aclOf(r).indexOf(t) >= 0); });
        });
        tpl.appendChild(b);
      });
      box.appendChild(tpl);
      var ta = el('textarea', { class: 'f-in', rows: '5', placeholder: '内部提示词：你是谁、负责什么、输出什么格式、不许做什么' });
      ta.style.width = '100%';
      box.appendChild(ta);
      var grid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0' });
      var cks = {};
      TOOL_POOL.forEach(function(t){
        var ck = el('input', { type: 'checkbox' }); cks[t] = ck;
        grid.appendChild(el('label', { class: 'sc-chip', style: 'cursor:pointer' }, [ck, ' ' + t]));
      });
      box.appendChild(grid);
      var save = el('button', { class: 'btn btn-primary', text: '添加' });
      save.addEventListener('click', function(){
        try {
          var id = String(idIn.value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 25);
          if (!/^[a-z][a-z0-9-]{1,24}$/.test(id)) id = 'ag' + Date.now().toString(36);
          var sel = TOOL_POOL.filter(function(t){ return cks[t].checked; });
          EXT.add({ kind: 'agent', name: id, title: (nameIn.value || '').trim() || id,
            desc: '自定义组合 · 工具 ' + sel.length + ' 项',
            body: ta.value || '', tools: sel,
            writes: sel.indexOf('fs-write') >= 0 || sel.indexOf('patch') >= 0,
            modes: ['work', 'agent'], maxTurns: 4 });
          UI.toast('已添加智能体：' + ((nameIn.value || '').trim() || id));
          renderAgents(); renderModeBox();
        } catch(e){ UI.toast('添加失败：' + (e && e.message || e), true); }
      });
      box.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start;margin-top:8px' }, [save]));
      return box;
    }
    function renderAgents(){
      agentBox.textContent = '';
      SUB.ROLES.forEach(function(r){ agentBox.appendChild(agentCard(r, true)); });
      var mine = EXT.all().filter(function(it){ return it.kind === 'agent'; });
      mine.forEach(function(it){ agentBox.appendChild(agentCard(it, false)); });
      agentBox.appendChild(agentComposer());
    }

    /* ---------- 插件市场（v1.1.26） ---------- */
var addBox = el('div');
var BUILTIN_MARKET = { version: 1, plugins: [{
  id: 'python-3.11', kind: 'runtime', name: 'Python 3.11', version: '3.11.9',
  description: '便携式 Python 3.11.9 运行时，含 uv。安装后可在 Agent 模式执行 Python 脚本。',
  file: 'plugins/python-3.11.9-runtime.zip',
  sha256: '3ab929da23d57ec8ce581d3b6d7297a8d069b2b1661425c6c26008d11113b28f',
  size: 26128140
}]};
var marketBox = el('div');
addBox.appendChild(marketBox);
addBox.appendChild(mktExtBox);   /* 扩展包市场（origin/ext/plugins index.json），与运行时卡片并列 */
function renderMarket(){
  marketBox.textContent = '';
  marketBox.appendChild(el('div', { class: 'sub', style: 'margin:0 0 6px', text: '插件市场 · 运行时' }));
  var hostHint = el('div', { class: 'hint', style: 'margin:0 0 8px', text: '安装位置：%LOCALAPPDATA%\\OpenPage\\runtimes；不需要管理员权限，不改 PATH。' });
  marketBox.appendChild(hostHint);
  function draw(cat, installed){
    var list = (cat && cat.plugins) || [], have = {};
    (installed || []).forEach(function(x){ if (x && x.id) have[x.id] = x; });
    var avail = list.filter(function(p){ return !have[p.id]; });
    if (!avail.length){ marketBox.appendChild(el('div', { class: 'hint', text: '运行时都已安装；已安装的运行时在「已有」里管理。' })); return; }
    avail.forEach(function(p){
      var card = el('div', { class: 'sub-card' });
      card.appendChild(el('div', { class: 'sc-h' }, [
        el('span', { class: 'sc-name', text: p.name + ' ' + p.version }),
        el('span', { class: 'sc-chip', text: p.kind === 'runtime' ? '运行时' : (p.kind || '插件') }),
        el('span', { class: 'sc-chip', text: sizeFmt(p.size || 0) })
      ]));
      card.appendChild(el('div', { class: 'sc-desc', text: p.description || '' }));
      var bt = el('button', { class: 'btn btn-primary rn-mini', text: '安装' });
      bt.disabled = !NET.bridge.ok;
      bt.addEventListener('click', function(){
        bt.disabled = true; bt.textContent = '安装中…';
        var payload = { runtimeId: p.id, name: p.name, version: p.version, sha256: p.sha256 || '' };
        if (p.file) payload.file = p.file; else payload.url = p.url;
        NET.bridge.runtime('install', payload).then(function(r){
          UI.toast('已安装 ' + p.name + ' ' + (r && r.version || p.version));
          renderMarket(); renderRuntimeLocal(); renderModeBox();
        }, function(e){
          bt.disabled = false; bt.textContent = '安装';
          UI.toast('安装失败：' + (e && e.message || e), true);
        });
      });
      card.appendChild(el('div', { class: 'f-actions', style: 'margin:0;justify-content:flex-start' }, [bt]));
      marketBox.appendChild(card);
    });
  }
  function catalog(){
    return fetch('plugins/market.json', { cache: 'no-store' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(cat){
      return (cat && cat.plugins && cat.plugins.length) ? cat : BUILTIN_MARKET;
    }).catch(function(){ return BUILTIN_MARKET; });
  }
  NET.bridge.runtime('list').then(function(installed){
    catalog().then(function(cat){ draw(cat, installed); });
  }, function(){
    marketBox.textContent = '';
    marketBox.appendChild(el('div', { class: 'hint', text: '运行时接口不可用（需要 exe 宿主版）。' }));
  });
}
renderMarket();
var fiFiles = el('input', { type: 'file', multiple: '', accept: '.json,.md,.markdown,.txt', style: 'display:none' });
var fiDir = el('input', { type: 'file', multiple: '', style: 'display:none' });
fiDir.setAttribute('webkitdirectory', ''); fiDir.setAttribute('directory', '');
var bFiles = el('button', { class: 'btn btn-sec', text: '导入文件…' });
var bDir = el('button', { class: 'btn btn-primary', text: '导入文件夹…' });
bFiles.addEventListener('click', function(){ fiFiles.click(); });
bDir.addEventListener('click', function(){ fiDir.click(); });
var importRow = el('div', { class: 'f-actions', style: 'justify-content:flex-start;margin:6px 0' }, [bFiles, bDir, fiFiles, fiDir]);
addBox.appendChild(importRow);
var openLast = el('button', { class: 'btn btn-ghost rn-mini', text: '打开上次导出' });
openLast.addEventListener('click', function(){
  if (!S.cfg.lastPkgDir) return UI.toast('还没有导出过', true);
  NET.revealPath(S.cfg.lastPkgDir);
});
var bExpKind = el('button', { class: 'btn btn-sec rn-mini', text: '导出本类…' });
bExpKind.addEventListener('click', function(){
  try { savePkg(EXT.exportKind(filter)); } catch(e){ UI.toast('导出失败：' + (e && e.message || e), true); }
});
var exportRow = el('div', { style: 'margin:0 0 10px' });
exportRow.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start;margin:0 0 4px;gap:8px' }, [openLast, bExpKind]));
exportRow.appendChild(el('div', { class: 'ext-acc-hint', text: '导出时会弹出文件夹选择器' }));
addBox.appendChild(exportRow);
function pkgDone(rep){ afterImport(rep); }
function doImport(list){
  EXT.importFiles(list).then(pkgDone, function(e){ UI.toast('导入失败：' + (e && e.message || e), true); });
}
fiFiles.addEventListener('change', function(){ doImport(fiFiles.files); fiFiles.value = ''; });
fiDir.addEventListener('change', function(){ doImport(fiDir.files); fiDir.value = ''; });
/* 拖放（含文件夹） */
function walkEntry(ent, path, out){
  return new Promise(function(res){
    if (ent.isFile){ ent.file(function(f){ if (f){ f._rel = path + ent.name; out.push(f); } res(); }, function(){ res(); }); return; }
    if (ent.isDirectory){
      var rd = ent.createReader(), all = [];
      (function more(){
        rd.readEntries(function(es){
          if (!es.length){
            var ch = Promise.resolve();
            all.forEach(function(x){ ch = ch.then(function(){ return walkEntry(x, path + ent.name + '/', out); }); });
            ch.then(function(){ res(); }); return;
          }
          all = all.concat(Array.prototype.slice.call(es)); more();
        }, function(){ res(); });
      })();
      return;
    }
    res();
  });
}
function collectDrop(dt){
  var items = dt && dt.items ? Array.prototype.slice.call(dt.items) : [];
  var ents = items.map(function(it){ try { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; } catch(e){ return null; } }).filter(Boolean);
  if (!ents.length) return Promise.resolve(Array.prototype.slice.call((dt && dt.files) || []));
  var out = [], ch = Promise.resolve();
  ents.forEach(function(en){ ch = ch.then(function(){ return walkEntry(en, '', out); }); });
  return ch.then(function(){ return out; });
}
var dropZone = el('div', { class: 'pkg-drop', text: '把文件或文件夹拖到这里' });
dropZone.addEventListener('dragover', function(e){ e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', function(){ dropZone.classList.remove('over'); });
dropZone.addEventListener('drop', function(e){
  e.preventDefault(); dropZone.classList.remove('over');
  collectDrop(e.dataTransfer).then(function(fs){ if (fs.length) doImport(fs); });
});
addBox.appendChild(dropZone);
/* 已导入的包 */
var pkgsBox = el('div', { class: 'pkg-list' });
function renderPkgs(){
  pkgsBox.textContent = '';
  var map = {}, order = [];
  var prAll = (S.cfg.prompts || []).filter(function(x){ return x.pkg; });
  EXT.all().forEach(function(it){
    if (!it.pkg) return;
    if (!map[it.pkg]){ map[it.pkg] = []; order.push(it.pkg); }
    map[it.pkg].push(it);
  });
  if (!order.length){ pkgsBox.appendChild(el('div', { class: 'hint', text: '还没有导入扩展包。' })); return; }
  order.forEach(function(p){
    var items = map[p];
    var card = el('div', { class: 'sub-card' });
    var nameRow = el('div', { class: 'sc-h' }, [el('span', { class: 'sc-name', text: p + (items[0].pkgVer ? '（' + items[0].pkgVer + '）' : '') })]);
    var prThis = prAll.filter(function(x){ return x.pkg === p; });
    card.appendChild(el('div', { class: 'sub', text:
      items.map(function(x){ return (x.kind === 'skill' ? '技能·' : x.kind === 'agent' ? '智能体·' : '工具·') + (x.title || x.name); })
        .concat(prThis.map(function(x){ return '提示词·' + x.name; })).join('、') }));
    var rm = el('button', { class: 'btn btn-danger rn-mini', text: '移除整包' });
    rm.addEventListener('click', function(){
      EXT.delPkg(p);
      renderPkgs(); renderList(filter); renderModeBox(); UI.toast('已移除「' + p + '」');
    });
    var ex = el('button', { class: 'btn btn-sec rn-mini', text: '导出' });
    ex.addEventListener('click', function(){
      try {
        var pack = EXT.exportFiles(p);
        ex.disabled = true;
        savePkg(pack);
        setTimeout(function(){ ex.disabled = false; }, 400);
      } catch(e){ ex.disabled = false; UI.toast('导出失败：' + (e && e.message || e), true); }
    });
    var phost = el('div', { class: 'det-host' });
    /* v1.29.2：右侧箭头代替「查看」 */
    var pv = chevBtn(phost, function(){
      var pack = EXT.exportFiles(p);
      var blocks = [{ k: '文件结构（导出即长这样）', v: pack.files.map(function(f){ return f.rel; }).join('\n') }];
      pack.files.forEach(function(f){ blocks.push({ k: f.rel, v: f.text }); });
      return { title: p + (items[0].pkgVer ? '（' + items[0].pkgVer + '）' : ''), blocks: blocks };
    });
    nameRow.appendChild(pv);
    card.appendChild(nameRow);
    card.appendChild(el('div', { class: 'f-actions', style: 'margin:0;justify-content:flex-start' }, [ex, rm]));
    card.appendChild(phost);
    pkgsBox.appendChild(card);
  });
}
addBox.appendChild(pkgsBox);
renderPkgs();
/* 高级：粘贴 JSON（保留给一次性手工添加） */
