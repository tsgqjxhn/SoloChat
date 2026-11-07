var adv = el('details');
adv.appendChild(el('summary', { class: 'sub', style: 'cursor:pointer', text: '高级：粘贴 JSON（单个工具 / 技能）' }));
var taJson = el('textarea', { class: 'f-in', rows: '5', style: 'width:100%;font-family:ui-monospace,monospace;margin-top:6px', placeholder: '{"kind":"tool","name":"zen","desc":"随机格言","type":"http","url":"https://api.github.com/zen"}' });
adv.appendChild(taJson);
var addBtn = el('button', { class: 'btn btn-sec', text: '添加' });
addBtn.addEventListener('click', function(){
  try {
    var j = JSON.parse(taJson.value);
    if (j.prompt && !j.kind && !j.tools && !j.skills){ addPersona(j); UI.toast('已添加自定义模式：' + (j.name || '')); }
    else if (j.tools || j.skills){ var n = EXT.importPlugin(j); UI.toast('已导入 ' + n + ' 项'); }
    else { EXT.add(j); UI.toast('已添加：' + j.name); }
    taJson.value = ''; renderPkgs(); renderList(filter); renderModeBox();
  } catch(e){ UI.toast('添加失败：' + (e && e.message || e), true); }
});
adv.appendChild(el('div', { class: 'f-actions' }, [addBtn]));
addBox.appendChild(adv);
addBox.appendChild(importResult);   /* 自定义导入：结果提示 */
/* addBox 仅临时收集节点，页尾统一搬入折叠面板 body（不再 append 到 p） */

    /* ---------- MCP ---------- */
    var mcpBox = el('div');
    p.appendChild(mcpBox);
  var promptBox = el('div');
  promptBox.style.display = 'none';
  p.appendChild(promptBox);
  var promptBuilt = false;
  function ensurePrompt(){ if (promptBuilt) return; promptBuilt = true; buildPromptPage(promptBox); }
    function saveMcp(arr){ setCfg({ mcp: arr }); }
    function renderMcp(){
      mcpBox.textContent = '';
      var arr = (S.cfg.mcp || []).slice();
      if (!arr.length) mcpBox.appendChild(el('div', { class: 'hint', text: '还没有 MCP 服务器。' }));
      arr.forEach(function(m, idx){
        var card = el('div', { class: 'sub-card' });
        card.appendChild(el('div', { class: 'sc-h' }, [
          el('span', { class: 'sc-name', text: m.name || m.url }),
          el('span', { class: 'sc-chip', text: (m.tools || []).length + ' 个工具' }),
          el('span', { class: 'sc-chip', text: m.last || '未探测' })
        ]));
        card.appendChild(el('div', { class: 'sc-desc', text: m.url }));
        if ((m.tools || []).length) card.appendChild(el('pre', { text: (m.tools || []).join('\n') }));
        var probe = el('button', { class: 'btn btn-sec rn-mini', text: '探测' });
        probe.addEventListener('click', function(){
          probe.disabled = true; probe.textContent = '探测中…';
          NET.httpJSON({ url: m.url, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
              params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'SoloChat', version: 'v1.16' } } }),
            parse: function(j){ return j; } }).then(function(j){
            probe.disabled = false; probe.textContent = '探测';
            var list2 = arr.slice();
            if (j && j.result){
              list2[idx] = { name: m.name, url: m.url, last: '已连通', tools: m.tools || [] };
              UI.toast('连通：' + ((j.result.serverInfo && j.result.serverInfo.name) || 'MCP'));
            } else {
              list2[idx] = { name: m.name, url: m.url, last: '探测失败', tools: m.tools || [] };
              UI.toast('探测失败（可能不是 streamable HTTP 或需要鉴权）', true);
            }
            saveMcp(list2); renderMcp();
          });
        });
        var del = el('button', { class: 'btn btn-ghost rn-mini', text: '删除' });
        del.addEventListener('click', function(){ var a2 = arr.slice(); a2.splice(idx, 1); saveMcp(a2); renderMcp(); });
        card.appendChild(el('div', { class: 'f-actions', style: 'margin:0;justify-content:flex-start' }, [probe, del]));
        mcpBox.appendChild(card);
      });
      var form = el('div', { class: 'sub-card' });
      form.appendChild(el('div', { class: 'sc-name', text: '添加 MCP 服务器' }));
      var nIn = el('input', { class: 'f-in', placeholder: '名称，如：filesystem' });
      var uIn = el('input', { class: 'f-in', placeholder: 'HTTP 地址，如 http://127.0.0.1:8931/mcp' });
      nIn.style.flex = '1'; uIn.style.flex = '2';
      form.appendChild(el('div', { style: 'display:flex;gap:8px;margin:8px 0' }, [nIn, uIn]));
      var add = el('button', { class: 'btn btn-primary', text: '添加' });
      add.addEventListener('click', function(){
        var u = (uIn.value || '').trim();
        if (!u) { UI.toast('地址不能为空', true); return; }
        var a2 = (S.cfg.mcp || []).slice();
        a2.push({ name: (nIn.value || '').trim() || u, url: u, tools: [], last: '未探测' });
        saveMcp(a2); renderMcp();
      });
      form.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start;margin:0' }, [add]));
      mcpBox.appendChild(form);
    }

    function renderList(kind){
      list.textContent = '';
      var all = EXT.all(), shown = 0;
      all.forEach(function(it){
        var k = (it.kind === 'builtin' || it.kind === 'tool') ? 'tools' : (it.kind === 'skill' ? 'skills' : 'agents');
        if (k !== kind) return;
        shown++;
        var ck = el('input', { type: 'checkbox' }); ck.checked = it.on;
        ck.addEventListener('change', function(){ EXT.setOn(it.id, ck.checked); renderModeBox(); });
        var kindName = it.kind === 'builtin' ? '内置' : (it.kind === 'skill' ? '技能' : '工具');
        var modeTxt = (it.modes || []).length ? it.modes.join(' / ') : '全部模式';
        var row = el('div', { class: 'f-row ext-row' }, [
          el('label', {}, [ck, ' ' + (it.title || it.name)]),
          el('span', { class: 'hint', text: kindName + ' · ' + modeTxt + ' · ' + (it.brief || it.desc || '') })
        ]);
        var dhost = el('div', { class: 'det-host' });
        var acts = el('div', { class: 'f-acts' });
        /* v1.29.2：右侧箭头代替「查看」 */
    acts.appendChild(chevBtn(dhost, function(){ return EXT.describe(it.id); }));
        if (it.kind !== 'builtin'){
          var exBtn = el('button', { class: 'btn btn-ghost rn-mini', text: '导出' });
          exBtn.addEventListener('click', function(){
            try { savePkg(EXT.exportOne(it.id)); } catch(e){ UI.toast('导出失败：' + (e && e.message || e), true); }
          });
          acts.appendChild(exBtn);
          var delBtn = el('button', { class: 'btn btn-ghost rn-mini', text: '删除' });
          delBtn.addEventListener('click', function(){ EXT.del(it.id); renderList(filter); renderModeBox(); });
          acts.appendChild(delBtn);
        }
        row.appendChild(acts);
        list.appendChild(row);
        list.appendChild(dhost);
      });
      if (!shown) list.appendChild(el('div', { class: 'hint', text: '这一类还没有内容。' }));
    }

    /* ===== 市场（origin/ext/plugins 分支 index.json）+ 三子页签调度 ===== */
    var mktCache = null, mktErr = '', mktOffline = false;
    var MKT_INDEX = 'https://raw.githubusercontent.com/tsgqjxhn/SoloChat/ext/plugins/index.json';
    function ensureMarket(){
      if (mktCache || mktErr) return Promise.resolve();
      var url = window.__SOLOCHAT_MKT_INDEX__ || MKT_INDEX;
      return NET.raw({ url: url, method: 'GET', timeout: 15000 }).then(function(r){
        if (!r || r.status !== 200) throw new Error('HTTP ' + (r && r.status));
        var idx;
        try { idx = JSON.parse(r.text); } catch(e){ throw new Error('index.json 不是合法 JSON'); }
        if (!idx || !idx.plugins) throw new Error('index.json 缺少 plugins');
        mktCache = idx;
      }).then(null, function(e){
        mktErr = (e && e.message) || String(e);
        return fetch('plugins/market.json', { cache: 'no-store' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(cat){
          mktOffline = !!(cat && cat.plugins && cat.plugins.length);
        }).catch(function(){});
      });
    }
    function isInstalled(name){
      var hit = false;
      EXT.all().forEach(function(it){ if (it.pkg === name) hit = true; });
      (S.cfg.prompts || []).forEach(function(pr){ if (pr.pkg === name) hit = true; });
      return hit;
    }
    function drawExt(kind){
      mktExtBox.textContent = '';
      if (mktErr){
        var t = '市场暂不可用：' + mktErr;
        if (mktOffline) t += '（已回退到本机运行时目录，插件 → 市场 可安装 Python 运行时）';
        mktExtBox.appendChild(el('div', { class: 'hint', style: 'color:var(--danger)', text: t }));
        return;
      }
      var idx = mktCache || { plugins: [] }, raw = idx.raw || '', pkgs = idx.plugins || [];
      var key = { agents: 'agents', skills: 'skills', tools: 'tools', prompt: 'prompts' }[kind];
      var shown = pkgs.filter(function(p){
        return kind === 'plugins' ? true : !!(p.items && p.items[key] > 0);
      }).filter(function(p){ return !isInstalled(p.name); });
      if (!shown.length){ mktExtBox.appendChild(el('div', { class: 'hint', text: '这一类没有可安装的扩展包；已安装的请到「已有」查看。' })); return; }
      mktExtBox.appendChild(el('div', { class: 'sub', style: 'margin:0 0 6px', text: '扩展包市场 · origin/ext/plugins' }));
      shown.forEach(function(pkg){ mktExtBox.appendChild(mktCard(pkg, raw)); });
    }
    function mktCard(pkg, raw){
      var card = el('div', { class: 'sub-card' });
      card.appendChild(el('div', { class: 'sc-h' }, [
        el('span', { class: 'sc-name', text: pkg.name + ' ' + (pkg.version || '') }),
        el('span', { class: 'sc-chip', text: '市场' })
      ]));
      card.appendChild(el('div', { class: 'sc-desc', text: pkg.desc || '' }));
      var it = pkg.items || {};
      card.appendChild(el('div', { class: 'sub', style: 'font-size:11px', text:
        '工具 ' + (it.tools||0) + ' · 技能 ' + (it.skills||0) + ' · 智能体 ' + (it.agents||0) + ' · 提示词 ' + (it.prompts||0) }));
      var btn = el('button', { class: 'btn btn-primary rn-mini', text: '安装整包' });
      btn.addEventListener('click', function(){
        if (isInstalled(pkg.name)){ UI.toast('「' + pkg.name + '」已安装；如需重装请到「已有」移除整包', true); return; }
        btn.disabled = true; btn.textContent = '安装中…';
        EXT.installMarket(pkg, raw).then(function(rep){ afterImport(rep); },
          function(e){ btn.disabled = false; btn.textContent = '安装整包'; UI.toast('安装失败：' + (e && e.message || e), true); });
      });
      card.appendChild(el('div', { class: 'f-actions', style: 'margin:0;justify-content:flex-start' }, [btn]));
      return card;
    }
    var mktSeq = 0;
    function renderExtMarket(kind){
      var seq = ++mktSeq;
      mktExtBox.textContent = '';
      mktExtBox.appendChild(el('div', { class: 'hint', text: '正在读取市场索引…' }));
      ensureMarket().then(function(){
        if (seq !== mktSeq || filter !== kind || !accMarket.open) return;
        drawExt(kind);
      }, function(){
        if (seq !== mktSeq || filter !== kind || !accMarket.open) return;
        drawExt(kind);
      });
    }
    function afterImport(rep){
      if (S._pRefresh) S._pRefresh();
      var msg = '导入 ' + rep.added + ' 项' + (rep.prompts ? '，' + rep.prompts + ' 条提示词' : '');
      if (rep.skipped && rep.skipped.length){
        msg += '；跳过 ' + rep.skipped.length + ' 个';
        console.warn('[扩展包] 跳过：\n' + rep.skipped.join('\n'));
      }
      importResult.textContent = msg;
      UI.toast(msg, !!(rep.skipped && rep.skipped.length));
      apply();   /* 刷新本机列表 / 插件包 / 计数 / 市场卡片状态 */
    }
    /* 把既有节点搬进三个折叠面板 body（appendChild 移动，不复制/重建）；mcpBox 仍独立挂在 p 上 */
    localBody.appendChild(modeBox);
    localBody.appendChild(arRow);
    localBody.appendChild(list);
    localBody.appendChild(agentBox);
    localBody.appendChild(promptBox);
    localBody.appendChild(pkgsBox);
    var runtimeLocal = el('div', { class: 'pkg-list' });
    localBody.appendChild(runtimeLocal);
    function renderRuntimeLocal(){
      runtimeLocal.textContent = '';
      if (!NET.bridge.ok){ runtimeLocal.appendChild(el('div', { class: 'hint', text: '运行时接口不可用（需要 exe 宿主版）' })); return; }
      NET.bridge.runtime('list').then(function(arr){
        runtimeLocal.textContent = '';
        arr = arr || [];
        if (!arr.length){ runtimeLocal.appendChild(el('div', { class: 'hint', text: '还没有安装运行时插件；到「插件 → 市场」安装。' })); return; }
        arr.forEach(function(p){
          var card = el('div', { class: 'sub-card' });
          card.appendChild(el('div', { class: 'sc-h' }, [
            el('span', { class: 'sc-name', text: (p.name || p.id || '运行时') + ' ' + (p.version || '') }),
            el('span', { class: 'sc-chip', text: '运行时' })
          ]));
          var loc = p.path || p.dir;
          if (loc) card.appendChild(el('div', { class: 'sc-desc', style: 'font-size:11px;color:var(--muted)', text: '安装路径：' + loc }));
          var rm = el('button', { class: 'btn btn-danger rn-mini', text: '移除' });
          rm.addEventListener('click', function(){
            UI.confirmBox({ title: '移除运行时？', text: '删除 ' + (p.name || p.id) + ' ' + (p.version || '') + ' 的本地文件。', okText: '移除', danger: true }).then(function(ok){
              if (!ok) return;
              rm.disabled = true;
              NET.bridge.runtime('remove', { runtimeId: p.id }).then(function(){
                UI.toast('已移除 ' + (p.name || p.id));
                renderRuntimeLocal(); renderMarket(); renderModeBox();
              }, function(e){ rm.disabled = false; UI.toast('移除失败：' + (e && e.message || e), true); });
            });
          });
          card.appendChild(el('div', { class: 'f-actions', style: 'margin:0;justify-content:flex-start' }, [rm]));
          runtimeLocal.appendChild(card);
        });
      }, function(){
        runtimeLocal.textContent = '';
        runtimeLocal.appendChild(el('div', { class: 'hint', text: '运行时接口不可用（需要 exe 宿主版）' }));
      });
    }
    marketBody.appendChild(marketBox);
    marketBody.appendChild(mktExtBox);
    importBody.appendChild(importRow);
    importBody.appendChild(exportRow);
    importBody.appendChild(dropZone);
    importBody.appendChild(adv);
    importBody.appendChild(importResult);
    function renderSection(key){
      if (key === 'local'){
        var show = function(n, on){ n.style.display = on ? '' : 'none'; };
        show(modeBox, filter === 'agents');
        show(arRow, filter === 'tools');
        show(list, filter === 'skills' || filter === 'tools');
        show(agentBox, filter === 'agents');
        show(promptBox, filter === 'prompt');
        show(pkgsBox, filter === 'plugins');
        show(runtimeLocal, filter === 'plugins');
        renderModeBox(); renderPkgs();
        if (filter === 'plugins') renderRuntimeLocal();
        if (filter === 'agents') renderAgents();
        else if (filter === 'prompt') ensurePrompt();
        else if (filter === 'skills' || filter === 'tools') renderList(filter);
      } else if (key === 'market'){
        marketBox.style.display = (filter === 'plugins') ? '' : 'none';
        renderExtMarket(filter);
        if (filter === 'plugins') renderMarket();
      }
      /* import：不重绘，只保留控件 */
    }
    function updateAccLabels(){
      var n = 0, all = EXT.all();
      if (filter === 'agents') n = SUB.ROLES.length + all.filter(function(x){ return x.kind === 'agent'; }).length;
      else if (filter === 'skills') n = all.filter(function(x){ return x.kind === 'skill'; }).length;
      else if (filter === 'tools') n = all.filter(function(x){ return x.kind === 'tool' || x.kind === 'builtin'; }).length;
      else if (filter === 'prompt') n = (S.cfg.prompts || []).length;
      else if (filter === 'plugins'){
        var seen = {};
        all.concat(S.cfg.prompts || []).forEach(function(x){ if (x && x.pkg) seen[x.pkg] = 1; });
        n = Object.keys(seen).length;
      }
      accLocal._sum.textContent = n > 0 ? ('已有（' + n + '）') : '已有';
    }
    function apply(){
      updateAccLabels();
      renderModeBox(); renderPkgs();
      if (filter === 'plugins') renderRuntimeLocal();
      if (filter === 'agents') renderAgents();
      else if (filter === 'prompt') ensurePrompt();
      else if (filter === 'skills' || filter === 'tools') renderList(filter);
    }
    function setFilter(k){
      filter = k;
      var isMcp = (k === 'mcp');
      accBox.style.display = isMcp ? 'none' : '';
      mcpBox.style.display = isMcp ? '' : 'none';
      accLocal.open = accMarket.open = accImport.open = false;
      mktExtBox.textContent = '';
      updateAccLabels();
      if (isMcp) renderMcp();
    }
    p._setFilter = setFilter;
    setFilter('agents');
  });

  page('memory', '记忆', function(p){
    var ck = el('input', { type: 'checkbox' }); ck.checked = S.cfg.memory !== false;
    ck.addEventListener('change', function(){ setCfg({ memory: ck.checked }); UI.toast(ck.checked ? '已开启记忆注入' : '已关闭记忆注入'); });
    p.appendChild(el('div', { class: 'f-row' }, [el('label', {}, [ck, ' 发送时注入「本会话目标 + 已产出文件」（只注入，不修改对话）'])]));
  p.appendChild(el('div', { class: 'hint', text: 'v1.29.7 起只注入本会话内容；下方历史卡片仅作留档与清理，不再进入提示词。' }));
    var q = el('input', { class: 'f-in', placeholder: '搜索记忆…' });
    var list = el('div', { class: 'f-grid' });
    p.appendChild(el('div', { style: 'margin:10px 0 6px' }, [q]));
    p.appendChild(list);
    function render(arr){
      list.textContent = '';
      if (!arr.length){ list.appendChild(el('div', { class: 'hint', text: '还没有记忆。做点带产物的任务就会自动记。' })); return; }
      arr.forEach(function(m){
        var del = el('button', { class: 'btn btn-ghost rn-mini', text: '删除' });
        del.addEventListener('click', function(){ MEM.del(m.id).then(function(){ return MEM.search(q.value.trim()); }).then(render); });
        list.appendChild(el('div', { class: 'sub-card' }, [
          el('div', { class: 'sc-h' }, [el('span', { class: 'sc-name', text: (m.goal || '').slice(0, 60) }),
            el('span', { class: 'sc-chip', text: m.status === 'fail' ? '失败' : '成功' }),
            el('span', { class: 'sc-chip', text: new Date(m.ts).toLocaleDateString() }), del]),
          el('div', { class: 'sc-desc', text: (m.artifacts || []).length ? '产物：' + m.artifacts.join('、') : '（无产物）' })
        ]));
      });
    }
    var clr = el('button', { class: 'btn btn-danger', text: '清空全部记忆' });
    clr.addEventListener('click', function(){
      UI.confirmBox({ title: '清空记忆？', text: '所有情景记忆会删除，不可恢复。', okText: '清空', danger: true }).then(function(ok){
        if (!ok) return; MEM.clear().then(function(){ render([]); UI.toast('已清空'); });
      });
    });
    p.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [clr]));
    q.addEventListener('input', function(){ MEM.search(q.value.trim()).then(render); });
    MEM.all().then(render);
  });

  page('about', '关于', function(p){
      var ver = APP_VER, ua = navigator.userAgent || '';
      var wv = /Edg\/([\d.]+)/.exec(ua) || /Chrome\/([\d.]+)/.exec(ua);
      p.appendChild(el('div', { class: 'kv' }, [el('span', { text: '版本' }), el('b', { text: ver })]));
      p.appendChild(el('div', { class: 'kv' }, [el('span', { text: '运行环境' }), el('b', { text: NET.bridge.ok ? '桌面宿主（WebView2）' : '浏览器' })]));
      p.appendChild(el('div', { class: 'kv' }, [el('span', { text: '渲染引擎' }), el('b', { text: wv ? ('Chromium ' + wv[1]) : '未知' })]));
      p.appendChild(el('div', { class: 'kv' }, [el('span', { text: '单文件大小' }), el('b', { text: '≈' + Math.round((document.documentElement.outerHTML.length) / 1024) + ' KB' })]));
      p.appendChild(el('div', { class: 'hint', text: '单文件本地 AI 客户端：不联网存储、无第三方运行时依赖；密钥存在宿主侧 DPAPI 保险库，快照导出会自动剔除。' }));
      p.appendChild(el('div', { class: 'f-actions', style: 'justify-content:flex-start' }, [
        el('button', { class: 'btn btn-sec', 'data-m': 'self-check' }, [icon('check'), '连接自检']),
        el('button', { class: 'btn btn-sec', 'data-m': 'diag', text: '导出诊断包' }),
        el('button', { class: 'btn btn-sec', 'data-m': 'open-data', text: '打开数据目录' })
      ]));
    });

    /* 底部完成条 */
    wrap.appendChild(el('div', { class: 'set-foot' }, [
      el('button', { class: 'btn btn-primary', 'data-m': 'close', text: '完成' })
    ]));
  /* v0.3.91：导航顺序按用户要求重排；「数据与维护」并入「关于」 */
  (function(){
    var pgs0 = body.querySelectorAll('.set-page');
    var order = ['general', 'conn', 'ext', 'keys', 'about'];
    var gpage = null, mpage = null;
    for (var gi = 0; gi < pgs0.length; gi++){
      if (pgs0[gi].getAttribute('data-page') === 'general') gpage = pgs0[gi];
      if (pgs0[gi].getAttribute('data-page') === 'memory') mpage = pgs0[gi];
    }
    if (mpage && gpage){
      gpage.appendChild(el('div', { class: 'sub', style: 'margin-top:22px', text: '记忆（全部为会话内，不跨会话）' }));
      while (mpage.firstChild) gpage.appendChild(mpage.firstChild);
      mpage.remove();
    }
    var btns = {};
    var navBtns = nav.querySelectorAll('button[data-sp]');
    for (var bi = 0; bi < navBtns.length; bi++) btns[navBtns[bi].getAttribute('data-sp')] = navBtns[bi];
    if (btns.memory) btns.memory.remove();
    if (btns.data) btns.data.remove();
    order.forEach(function(id){ if (btns[id]) nav.appendChild(btns[id]); });
    var dpage = null, apage = null;
    var pgs = body.querySelectorAll('.set-page');
    for (var pi = 0; pi < pgs.length; pi++){
      if (pgs[pi].getAttribute('data-page') === 'data') dpage = pgs[pi];
      if (pgs[pi].getAttribute('data-page') === 'about') apage = pgs[pi];
    }
    if (dpage && apage){
      apage.appendChild(el('div', { class: 'sub', style: 'margin-top:22px', text: '数据与维护' }));
      while (dpage.firstChild) apage.appendChild(dpage.firstChild);
      dpage.remove();
    }
    if (btns.data) btns.data.remove();
  })();
    return wrap;
  }
  function refreshFsRoots(){
    var n = $('#fs-roots'); if (!n) return;
    if (!NET.bridge.ok && !NET.isMock()){ n.textContent = '（需在 SoloChat 宿主内使用）'; return; }
    NET.fs('roots').then(function(r){
      n.textContent = '';
      var roots = (r && r.roots) || [];
      if (!roots.length){ n.appendChild(el('div', { text: '（未添加——通过输入区「工作区」按钮或下方按钮添加）' })); return; }
      for (var i = 0; i < roots.length; i++){
        (function(p){
          n.appendChild(el('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:4px' }, [
            el('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);font-size:12px', text: p }),
            el('button', { class: 'btn btn-danger', 'data-m': 'fs-rmroot', 'data-path': p, text: '移除' })
          ]));
        })(roots[i]);
      }
    }, function(err){ n.textContent = '（不可用：' + (err && err.message || '未知') + '）'; });
  }
  /* v0.6.4：重建设置时保留展开状态/当前页/滚动位置（切换配置组不再全部折叠） */
  function openSettings(){
    var keep = null, m0 = $('#modal');
    if (m0 && m0.classList.contains('show')){
      keep = { accs: [], page: '', scroll: 0 };
      var os = m0.querySelectorAll('.acc.open');
      for (var i = 0; i < os.length; i++){
        var h = os[i].querySelector('.acc-head');
        if (h) keep.accs.push(String(h.textContent || '').trim());
      }
      var pg0 = m0.querySelector('.set-page.on');
      if (pg0) keep.page = pg0.getAttribute('data-page') || '';
      var sb0 = m0.querySelector('.set-body');
      if (sb0) keep.scroll = sb0.scrollTop || 0;
    }
    openModal(buildSettings(), true);
    if (!keep) return;
    var m = $('#modal');
    if (!m) return;
    if (keep.accs.length){
      var as = m.querySelectorAll('.acc');
      for (var j = 0; j < as.length; j++){
        var h2 = as[j].querySelector('.acc-head');
        if (h2 && keep.accs.indexOf(String(h2.textContent || '').trim()) >= 0) as[j].classList.add('open');
      }
    }
    if (keep.page){
      var pgs = m.querySelectorAll('.set-page'), nbs = m.querySelectorAll('button[data-sp]');
      for (var k = 0; k < pgs.length; k++) pgs[k].classList.toggle('on', pgs[k].getAttribute('data-page') === keep.page);
      for (var n = 0; n < nbs.length; n++) nbs[n].classList.toggle('on', nbs[n].getAttribute('data-sp') === keep.page);
    }
    var sb = m.querySelector('.set-body');
    if (sb && keep.scroll) sb.scrollTop = keep.scroll;
  }

  /* 侧栏会话列表 */
  function ago(ts){
    var d = Date.now() - (ts || 0);
    if (d < 6e4) return '刚刚';
    if (d < 36e5) return Math.floor(d / 6e4) + '分钟';
    if (d < 864e5) return Math.floor(d / 36e5) + '小时';
    return Math.floor(d / 864e5) + '天';
  }
  /* 侧栏：会话+项目组混排 */
  function renderSessions(){
    var q = ($('#sb-q').value || '').trim().toLowerCase();
    $list.textContent = '';
    var frag = document.createDocumentFragment();
    var pins = [], units = [], byWs = {};
    /* session groups v0.4.2：先登记分组，组内会话单独收集 */
    var gs = Array.isArray(S.cfg.groups) ? S.cfg.groups : [], byG = {}, gMeta = {};
    for (var gi = 0; gi < gs.length; gi++){
      var gg = gs[gi]; if (!gg || !gg.id) continue;
      byG[gg.id] = []; gMeta[gg.id] = gg;
    }
    for (var i = 0; i < S.sessions.length; i++){
      var s = S.sessions[i];
      if (s.temp) continue; /* v2.8：临时会话不进历史列表 */
      var sg = (s.groupId && byG[s.groupId]) ? gMeta[s.groupId] : null;
      var hit = !q || (s.title || '').toLowerCase().indexOf(q) >= 0
        || (s.workspace || '').toLowerCase().indexOf(q) >= 0
        || (sg && (sg.name || '').toLowerCase().indexOf(q) >= 0); // 组名命中→该组会话都显示
      if (!hit) continue;
      if (sg){ byG[sg.id].push(s); }
      else if (s.workspace) (byWs[s.workspace] || (byWs[s.workspace] = [])).push(s);
      else (s.pinned ? pins : units).push({ t: s.updatedAt, s: s });
    }
    for (var ws in byWs){
      var arr = byWs[ws], mt = 0;
      for (var k = 0; k < arr.length; k++) if (arr[k].updatedAt > mt) mt = arr[k].updatedAt;
      arr.sort(function(a, b){
        if (!!b.pinned !== !!a.pinned) return b.pinned - a.pinned; // 项目内置顶优先
        return b.updatedAt - a.updatedAt;
      });
      units.push({ t: mt, ws: ws, arr: arr, pin: !!(S.cfg.pinnedWs || {})[ws] });
    }
    /* session groups v0.4.2：分组单元插进 units，与会话/项目一起按 updatedAt 排序 */
    for (var gid in byG){
      var garr = byG[gid], gmt = 0;
      for (var gk = 0; gk < garr.length; gk++) if (garr[gk].updatedAt > gmt) gmt = garr[gk].updatedAt;
      garr.sort(function(a, b){
        if (!!b.pinned !== !!a.pinned) return b.pinned - a.pinned;
        return b.updatedAt - a.updatedAt;
      });
      var gmm = gMeta[gid];
      var gNameHit = !q || (gmm.name || '').toLowerCase().indexOf(q) >= 0;
      if (!q || gNameHit || garr.length) // 空组也显示（允许先建空组），组头显示 0
        units.push({ t: gmt || gmm.updatedAt || gmm.createdAt || 0, g: gmm, arr: garr });
    }
    units.sort(function(a, b){ return b.t - a.t; });
    /* v3.0 #21：手动拖拽顺序优先（未拖过的按时间） */
    if (S.cfg.order){
      var om = S.cfg.order, ordered = [], rest = [], q;
      for (q = 0; q < units.length; q++){
        var uu = units[q];
        if (uu.s && om[uu.s.id] != null) ordered.push(uu); else rest.push(uu);
      }
      ordered.sort(function(a, b){ return om[a.s.id] - om[b.s.id]; });
      units.length = 0;
      for (q = 0; q < ordered.length; q++) units.push(ordered[q]);
      for (q = 0; q < rest.length; q++) units.push(rest[q]);
    }
    for (var ui = units.length - 1; ui >= 0; ui--)
      if (units[ui].ws && units[ui].pin) pins.push(units.splice(ui, 1)[0]); // 置顶项目并入置顶组
    pins.sort(function(a, b){ return b.t - a.t; });
    function group(label, arr){
      if (!arr.length) return;
      if (label) frag.appendChild(el('div', { class: 'ss-group', text: label }));
      for (var i = 0; i < arr.length; i++){
        var u = arr[i];
        if (u.s){ frag.appendChild(sessionNode(u.s)); continue; }
        /* session groups v0.4.2：分组头 + 组内会话（子会话仍显示时间） */
        if (u.g){
          var gd = u.g, gclosed = !!(S.cfg.gClosed || {})[gd.id];
          var gmode = (gd.mode === 'work') ? 'Work' : 'Chat';
          var gmodel = gd.model ? modelLabel(gd.model) : '跟随全局';
          frag.appendChild(el('div', {
            class: 'ss-proj' + (gclosed ? ' closed' : ''),
            'data-gid': gd.id,
            title: (gd.name || '分组') + '（' + gmode + ' · ' + gmodel + '）'
          }, [
            icon('down', 'chev'), icon('folder'),
            el('span', { class: 'nm', text: gd.name || '未命名分组' }),
            el('span', { class: 'gnum', text: String((u.arr || []).length) }),
            el('span', { class: 'chip', text: gmode + ' · ' + gmodel }),
            el('button', { class: 'add', 'data-gnew': '1', title: '在分组内新建会话' }, [icon('plus')]),
            el('button', { class: 'pinb', 'data-gcfg': '1', title: '分组设置' }, [icon('gear')]),
            el('button', { class: 'delb', 'data-gdel': '1', title: '删除分组（会话保留为未分组）' }, [icon('trash')])
          ]));
          if (!gclosed) for (var gj2 = 0; gj2 < (u.arr || []).length; gj2++)
            frag.appendChild(sessionNode(u.arr[gj2], true));
          continue;
        }
        var closed = !!(S.cfg.wsClosed || {})[u.ws];
        var nm = u.ws.split(/[\\/]/).filter(Boolean).pop() || u.ws;
        frag.appendChild(el('div', { class: 'ss-proj' + (closed ? ' closed' : '') + (u.pin ? ' pinned' : ''), 'data-pws': u.ws, title: u.ws }, [
          icon('down', 'chev'),
          icon('folder'),
          el('span', { class: 'nm', text: nm }),
          el('button', { class: 'pinb' + (u.pin ? ' on' : ''), 'data-ppin': '1', title: u.pin ? '取消置顶' : '置顶项目' }, [icon('pin')]),
          el('button', { class: 'add', 'data-pnew': '1', title: '新建任务（Agent+本文件夹）' }, [icon('plus')]),
          el('button', { class: 'delb', 'data-pdel': '1', title: '删除项目（含全部任务）' }, [icon('trash')])
        ]));
        if (!closed) for (var j = 0; j < u.arr.length; j++) frag.appendChild(sessionNode(u.arr[j], true));
      }
    }
    group(pins.length ? '置顶' : null, pins);
    /* v3.0 #21：无项目分组时，普通会话按「今天/昨天/本周/更早」分桶 */
    (function(){
      var hasProj = false;
      for (var i = 0; i < units.length; i++) if (units[i].ws || units[i].g){ hasProj = true; break; }
      if (S.cfg.groupSessions !== false && !hasProj && units.length > 1){
        var d0 = new Date(); d0.setHours(0, 0, 0, 0);
        var t0 = d0.getTime(), day = 864e5;
        var buckets = [['今天', [], 0], ['昨天', [], 0], ['本周', [], 0], ['更早', [], 0]];
        for (var j = 0; j < units.length; j++){
          var ts = units[j].t || 0;
          var bi = ts >= t0 ? 0 : ts >= t0 - day ? 1 : ts >= t0 - 7 * day ? 2 : 3;
          buckets[bi][1].push(units[j]); buckets[bi][2] = 1;
        }
        for (var k = 0; k < buckets.length; k++)
          if (buckets[k][2]) group(buckets[k][0], buckets[k][1]);
      } else {
        group(pins.length && units.length ? '会话' : null, units);
      }
    })();
    $list.appendChild(frag);
    wireDrag();
  }
  /* #21 拖拽排序：拖完把当前可见普通会话顺序写成 cfg.order，之后按它排 */
  function wireDrag(){
    var items = $list.querySelectorAll('.ss-item:not(.sub)');
    for (var i = 0; i < items.length; i++){
      (function(it){
        it.setAttribute('draggable', 'true');
        it.addEventListener('dragstart', function(e){
          S._dragSid = it.getAttribute('data-sid');
          try { e.dataTransfer.setData('text/plain', S._dragSid); } catch (x) {}
        });
        it.addEventListener('dragover', function(e){ e.preventDefault(); it.classList.add('drag-over'); });
        it.addEventListener('dragleave', function(){ it.classList.remove('drag-over'); });
        it.addEventListener('drop', function(e){
          e.preventDefault(); it.classList.remove('drag-over');
          var from = S._dragSid, to = it.getAttribute('data-sid');
          if (!from || !to || from === to) return;
          var order = [], nodes = $list.querySelectorAll('.ss-item:not(.sub)');
          for (var j = 0; j < nodes.length; j++) order.push(nodes[j].getAttribute('data-sid'));
          var fi = order.indexOf(from), ti = order.indexOf(to);
          if (fi < 0 || ti < 0) return;
          order.splice(fi, 1);
          var ni = order.indexOf(to);                      /* 移除后重新定位，避免下标漂移 */
          order.splice(fi < ti ? ni + 1 : ni, 0, from);    /* 向下拖插到目标之后，向上拖插到之前 */
          var map = {};
          order.forEach(function(sid, n){ map[sid] = n; });
          setCfg({ order: map });
          renderSessions();
        });
      })(items[i]);
    }
  }
  function sessionNode(s, sub){
    var kids = [
      el('span', { class: 'pin' }, [icon('pin')]),
      el('span', { class: 't', text: s.title || '未命名会话' })
    ];
    if (sub) kids.push(el('span', { class: 'tm', text: ago(s.updatedAt) }));
    kids.push(el('span', { class: 'acts' }, [
      el('button', { 'data-act': 'pin', title: s.pinned ? '取消置顶' : '置顶' }, [icon('pin')]),
      el('button', { 'data-act': 'rename', title: '重命名' }, [icon('edit')]),
      el('button', { 'data-act': 'del', title: '删除' }, [icon('trash')])
    ]));
    return el('div', {
      class: 'ss-item' + (sub ? ' sub' : '') + (s.id === S.sid ? ' active' : '') + (s.pinned ? ' pinned' : ''),
      'data-sid': s.id, role: 'option', title: s.title || ''
    }, kids);
  }
  function renameInline(item, s){
    var t = item.querySelector('.t');
    var input = el('input', { class: 'f-in', value: s.title || '', style: 'height:26px;padding:2px 6px;font-size:13px' });
    item.replaceChild(input, t);
    input.focus(); input.select();
    function done(save){
      if (save){
        s.title = input.value.trim().slice(0, 40) || s.title;
        DB.putSession(s);
      }
      renderSessions();
      if (save && s.id === S.sid) $title.textContent = s.title;
    }
    input.addEventListener('keydown', function(e){
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', function(){ done(true); });
    input.addEventListener('click', function(e){ e.stopPropagation(); });
  }

  /* ===== session groups v0.4.2：弹层下拉构造 ===== */
  function modelSelect(cur, emptyLabel){
    var sel = el('select', { class: 'f-in' });
    sel.appendChild(el('option', { value: '', text: emptyLabel || '跟随分组 / 全局' }));
    var pool = (Array.isArray(S.cfg.models) ? S.cfg.models : []).slice();
    if (cur && pool.indexOf(cur) < 0) pool.unshift(cur); // 当前值不在池里补一个选项
    for (var i = 0; i < pool.length; i++)
      sel.appendChild(el('option', { value: pool[i], text: modelLabel(pool[i]) }));
    sel.value = cur || '';
    return sel;
  }
  function groupSelect(cur){
    var sel = el('select', { class: 'f-in' });
    sel.appendChild(el('option', { value: '', text: '无分组' }));
    var gs = Array.isArray(S.cfg.groups) ? S.cfg.groups : [];
    for (var i = 0; i < gs.length; i++)
      if (gs[i] && gs[i].id) sel.appendChild(el('option', { value: gs[i].id, text: gs[i].name || '未命名分组' }));
    sel.value = cur || '';
    return sel;
  }
  function modeSelect(cur, allowEmpty){
    var sel = el('select', { class: 'f-in' });
    if (allowEmpty) sel.appendChild(el('option', { value: '', text: '跟随分组 / 全局' }));
    sel.appendChild(el('option', { value: 'chat', text: 'Chat' }));
    sel.appendChild(el('option', { value: 'work', text: 'Work' }));
    if (cur && cur !== 'chat' && cur !== 'work') // 兼容旧的 agent 会话，避免显示空白
      sel.appendChild(el('option', { value: cur, text: cur === 'agent' ? 'Agent' : cur }));
    sel.value = cur || (allowEmpty ? '' : 'chat');
    return sel;
  }
  /* 分组设置弹层（新建/编辑）：点「保存」一次性写入 cfg.groups，不复制进会话 */
  function groupDlg(gid){
    var edit = !!gid, g = edit ? groupById(gid) : null;
    if (edit && !g) return;
    var now = Date.now();
    var d = g || { name: '新分组', mode: 'chat', model: '', systemPrompt: '', temperature: '', maxTokens: '' };
    var fName = el('input', { class: 'f-in', type: 'text', value: d.name || '', placeholder: '新分组' });
    var fMode = modeSelect(d.mode || 'chat', false);
    var fModel = modelSelect(d.model || '', '跟随全局');
    var fTemp = el('input', { class: 'f-in', type: 'number', step: '0.1', min: '0', max: '2',
      value: (d.temperature === '' || d.temperature == null) ? '' : d.temperature, placeholder: '跟随全局' });
    var fMax = el('input', { class: 'f-in', type: 'number', min: '0', step: '1',
      value: (d.maxTokens === '' || d.maxTokens == null) ? '' : d.maxTokens, placeholder: '跟随全局（0/留空=不限）' });
    var fSp = el('textarea', { text: d.systemPrompt || '', placeholder: '留空=跟随全局 System Prompt' });
    function save(){
      var nm = (fName.value || '').trim().slice(0, 40) || '新分组';
      var traw = fTemp.value === '' ? '' : parseFloat(fTemp.value);
      if (isNaN(traw)) traw = '';                        // 不存 NaN
      var mraw = fMax.value === '' ? '' : parseInt(fMax.value, 10);
      if (isNaN(mraw) || mraw <= 0) mraw = '';          // 0/留空=不限制
      var obj = { id: edit ? g.id : ('g' + Date.now().toString(36)), name: nm,
        mode: fMode.value === 'work' ? 'work' : 'chat', model: fModel.value || '',
        systemPrompt: fSp.value || '',
        temperature: traw === '' ? '' : clamp(traw, 0, 2), maxTokens: mraw === '' ? '' : mraw,
        createdAt: edit ? (g.createdAt || now) : now, updatedAt: now };
      var arr = (Array.isArray(S.cfg.groups) ? S.cfg.groups : []).slice();
      if (edit){ for (var i = 0; i < arr.length; i++) if (arr[i].id === g.id){ arr[i] = obj; break; } }
      else arr.push(obj);
      setCfg({ groups: arr });
      renderSessions(); renderComposerCtl();
      closeModal();
      toast(edit ? ('已保存分组：' + nm) : ('已新建分组：' + nm));
    }
    S._grpSave = save;
    S._grpDel = function(){ delGroup(gid); };
    var acts = [];
    if (edit) acts.push(el('button', { class: 'btn btn-danger', 'data-m': 'grp-del', text: '删除分组' }));
    acts.push(el('button', { class: 'btn btn-sec', 'data-m': 'close', text: '取消' }));
    acts.push(el('button', { class: 'btn btn-primary', 'data-m': 'grp-save', text: '保存' }));
    openModal(el('div', {}, [
      el('h2', { text: edit ? ('分组设置 · ' + (g.name || '')) : '新建分组' }),
      el('div', { class: 'f-grid' }, [
        field('名称', fName, '必填'), field('模式', fMode),
        field('模型', fModel, '留空=组内会话跟随全局模型'),
        field('temperature', fTemp, '留空=跟随全局'),
        field('max_tokens', fMax, '留空/0=不限制')
      ]),
      field('System Prompt', fSp, '留空=跟随全局 System Prompt'),
      el('div', { class: 'sub', text: '组内未单独覆盖的会话会自动跟随；已单独设置的会话不受影响。' }),
      el('div', { class: 'f-actions' }, acts)
    ]));
  }
  /* 删除分组：组内会话不删，只清空 groupId → 变为未分组 */
  function delGroup(gid){
    var g = groupById(gid);
    if (!g) return;
    confirmBox({ title: '删除分组', text: '删除分组「' + (g.name || '') + '」？组内会话不会删除，会变成「未分组」。', okText: '删除', danger: true })
      .then(function(ok){
        if (!ok) return;
        var arr = (Array.isArray(S.cfg.groups) ? S.cfg.groups : []).filter(function(x){ return x && x.id !== gid; });
        setCfg({ groups: arr });
        var cm = S.cfg.gClosed || {}; if (cm[gid]) delete cm[gid];
        for (var i = 0; i < S.sessions.length; i++)
          if (S.sessions[i].groupId === gid){ S.sessions[i].groupId = ''; DB.putSession(S.sessions[i]); }
        saveCfg(); renderSessions(); renderComposerCtl();
        toast('已删除分组：会话保留为未分组');
      });
  }
  /* 分组头「+」：预选分组 + 组模式，展开分组，新建草稿 */
  function newFromGroup(gid){
    var g = groupById(gid);
    if (!g){ toast('分组不存在', true); return; }
    setCfg({ mode: g.mode || 'chat' });
    var cm = S.cfg.gClosed || (S.cfg.gClosed = {});
    if (cm[gid]) delete cm[gid];
    newDraft(gid);
    saveCfg();
    toast('已新建分组会话：' + (g.name || ''));
  }
  /* 会话参数弹层：会话态(有 s) 与「发送前草稿态」(s===null) 共用一套控件。
     草稿态写 S.draftCfg，不创建会话、不写 DB；发送首条消息时由 createSession 应用。 */
  function sessCfgDlg(s){
    var isDraft = !s;
    var d = isDraft ? (S.draftCfg || (S.draftCfg = mkDraftCfg())) : s;
    var pp = d.params || (d.params = {});
    function mark(node, key){
      node.setAttribute('data-sess', key);
      if (isDraft) node.setAttribute('data-draft', '1'); else node.setAttribute('data-sid', s.id);
      return node;
    }
    var fGroup = mark(groupSelect(d.groupId || ''), 'groupId');
    var fMode = mark(modeSelect(d.mode || '', isDraft), 'mode');
    var fModel = mark(modelSelect(d.model || '', '跟随分组 / 全局'), 'model');
    var fTemp = mark(el('input', { class: 'f-in', type: 'number', step: '0.1',
      value: pp.temperature != null ? pp.temperature : '', placeholder: '跟随全局' }), 'temperature');
    var fMax = mark(el('input', { class: 'f-in', type: 'number',
      value: pp.maxTokens != null ? pp.maxTokens : '', placeholder: '跟随全局（0=不限）' }), 'maxTokens');
    var fSp = mark(el('textarea', { text: d.systemPrompt || '' }), 'systemPrompt');
    openModal(el('div', {}, [
      el('h2', { text: isDraft ? '会话参数 · 新会话（发送前）' : ('会话参数 · ' + (s.title || '未命名')) }),
      el('div', { class: 'f-grid' }, [
        field('所属分组', fGroup), field('模式', fMode),
        field('模型', fModel, '空=跟随分组 / 全局；会话值优先')
      ]),
      el('div', { class: 'f-grid' }, [
        field('temperature', fTemp, '0~2；留空=跟随'),
        field('max_tokens', fMax, '0/留空=不限制（不传）')
      ]),
      field('System Prompt', fSp, '留空=跟随分组 / 全局 System Prompt'),
      el('div', { class: 'sub', text: isDraft ? '发送第一条消息时应用；组内未单独覆盖的会话会自动跟随分组设置。' : '会话值优先于分组，分组优先于全局。' }),
      el('div', { class: 'f-actions' }, [
        el('button', { class: 'btn btn-primary', 'data-m': 'close', text: '完成' })
      ])
    ]));
  }

  /* 消息列表：窗口化渲染仅留 50 条 */
  function renderMsgs(){
    revokePreviews(); // 重建前释放旧预览 URL（§5.2.1 成对）
    var wrap = $('#msg-list');
    wrap.textContent = '';
    var total = S.msgs.length;
    var start = Math.max(0, total - S.windowSize);
    if (start > 0)
      wrap.appendChild(el('button', { id: 'load-earlier', class: 'btn btn-sec', 'data-act': 'earlier',
        text: '加载更早（还有 ' + start + ' 条）' }));
    var frag = document.createDocumentFragment();
    for (var i = start; i < total; i++) if (!S.msgs[i].hidden) frag.appendChild(msgNode(S.msgs[i]));
    wrap.appendChild(frag);
    updateEmpty();
    FS.hydrateAll(); // 重建后重新填充写卡片差异（v1.1）
    maybeScroll(false); // v2.1：重渲染也尊重用户滚动位置（切会话/新草稿前会显式置 follow=true）
  try { if (UI.FIND && UI.FIND.isOpen()) UI.FIND.rescan(); } catch (e) {} // v0.3.22：重渲染后高亮节点丢了，查找要重新扫一遍
  }
  /* v2.4：只重建单条消息节点（替代整列表 renderMsgs）——工具循环里频繁改一条消息时不再重排整个列表 */
  function repaintMsg(id){
    var i = findMsg(id); if (i < 0) return;
    var old = $listNode(id); if (!old || !old.parentNode) return;
    var fresh = msgNode(S.msgs[i]);
    old.parentNode.replaceChild(fresh, old);
    var st = S.streams[S.sid];
    if (st && st.msg && st.msg.id === id) bindStreamDOM(st); // 正在流式 → 重新绑定节点
  try { if (UI.FIND && UI.FIND.isOpen()) UI.FIND.rescan(); } catch (e) {} // v0.3.25：局部重绘也会丢高亮
  }
  /* v2.4：追加单条消息节点（不改动其它已渲染节点，避免图片重载与滚动抖动） */
  function appendMsgNode(m){
    $('#msg-list').appendChild(msgNode(m));
    updateEmpty();
  }
  /* v0.2.1：工具卡片 —— 「运行 js / 写入 x.mjs / 抓取 URL / 搜索 q」一行一条，点开才看原始输出 */
  var TOOL_LABEL = { run: '运行', write: '写入', patch: '打补丁', list: '列目录', preview: '预览', web: '抓取', search: '搜索', play: '播放', download: '下载', get: '抓取', read: '读取' };
  function toolEvents(m){
    if (m.tools && m.tools.length) return m.tools;
    var out = [], lines = String(m.content || '').split('\n');
    for (var i = 0; i < lines.length; i++){
      var l = lines[i], a, b;
      if ((a = /^\[run-result\]\s*(\S+)\s*(成功|失败)（(\d+)ms/.exec(l)))
        out.push({ op: 'run', kind: a[1], ok: a[2] === '成功', ms: +a[3] });
      else if ((b = /^\[vfs\]\s*已(写入|打补丁)\s*(\S+?)（([^）]+)）/.exec(l)))
        out.push({ op: b[1] === '写入' ? 'write' : 'patch', path: b[2], size: b[3], ok: true });
      else if ((b = /^\[vfs\]\s*(写入失败|打补丁失败)：(.+)$/.exec(l)))
        out.push({ op: 'write', ok: false, brief: b[2] });
      else if ((b = /^\[web\]\s*(https?:\/\/\S+?)（成功，(\d+)\s*字/.exec(l)))
        out.push({ op: 'web', url: b[1], len: +b[2], ok: true });
      else if ((b = /^\[web\]\s*(抓取失败|地址无效)[：:]?(.*)$/.exec(l)))
        out.push({ op: 'web', ok: false, brief: (b[2] || b[1]).slice(0, 60) });
      else if ((b = /^\[search\]\s*(.+?)（(\d+)\s*条/.exec(l)))
        out.push({ op: 'search', q: b[1], n: +b[2], ok: true });
      else if ((b = /^\[get\]\s*已保存：(.+?)（([^）]*)）/.exec(l)))
        out.push({ op: 'get', path: b[1], size: b[2], ok: true });
      else if ((b = /^\[download\]\s*已保存：(.+?)（([^）]*)）/.exec(l)))
        out.push({ op: 'download', path: b[1], size: b[2], ok: true });
      else if ((b = /^\[play\]\s*已在播放窗口打开：(.+)$/.exec(l)))
        out.push({ op: 'play', url: b[1], ok: true });
      else if ((b = /^\[preview\]\s*已在运行面板打开：(.+)$/.exec(l)))
        out.push({ op: 'preview', path: b[1], ok: true });
      else if ((b = /^\[vfs\]\s*工作区文件（(\d+) 项）/.exec(l)))
        out.push({ op: 'list', n: +b[1], ok: true });
    }
    return out;
  }
  function renderToolBody(m){
    var frag = document.createDocumentFragment();
    var evs = toolEvents(m);
    if (evs.length){
      var card = el('div', { class: 'tc' });
      /* v0.9.6：同名工具连续 ≥3 次合并成一行（op ×N），避免几十行刷屏 */
      var evs2 = [];
      for (var gj = 0; gj < evs.length; gj++){
        var cur = evs[gj], prev = evs2[evs2.length - 1];
        if (prev && prev.op === cur.op && (prev.grp || 1) < 999){
          if (prev.grp){ prev.grp++; prev.okN = (prev.okN || 1) + (cur.ok === false ? 0 : 1); prev.badN = (prev.badN || 0) + (cur.ok === false ? 1 : 0); if (cur.ms != null){ prev.mn = Math.min(prev.mn == null ? cur.ms : prev.mn, cur.ms); prev.mx = Math.max(prev.mx == null ? cur.ms : prev.mx, cur.ms); } continue; }
          if (gj + 1 < evs.length && evs[gj + 1].op === cur.op){
            var g0 = { op: cur.op, grp: 2, okN: (cur.ok === false ? 0 : 1) + (prev.ok === false ? 0 : 1), badN: (cur.ok === false ? 1 : 0) + (prev.ok === false ? 1 : 0), mn: (prev.ms == null ? cur.ms : (cur.ms == null ? prev.ms : Math.min(prev.ms, cur.ms))), mx: (prev.ms == null ? cur.ms : (cur.ms == null ? prev.ms : Math.max(prev.ms, cur.ms))) };
            evs2[evs2.length - 1] = g0; continue;
          }
        }
        evs2.push(cur);
      }
      for (var i = 0; i < evs2.length; i++){
        var e = evs2[i];
        var label = (TOOL_LABEL[e.op] || e.op) + (e.kind ? ' ' + e.kind : '') + (e.grp ? ' ×' + e.grp : '');
        var brief = e.path || e.url || (e.q ? '“' + e.q + '”' : '') || e.brief || '';
        if (e.size) brief += ' · ' + e.size;
        if (e.len) brief += ' · ' + e.len + ' 字';
        if (e.n != null && e.op === 'search') brief += ' · ' + e.n + ' 条';
        if (e.n != null && e.op === 'list') brief += ' · ' + e.n + ' 项';
        var cells = [el('span', { class: 'tc-op', text: label }),
          el('span', { class: e.grp ? (e.badN ? 'tc-bad' : 'tc-ok') : (e.ok === false ? 'tc-bad' : 'tc-ok'),
                       text: e.grp ? (e.badN ? (e.badN + ' 失败 / ' + e.okN + ' 完成') : '全部完成') : (e.ok === false ? '失败' : '完成') })];
        if (e.grp){ if (e.mx != null) cells.push(el('span', { class: 'tc-meta', text: (e.mn === e.mx ? e.mn : e.mn + '~' + e.mx) + 'ms' })); }
        else if (e.ms != null) cells.push(el('span', { class: 'tc-meta', text: e.ms + 'ms' }));
        if (brief) cells.push(el('span', { class: 'tc-brief', text: brief, title: brief }));
        if (e.op === 'download' && e.path) cells.push(el('button', { class: 'tc-btn', type: 'button', 'data-reveal': e.path, text: '打开文件夹' }));
        card.appendChild(el('div', { class: 'tc-row' }, cells));
      }
      frag.appendChild(card);
    }
    var raw = String(m.content || '').replace(/^\[(fs|run)-result\]\s*/, '');
    var det = el('details', { class: 'tc-raw' });
    det.appendChild(el('summary', { text: (evs.length ? '详细输出' : '工具输出') + '（' + raw.length + ' 字）' }));
    var pre = el('pre');
    pre.textContent = raw;
    det.appendChild(pre);
    frag.appendChild(det);
    return frag;
  }
  function renderImgCard(m){
    var card = m.imgCard || {};
    var fig = el('figure', { class: 'img-gen', 'data-mid': m.id });
    var view = el('div', { class: 'img-gen-view' });
    var statusText = '';
    var hasFrame = false;
    if (m.status === 'streaming'){
      var frames = card._frameUrls || [];
      if (frames.length){
        hasFrame = true;
        var img = el('img', { src: frames[frames.length - 1], alt: '生成预览' });
        img.className = 'img-gen-img' + (frames.length > 1 ? ' blur-in' : ' blur');
        view.appendChild(img);
        statusText = '正在生成…（已收到 ' + frames.length + ' 帧）';
      } else {
        view.appendChild(el('div', { class: 'img-gen-skel' }));
        statusText = '正在生成…';
      }
    } else if (m.status === 'error'){
      view.appendChild(el('div', { class: 'img-gen-skel err' }));
      statusText = m.errMsg || '生成失败';
    } else {
      // final：优先用已落库的附件（刷新后旧的 blob URL 已失效）
      if (card.final || (m.attachments && m.attachments[0])){
        view.appendChild(el('div', { class: 'img-gen-skel' }));
        var aid = card.final || m.attachments[0];
        DB.getAttachment(aid).then(function(a){
          if (!a || !a.blob) return;
          var url = URL.createObjectURL(a.blob);
          try { S.previewUrls.push(url); } catch(e){}
          card._finalUrl = url;
          view.textContent = '';
          view.appendChild(el('img', { class: 'img-gen-img', src: url, alt: a.name || '生成图片' }));
        });
      } else if (card._finalUrl){
        hasFrame = true;
        view.appendChild(el('img', { class: 'img-gen-img', src: card._finalUrl, alt: '生成图片' }));
      } else if (card._frameUrls && card._frameUrls.length){
        view.appendChild(el('img', { class: 'img-gen-img', src: card._frameUrls[card._frameUrls.length - 1], alt: '生成图片' }));
      } else {
        view.appendChild(el('div', { class: 'img-gen-skel' }));
      }
    }
    fig.appendChild(view);
    var meta = el('div', { class: 'img-gen-meta' });
    if (statusText) meta.appendChild(el('div', { class: 'img-gen-status', text: statusText }));
    if (card.prompt) meta.appendChild(el('div', { class: 'img-gen-prompt', text: card.prompt, title: card.prompt }));
    fig.appendChild(meta);
    var bar = el('div', { class: 'img-gen-bar' });
    bar.appendChild(el('button', { class: 'btn btn-sec btn-sm', 'data-act': 'img-dl', 'data-id': m.id, text: '下载' }));
    bar.appendChild(el('button', { class: 'btn btn-sec btn-sm', 'data-act': m.status === 'error' ? 'img-regen' : 'img-regen', 'data-id': m.id, text: m.status === 'error' ? '重试' : '重新生成' }));
    bar.appendChild(el('button', { class: 'btn btn-sec btn-sm', 'data-act': 'img-copy', 'data-id': m.id, text: '复制 prompt' }));
    fig.appendChild(bar);
    return fig;
  }

  /* C4：把正文里的 [1]/[2] 换成上标角标，悬停出标题/域名/摘要，点击滚到来源 */
  function decorateCites(root, srcs){
    if (!srcs || !srcs.length) return;
    try {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [], n;
      while ((n = walker.nextNode())){
        var p = n.parentNode;
        if (!p || /^(PRE|CODE|A|SUP|SCRIPT|STYLE|TEXTAREA)$/.test(p.nodeName)) continue;
        if (/\[\d{1,2}\]/.test(n.nodeValue)) nodes.push(n);
      }
      nodes.forEach(function(t){
        var s = t.nodeValue, re = /\[(\d{1,2})\]/g, last = 0, mm, frag = document.createDocumentFragment(), hit = false;
        while ((mm = re.exec(s))){
          var i = +mm[1], x = srcs[i - 1];
          if (!x) continue;
          hit = true;
          frag.appendChild(document.createTextNode(s.slice(last, mm.index)));
          var host = '';
          try { host = new URL(x.u).hostname.replace(/^www\./, ''); } catch (e) {}
          var tip = (x.t || x.u || '') + (host ? ' · ' + host : '') + (x.s ? '\n' + String(x.s).slice(0, 120) : '');
          var a = document.createElement('a');
          a.className = 'cite'; a.href = '#src-' + i; a.textContent = String(i);
          a.title = tip; a.setAttribute('data-tip', tip);
          frag.appendChild(a);
          last = mm.index + mm[0].length;
        }
        if (hit){ frag.appendChild(document.createTextNode(s.slice(last))); t.parentNode.replaceChild(frag, t); }
      });
    } catch (e) {}
  }
  function msgNode(m){
    /* v0.2.1：工具结果不再以「你」的身份出现 —— 新消息 role=tool，旧数据按 [fs-result]/[run-result] 前缀识别 */
    var workTool = m.role === 'tool' || /^\[run-result\]/.test((m.content || '').trim()); // Work 工具结果 → 紧凑卡片
    var fsres = workTool || /^\[fs-result\]/.test((m.content || '').trim());              // 任一工具结果 → 「工具」身份、不给分支按钮
    var n = el('article', { class: 'msg' + (fsres ? ' toolmsg' : '') + (m.status === 'streaming' ? ' streaming' : ''), 'data-id': m.id, 'data-role': m.role });
    var head = el('div', { class: 'msg-head' }, [
      el('span', { class: 'msg-role', text: fsres ? '工具' : m.role === 'user' ? '你' : (m.role === 'system' ? '系统' : '助手') }),
      el('span', { class: 'msg-time', text: fmtTime(m.ts) }),
      el('span', { class: 'msg-tokens', text: '~' + (m.tokens || tokEst(m.content)) + ' tok' }),
    ]);
  if (m.ms) head.appendChild(el('span', { class: 'msg-tokens', text: (m.ms / 1000).toFixed(1) + 's' })); // v0.3.8：本轮耗时
  if (m.tokIn || m.tokOut) head.appendChild(el('span', { class: 'msg-tokens', text: '↑' + (m.tokIn || 0) + ' ↓' + (m.tokOut || 0), title: '输入 / 输出 token' })); // v0.3.28
  if (m.model) head.appendChild(el('span', { class: 'msg-tokens', text: String(m.model).split('/').pop().slice(0, 24), title: m.model })); // v0.3.21
    if (S.cfg.msgFork !== false && !fsres && m.role !== 'system')
      head.appendChild(el('button', { class: 'msg-fork', title: '从这里新开一个分支会话', 'data-fork': m.id }, [icon('branch'), '分支']));
  try { var _wr = (String(m.content || '').match(/```fs-write(?=[ \t]|$)/gm) || []).length; if (_wr > 1 && m.role !== 'user') head.appendChild(el('button', { class: 'msg-fork', title: '把这条回复里的 ' + _wr + ' 处写入一次应用', 'data-act': 'fs-applyall', 'data-id': m.id }, ['应用全部（' + _wr + '）'])); } catch (e) {} // v0.3.29：围栏行只有名字、路径在下一行
    n.appendChild(head);
    if (m.reasoning)
      n.appendChild(el('details', { class: 'reason' }, [
        el('summary', { text: '思考过程' }),
        el('div', { class: 'r-body', text: m.reasoning })
      ]));
  if (m.srcs && m.srcs.length){
    var sf = el('div', { class: 'msg-srcs' });
    sf.appendChild(el('span', { class: 'msg-srcs-h', text: '来源' }));
    m.srcs.forEach(function(x, k){
      var _hr = /^https?:\/\//i.test(String(x.u || '')) ? x.u : '#'; // v0.3.33：只放行 http(s)，避免 javascript: 之类被点开
      sf.appendChild(el('a', { class: 'msg-src', id: 'src-' + (k + 1), href: _hr, target: '_blank', rel: 'noreferrer', title: x.u || '' }, [String(k + 1) + '. ' + String(x.t || x.u || '')]));
    });
    var _sf = sf; // v0.3.34：先建后挂，保证顺序是正文→来源
  } // v0.3.32：来源页脚（对标 Perplexity）
    var body = el('div', { class: 'msg-body md' });
    if (m.imgCard){
      body.classList.remove('md');
      body.appendChild(renderImgCard(m));
    } else if (m.status === 'streaming' && !m.content){
      body.appendChild(el('div', { class: 'skel' }, [el('i'), el('i'), el('i')]));
    } else if (workTool){
      body.appendChild(renderToolBody(m)); // v0.2.1：Work 工具结果 → 紧凑卡片（一行一个工具），原始输出折叠
    } else if (m.role === 'assistant' || fsres){      body.innerHTML = MD.render(cleanAssistant(m.content)); // MD 产物是唯一允许的 innerHTML 来源；v0.2.1：历史里的 <tool_call> 也在渲染时剥掉

    } else {
      body.textContent = m.content;
    }
    n.appendChild(body);
    if (m.srcs && m.srcs.length) decorateCites(body, m.srcs);
  if (typeof _sf !== 'undefined' && _sf) n.appendChild(_sf);
    /* v1.28.4：证据条 —— 已生成 / 已保存 / 已运行 / 已验证；没有 verify 就标「未验证」 */
    if (m.role === 'assistant' && m.content){
      var _ev = null;
      try { _ev = MD.evidence(m.content); } catch (e) { _ev = null; }
      if (_ev && (_ev.gen + _ev.saved + _ev.ranOk + _ev.ranBad + _ev.verified) > 0){
        var _eb = el('div', { class: 'ev-strip' });
        _eb.appendChild(el('span', { class: 'ev-h', text: '证据' }));
        if (_ev.gen) _eb.appendChild(el('span', { class: 'ev-i', text: '已生成 ' + _ev.gen }));
        if (_ev.saved) _eb.appendChild(el('span', { class: 'ev-i', text: '已保存 ' + _ev.saved }));
        if (_ev.ranOk + _ev.ranBad)
          _eb.appendChild(el('span', { class: 'ev-i' + (_ev.ranBad ? ' bad' : ''), text: '已运行 ' + (_ev.ranOk + _ev.ranBad) + (_ev.ranBad ? '（失败 ' + _ev.ranBad + '）' : '') }));
        if (_ev.verified) _eb.appendChild(el('span', { class: 'ev-i ok', text: '已验证 ' + _ev.verified }));
        else _eb.appendChild(el('span', { class: 'ev-i warn', text: '未验证' }));
        n.appendChild(_eb);
      }
    }
    /* v1.28.4：围栏没闭合/没参数时明说，避免『看起来派了其实没派』 */
    if (m.role === 'assistant' && m.content && !m.isTool){
      var _w = [];
      try { _w = MD.warn(cleanAssistant(m.content)) || []; } catch (e) { _w = []; }
      if (_w.length){
        var _wt = _w.slice(0, 3).map(function(x){
          return '```' + x.lang + (x.kind === 'unclosed' ? ' 未闭合（第 ' + x.line + ' 行）' : ' 缺少参数（第 ' + x.line + ' 行）');
        }).join('；') + '，本轮未执行';
        var _wb = el('div', { class: 'tool-warn' }, [
          el('span', { class: 'tw-i', text: '⚠' }),
          el('span', { class: 'tw-t', text: _wt })
        ]);
        n.appendChild(_wb);
      }
    }
    /* v0.2.9：抓到的图片显示缩略图（点击放大），让用户看到模型实际看到的画面 */
    if (m.imgs && m.imgs.length){
      var imgsBox = el('div', { class: 'msg-imgs' });
      for (var ii = 0; ii < m.imgs.length; ii++)
        imgsBox.appendChild(el('img', { class: 'msg-img', src: m.imgs[ii], alt: '抓取的图片', loading: 'lazy',
          'data-zoom': m.imgs[ii], title: '点击查看大图' }));
      n.appendChild(imgsBox);
    }
    /* v1.8：正文不再自动折叠（原先超 2000px 自动收起，每次都要点「展开全文」） */
    if (m.attachments && m.attachments.length && !(m.imgCard && m.imgCard.final)){
      var ats = el('div', { class: 'msg-atts' });
      for (var i = 0; i < m.attachments.length; i++){
        (function(aid){
          DB.getAttachment(aid).then(function(a){
            if (!a || !a.blob) return;
            var mime = a.mime || (a.blob && a.blob.type) || '';
            if (mime.indexOf('image/') === 0){
              var url = URL.createObjectURL(a.blob);
              S.previewUrls.push(url); // 切换会话时统一 revoke（§5.2.7）
              ats.appendChild(el('img', { src: url, alt: a.name || '图片' }));
            } else {
              ats.appendChild(el('div', { class: 'att-file', title: a.name || '文件' }, [
                icon('clip'),
                el('span', { class: 't', text: (a.name || '文件') + ' · ' + sizeFmt(a.blob.size) })
              ]));
            }
          });
        })(m.attachments[i]);
      }
      n.appendChild(ats);
    }
    if (m.status === 'error' || m.status === 'aborted'){
      var errRow = el('div', { class: 'msg-err' }, [
        el('span', { text: m.errMsg || (m.status === 'aborted' ? ERR.EABORT : '出错了') }),
        el('button', { class: 'btn btn-sec', 'data-act': 'retry', 'data-id': m.id, text: '重试' }),
        el('button', { class: 'btn btn-sec', 'data-act': 'continue', 'data-id': m.id, text: '继续生成' })
      ]);
      n.appendChild(errRow);
    }
    n.appendChild(actsRow(m));
    return n;
  }
  function actsRow(m){
    var row = el('div', { class: 'msg-acts' });
    row.appendChild(el('button', { 'data-act': 'copy', 'data-id': m.id, title: '复制' }, [icon('copy'), '复制']));
    if (m.role === 'user' && !/^\[(fs|run)-result\]/.test((m.content || '').trim())){
      row.appendChild(el('button', { 'data-act': 'edit', 'data-id': m.id, title: '编辑并重新发送' }, [icon('edit'), '编辑']));
    }
    if (m.role === 'assistant' && m.status === 'ok'){
      if (m.variants && m.variants.length > 1){
        var vi = m.vi || 0;
        row.appendChild(el('button', { 'data-act': 'varprev', 'data-id': m.id, title: '上一版', text: '<', disabled: vi <= 0 }));
        row.appendChild(el('span', { class: 'var-pos', text: (vi + 1) + '/' + m.variants.length }));
        row.appendChild(el('button', { 'data-act': 'varnext', 'data-id': m.id, title: '下一版', text: '>', disabled: vi >= m.variants.length - 1 }));
      }
      row.appendChild(el('button', { 'data-act': 'regen', 'data-id': m.id, title: '重新生成' }, [icon('retry'), '重新生成']));
    }
    row.appendChild(el('button', { 'data-act': 'delmsg', 'data-id': m.id, title: '删除' }, [icon('trash'), '删除']));
    return row;
  }
  /* 流式渲染：追加式+rAF 合并。
     v2.2：流按会话存于 S.streams[sid]，切走/新建都不中断；DOM 只在「该会话正在显示」时更新。 */
  var stream = null; // 当前显示会话的流（= S.streams[S.sid] 或 null）；仅供显示层读取

  function isSending(sid){ sid = sid || S.sid; return !!(sid && S.streams[sid]); }
  /* v2.2：有流在跑就告诉宿主「忙」——宿主据此不把 WebView 压到低内存/挂起，退到后台也能继续生成 */
  function notifyBusy(){
    if (!NET.bridge.ok) return;
    NET.bridge.send({ t: 'busy', on: Object.keys(S.streams).length > 0 });
  }
  /* 把流（重新）绑定到当前 DOM：切回会话或 renderMsgs 重建后调用 */
  function bindStreamDOM(st){
    if (!st || st.sid !== S.sid) return false;
    var wrap = $('#msg-list');
    var node = wrap && wrap.querySelector('.msg[data-id="' + st.msg.id + '"]');
    if (!node) return false;
    st.node = node;
    st.body = node.querySelector('.msg-body');
    var rn = node.querySelector('.reason'); // renderMsgs 可能已渲染思考折叠 → 复用，避免重复插入
    st.rNode = rn || null;
    st.rBody = rn ? rn.querySelector('.r-body') : null;
    st.skel = node.querySelector('.skel') || null; // v2.4：骨架屏引用（避免每帧 querySelector）
    st.lastMD = 0; st.lastLen = -1;
    /* v2.4 修复：后台流 `flush` 是空函数，切回来必须恢复成真正的渲染调度，否则文本不再刷新 */
    st.flush = rafOnce(function(){ streamFrame(st); });
    return true;
  }
  /* 进入会话后：恢复流引用、重建 DOM 绑定、恢复发送键状态 */
  function attachStreamView(){
    stream = S.streams[S.sid] || null;
    if (stream) bindStreamDOM(stream);
    setSending(isSending(S.sid));
  }
  /* v2.1：流式帧渲染（beginStream 与 inPlaceStream 共用）。
     正文增量渲染 Markdown：节流 ~8fps；超长退化为纯文本，收尾时 endStream 再整体渲染。 */
  function streamFrame(st){
    if (!st || st.sid !== S.sid) return;                 // 后台会话不更新 DOM（内容仍在累加）
    if (!st.body || !st.body.isConnected || !st.node || !st.node.isConnected) bindStreamDOM(st);
    if (!st.body || !st.node) return;                    // 节点找不到（未渲染/已移除）→ 安全退出
    var dirty = false;
    if (st.acc){
      if (st.skel){ st.skel.remove(); st.skel = null; }  // 首帧内容到达：去掉骨架屏（只做一次）
      var now = Date.now();
      if (st.acc.length > LIMITS.MD_STREAM_MAX){
        if (st.lastLen !== st.acc.length){ st.body.textContent = st.acc; st.lastLen = st.acc.length; dirty = true; }
      } else if (now - (st.lastMD || 0) >= (LIMITS.MD_STREAM_GAP + Math.min(320, Math.floor(st.acc.length / 60))) && st.lastLen !== st.acc.length){
        st.lastMD = now; st.lastLen = st.acc.length;
        st.body.innerHTML = mdStream(st.acc);
        dirty = true;
      }
    }
    if (st.rAcc){
      if (!st.rNode){
        st.rNode = el('details', { class: 'reason' }, [el('summary', { text: '思考过程' })]);
        st.rBody = el('div', { class: 'r-body' });
        st.rNode.appendChild(st.rBody);
        st.node.insertBefore(st.rNode, st.body);
        dirty = true;
      }
      if (st.rBody.textContent !== st.rAcc){ st.rBody.textContent = st.rAcc; dirty = true; }
    }
    if (dirty) maybeScroll(false);                       // v2.4：无变化不排版、不滚动（滚动卡顿主因）
  }
  function beginStream(msg){
    S.msgs.push(msg);
    var node = msgNode(msg);
    $('#msg-list').appendChild(node);
    var body = node.querySelector('.msg-body');
    var st = {
      sid: msg.sid, msg: msg, node: node, body: body,
      acc: msg.content || '', rAcc: msg.reasoning || '',
      rNode: null, rBody: null, aborter: null, handle: null,
      skel: node.querySelector('.skel') || null, lastLen: -1, lastMD: 0, t0: Date.now()
    };
    st.flush = rafOnce(function(){ streamFrame(st); });
    S.streams[msg.sid] = st;              // v2.2：按会话登记
    stream = st; S.streamMsg = msg;
    return st;
  }
  /* 自动压缩：usage≥80% 触发，9 段摘要+工具输出裁剪 */
  var COMPACT_PROMPT = '把以下对话历史压缩为结构化摘要供后续接续。严格按 9 段 Markdown 输出，标题固定：1.主要请求 2.关键发现 3.读取或修改的文件 4.问题解决 5.待办任务 6.当前工作 7.可选下一步 8.重要上下文 9.明确约束。空段写"无"。只输出摘要，2000 字内。';
  function lastUsage(msgs){ for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].usage && msgs[i].usage.p) return msgs[i].usage; return null; }
  function compactCtx(s, msgsIn, cb){
    var KEEP = 6, cut = [], lastTs = 0;
    var src = (Array.isArray(msgsIn) && msgsIn.length) ? msgsIn : S.msgs; // v0.3.2：后台会话压缩不许拿别人的消息
    for (var i = 0; i < src.length - KEEP; i++){
      var m = src[i];
      if (m.status !== 'ok' || !m.content) continue;
      var t = m.content.slice(0, 3000);
      if (m.role !== 'user' && t.length > 600) t = t.slice(0, 400) + '\n[工具输出已裁剪]'; // 早期工具输出裁剪
      cut.push((m.role === 'tool' ? '【工具】' : m.role === 'user' ? '【用户】' : '【助手】') + t); lastTs = m.ts;
    }
    if (cut.length < 3){ cb(false); return; }
    var text = '', fin = false;
    function done(ok){ if (fin) return; fin = true; if (S.compactHandle === h) S.compactHandle = null; cb(ok); }
    var h = NET.send({
      body: { model: sessModel(s), stream: true, max_tokens: 2000, /* session groups v0.4.2 */
        messages: [{ role: 'user', content: COMPACT_PROMPT + '\n\n' + cut.join('\n') }] },
      onDelta: function(t2){ text += t2; },
      onUsage: function(){},
      onDone: function(){
        if (!text || text.length < 40){ done(false); return; }
        s.summary = text.slice(0, 6000); s.summaryTs = lastTs;
        DB.putSession(s); done(true);
      },
      onError: function(){ done(false); }
    });
    S.compactHandle = h; // Issue 18: 暴露句柄，停止生成(Esc)时一并中止压缩请求
  }
  /* usage 落消息：p=上下文占用（进度环数据源） */
  function usageSink(st, u){
    if (!u || !st) return;
    st.msg.tokens = u.total_tokens || st.msg.tokens;
    st.msg.usage = { p: u.prompt_tokens || 0, c: u.completion_tokens || 0, t: u.total_tokens || 0,
      h: u.prompt_cache_hit_tokens || (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || u.cache_read_input_tokens || (u.usageMetadata && u.usageMetadata.cachedContentTokenCount) || 0 };
    if (st.sid === S.sid) renderCtxRing();
  }
  /* v0.2.1：模型偶尔把 <tool_call><analysis> 这类伪工具标记当正文吐出来（不是本应用的围栏协议），
     这些字符对用户就是「乱码」。落库/渲染前统一剥掉；partial=true 时连未闭合的整段一起隐藏。 */
  function cleanAssistant(t, partial){
    var s2 = String(t == null ? '' : t);
    s2 = s2.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
    s2 = s2.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '');
    s2 = s2.replace(/<\/?tool_call>/gi, '').replace(/<\/?analysis>/gi, '');
    if (partial){
      s2 = s2.replace(/<(tool_call|analysis)>[\s\S]*$/i, '');
      return s2;
    }
    return s2.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  }
  function streamDelta(st, text, isReasoning){
    if (!st) return;
    if (isReasoning) st.rAcc += text; // 字符串拼接累加，不留 chunk 数组（§5.2.5）
    else { st.acc += text; st.msg.content = cleanAssistant(st.acc, true); } // v2.2：同步到消息对象；v0.2.1：剥掉 <tool_call>/<analysis> 噪声
    st.flush();
    if (qa && st.msg.sid === qa.sid && Date.now() - qa.last > 150){ qa.last = Date.now(); if (NET.bridge.ok) NET.bridge.send({ t: 'quick.answer', text: quickText(st.acc) }); } // v2.1：节流 150ms 实时同步到小窗（剥工具围栏 + 未闭合代码围栏临时闭合）
  }
  /* v2.1：小窗推送文本——剥工具围栏；未闭合的 ``` 临时补闭，避免小窗 RTF 把后半段整体当代码 */
  function quickText(acc){
    var t = stripFs(acc);
    if (((t.match(/```/g) || []).length % 2) === 1) t += '\n```';
    return t;
  }
  function endStream(st, status, errInfo, usage){
    if (!st) return;
    if (st.dead) return; // v2.2：会话已删除/已清空 → 丢弃结果，避免落库复活
    var msg = st.msg, sid = msg.sid, shown = (sid === S.sid); // v2.2：后台会话只落库，不动当前 DOM
    msg.content = cleanAssistant(st.acc); // v0.2.1：模型有时自吐 <tool_call>/<analysis> 伪工具标记，落库前剥掉
  try { if (msg.variants && msg.vi != null && msg.vi >= 0) msg.variants[msg.vi] = msg.content; } catch (e) {} // v0.3.55：重新生成后要把正文写回当前版本，否则切版本会变成空白
  (function(){ try { var _c = String(msg.content || ''); var _f = (_c.match(/\[fs-result\][^\n]*失败|工具失败|（失败）/g) || []).length; if (_f){ DIAG.toolFail += _f; diagSave(); } var _t = (_c.match(/超时/g) || []).length; if (_t){ DIAG.timeouts += _t; diagSave(); } } catch (e) {} })();
    if (st.rAcc) msg.reasoning = st.rAcc;
    msg.status = status;
  if (st && st.t0) msg.ms = Date.now() - st.t0; // v0.3.8：本轮耗时（对标 Claude）
  try { if (msg.role === 'assistant' && !msg.model) msg.model = sessModel(sessionById(msg.sid)) || ''; } catch (e) {} // v0.3.21 / session groups v0.4.2：记录是哪个模型答的
  try { var _hd = $('#msg-list') && $listNode(msg.id) && $listNode(msg.id).querySelector('.msg-head'); if (_hd && msg.model && !_hd.querySelector('.msg-model')) { var _ms = document.createElement('span'); _ms.className = 'msg-tokens msg-model'; _ms.textContent = String(msg.model).split('/').pop().slice(0, 24); _ms.title = msg.model; _hd.appendChild(_ms); } } catch (e) {} // v0.3.29：流式建节点时 model 还没赋值，收尾补上
    if (errInfo) msg.errMsg = errInfo.msg;
    if (usage && usage.total_tokens) msg.tokens = usage.total_tokens;
  var _uu = (st && st.msg && st.msg.usage) || usage || null; if (_uu){ if (_uu.prompt_tokens) msg.tokIn = _uu.prompt_tokens; if (_uu.completion_tokens) msg.tokOut = _uu.completion_tokens; if (_uu.total_tokens) msg.tokens = _uu.total_tokens; } // v0.3.29：明细在 msg.usage 里
  if (!String(msg.content || '').trim() && String(msg.reasoning || '').trim()){ /* v0.3.57：只拿到推理时，把它当正文显示，别让用户对着空泡 */
    msg.content = String(msg.reasoning).trim() + '\n\n> 以上是模型的推理内容：这一轮没有单独的正文返回（常见于 reasoning 模型或上游只回 reasoning_content）。';
  }
  if (!errInfo && !String(msg.content || '').trim()){ /* v0.3.58：两个分支必须分开；有错误时不贴空回复占位符，由错误条展示 */
    var _r = String(msg.reasoning || '').trim();
    var _tok = (usage && usage.completion_tokens) || msg.tokens || 0;
    msg.content = '（这一轮没有返回正文' + (_tok ? '，但计费了 ' + _tok + ' tokens' : '') + (_r ? '；只拿到推理过程，见下方「思考」折叠' : '') + '）\n\n> 常见原因：模型只输出 reasoning / 接口不是 OpenAI 的 delta.content 格式 / 上游把回复截断。可以换个模型或看「思考」里的内容。';
    try {
      var _raw0 = (typeof NET !== 'undefined' && NET && ((NET.lastRaw && NET.lastRaw()) || NET._lastRaw)) || '';
      if (_raw0) msg.content += '\n> 已保留本轮原始流：设置里开 SC_DBG 后可用 SC_DBG.net.lastRaw() 复制排查。';
    } catch (e) {}
    msg.emptyReply = 1;
  }
    if (msg.content.length > LIMITS.MSG_TEXT){
      msg.content = msg.content.slice(0, LIMITS.MSG_TEXT); // 超限截断（§4.3）
      msg.truncated = true;
    }
    if (S.streams[sid] === st) delete S.streams[sid]; // v0.3.7：同会话新流不能被旧流收尾删掉 // 登记出清（v2.2）
    if (shown){
      if (!st.body || !st.body.isConnected) bindStreamDOM(st);
      /* 结束一次性换成完整 Markdown（§5.1.2） */
      var body = st.body;
      if (body){
        body.textContent = '';
        if (msg.role === 'assistant' && msg.content) body.innerHTML = MD.render(msg.content);
        else body.textContent = msg.content;
      }
      /* 更新错误行 / 动作行 */
      var node = st.node;
      if (node){
        node.classList.remove('streaming');   /* #20：流式结束，代码工具条淡入 */
        var old = node.querySelector('.msg-err'); if (old) old.remove();
        var oldActs = node.querySelector('.msg-acts'); if (oldActs) oldActs.remove();
        if (status === 'error' || status === 'aborted'){
          var errRow = el('div', { class: 'msg-err' }, [
            el('span', { text: msg.errMsg || '出错了' }),
            el('button', { class: 'btn btn-sec', 'data-act': 'retry', 'data-id': msg.id, text: '重试' }),
            el('button', { class: 'btn btn-sec', 'data-act': 'continue', 'data-id': msg.id, text: '继续生成' })
          ]);
          node.insertBefore(errRow, null);
        }
        node.appendChild(actsRow(msg));
        var tk = node.querySelector('.msg-tokens');
        if (tk) tk.textContent = '~' + (msg.tokens || tokEst(msg.content)) + ' tok';
      }
      stream = null; S.streamMsg = null;
      renderCtxRing();
    }
    DB.putMessage(msg); // 一次性落库（§5.1.5）
    if (msg.role === 'assistant' && status === 'ok') MEM.note(sid, (shown ? S.msgs : []), 'ok'); // v0.3.7：后台会话别拿当前会话的消息 // v1.17：记一笔
    touchSession(null, sid);
    notifyBusy(); // v2.2：登记出清后重新计算「忙」状态
    if (shown && !((S.pend || 0) > 0)) setSending(false);
    if (qa && msg.sid === qa.sid){ // 快速提问终态：错误给简短原因，其余给全文
      if (NET.bridge.ok) NET.bridge.send({ t: 'quick.answer', text: quickText(msg.errMsg || msg.content || ''), done: true });
      qa = null;
    }
    if (shown) maybeScroll(false); // v2.1：收尾不再强制拽到底
  }

  /* 会话操作 */
  function createSession(title){
    var now = Date.now();
    var tmp = !!S.tempMode; /* v2.8：临时会话 → 只建内存会话，不落库、不进历史 */
    /* session groups v0.4.2：从草稿配置取显式值；model/systemPrompt 留空=动态继承分组/全局 */
    var dc = S.draftCfg || {};
    var gid = dc.groupId || S.pendGroup || '';
    var g = gid ? groupById(gid) : null;
    var s = {
      id: uuid(), title: title || (tmp ? '临时会话' : '新会话'), createdAt: now, updatedAt: now,
      groupId: gid,                                  // 所属分组；空=未分组
      mode: dc.mode || (g && g.mode) || S.cfg.mode || 'chat', // v1.1.18：会话级模式
      pinned: false,
      model: dc.model || '',                         // 空=跟随分组/全局，不复制全局模型
      systemPrompt: dc.systemPrompt || '',           // 空=跟随分组/全局
      params: dc.params || {},                       // 仅存显式覆盖项，空=跟随
      workspace: S.pendWs || '', msgCount: 0, temp: tmp
    };
    S.pendWs = '';
    S.draftCfg = null; S.pendGroup = '';             // 草稿配置应用完即清
    S.sessions.unshift(s);
    if (tmp){ DB.markTemp(s.id); }
    else DB.putSession(s);
    /* 新会话无历史，同步切换，避免异步加载覆盖刚发送的消息（v2.2：不中止其它会话的生成） */
    revokePreviews();
    S.sid = s.id;
    S.windowSize = LIMITS.DOM_WINDOW;
    S.msgs = [];
    renderSessions();
    $title.textContent = s.title;
    renderMsgs();
    renderWsBtn();
    renderCtxRing();
    attachStreamView();
    return s;
  }
  /* 草稿不落库；首条建会话。session groups v0.4.2：可预选分组，并重置草稿配置 */
  function newDraft(groupId){
    dropTempSessions(); // v2.8：新建即丢弃上一个临时会话（不写历史、不留痕）
    revokePreviews(); // v2.2：新建草稿不中止其它会话的生成
    S.sid = null; S.windowSize = LIMITS.DOM_WINDOW; S.msgs = [];
    S.sugSeed = (Math.random() * 2147483647) | 0; // v2.9：新草稿换一批建议
    S.follow = true; // v2.1：新建草稿恢复跟随（配合 renderMsgs 不再强制滚动）
    S.draftCfg = mkDraftCfg(groupId || ''); // 干净草稿（带 groupId 则预选分组）
    S.pendGroup = '';
    renderSessions(); renderMsgs();
    renderComposerCtl();
    $title.textContent = 'SoloChat';
    $input.value = ''; autosize();
    attachStreamView();
  }
  /* 侧栏项目新建任务：Agent+预选文件夹 */
  function newFromProject(ws){
    ws = ws || (curSession() && curSession().workspace) || '';
    setCfg({ mode: 'agent' });
    S.pendWs = ws;
    if (ws && S.cfg.wsClosed && S.cfg.wsClosed[ws]){ delete S.cfg.wsClosed[ws]; saveCfg(); }
    newDraft();
    if (ws) toast('已新建 Agent 任务，文件夹：' + ws);
    else toast('未找到文件夹，请在主页点「选择文件夹」', true);
  }
  function inferSessionMode(s, list){
    if (s && s.workspace) return 'agent'; // 有真实工作区路径的基本是 Agent
    var txt = (list || []).map(function(m){ return String(m.content || ''); }).join('\n').slice(0, 30000);
    if (/```(?:fs-|cmd|git)|\[fs-result\]|\[cmd\]/.test(txt)) return 'agent';
    if (/```(?:vfs-|run|preview|patch)|\[vfs\]|\[run-result\]|\[preview\]/.test(txt)) return 'work';
    return 'chat';
  }
  function selectSession(sid){
    /* v2.2：切会话不再中止正在进行的生成 —— 原会话转后台继续跑，回来还能看到它 */
    dropTempSessions(sid); // v2.8：切到别的会话 = 离开临时会话，内存态直接丢弃
    revokePreviews(); // 切换时 revoke 上一会话预览 URL（§5.2.7）
    S.sid = sid;
    S.windowSize = LIMITS.DOM_WINDOW;
    S.msgs = [];
    S.follow = true; // v2.1：切会话跳到最新（配合 renderMsgs 不再强制滚动）
    renderSessions();
    var s = curSession();
    $title.textContent = s ? (s.title || '未命名会话') : 'SoloChat';
    if (!s){ renderMsgs(); renderWsBtn(); attachStreamView(); return; }
    var _savedMode = (['chat', 'work', 'agent'].indexOf(s.mode) >= 0) ? s.mode : '';
    if (_savedMode && _savedMode !== S.cfg.mode){
      S.cfg.mode = _savedMode;
      try { saveCfg(); renderComposerCtl(); } catch (e) {}
    }
    DB.msgsBySid(sid).then(function(list){
      if (S.sid !== sid) return; // 已切走，丢弃过期结果
      list.sort(function(a, b){ return a.ts - b.ts; });
      S.msgs = list;
      if (!_savedMode){
        var _inf = inferSessionMode(s, list);
        s.mode = _inf;
        try { DB.putSession(s); } catch (e) {}
        if (_inf !== S.cfg.mode){
          S.cfg.mode = _inf;
          try { saveCfg(); renderComposerCtl(); } catch (e) {}
        }
      }
      /* v1.1.21：打开会话时把历史附件也补进工作区（后台执行，不阻塞阅读） */
      try { hydrateAttachments(list, function(){ try { RUNNER.renderWs(); } catch (e) {} }); } catch (e) {}
      var st = S.streams[sid];
      if (st && !S.msgs.some(function(x){ return x.id === st.msg.id; })) S.msgs.push(st.msg); // 在飞消息尚未落库：补进视图
      renderMsgs();
      renderWsBtn();
      renderCtxRing();
      RUNNER.syncForSession(sid); // v0.2.5：重进会话 → 有产物就自动打开工作区
      MEM.warm(sid, list); // v1.17：预热记忆块
      attachStreamView(); // 恢复该会话的流绑定/发送键状态
      /* 恢复草稿 */
      $input.value = S.drafts[sid] || '';
      autosize();
    });
  }
  function touchSession(titleFrom, sid){ // v2.2：可指定会话（后台完成的流也要更新其标题/时间）
    sid = sid || S.sid;
    var s = null;
    for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].id === sid) s = S.sessions[i];
    if (!s) return;
    var shown = (sid === S.sid);
    s.updatedAt = Date.now();
    if (shown) s.msgCount = S.msgs.length;
    if (titleFrom && (s.title === '新会话' || !s.title))
      s.title = titleFrom.replace(/\s+/g, ' ').slice(0, 18);
    sortSessions();
    DB.putSession(s);
    renderSessions();
    if (shown) $title.textContent = s.title;
    if (!shown) // 后台会话：条数从库里回填，保证 @ 选择器显示准确
      DB.msgsBySid(sid).then(function(list){
        if (!sessionById(sid)) return; // v2.4：期间会话已被删除 → 不要再写回（防僵尸会话）
        s.msgCount = (list || []).length; sortSessions(); DB.putSession(s); renderSessions();
      });
  }
  function deleteSession(sid){ // 无确认，直接删除
    killStreams([sid]); // v2.2：先终止该会话的后台流
    DB.delSessionDeep(sid).then(function(){
      S.sessions = S.sessions.filter(function(x){ return x.id !== sid; });
      delete S.drafts[sid];
      if (qa && qa.sid === sid) qa = null; // 快速条标记指向已删会话：清（v2.0 零遗留）
      if (S.sid === sid){
        S.sid = null; S.msgs = [];
        RUNNER.reset(); // 拆沙箱 iframe、清运行态（v2.0 零遗留）
        if (S.sessions.length) selectSession(S.sessions[0].id);
        else { renderMsgs(); $title.textContent = 'SoloChat'; }
      }
      renderSessions();
      toast('已删除');
    });
  }
  /* 删除项目：其全部任务一并删除（无确认） */
  function deleteProject(ws){
    var arr = S.sessions.filter(function(x){ return x.workspace === ws; });
    killStreams(arr.map(function(x){ return x.id; })); // v2.2：先终止这些会话的后台流
    Promise.all(arr.map(function(x){ return DB.delSessionDeep(x.id); })).then(function(){
      S.sessions = S.sessions.filter(function(x){ return x.workspace !== ws; });
      var curGone = false;
      for (var i = 0; i < arr.length; i++){
        delete S.drafts[arr[i].id];
        if (S.sid === arr[i].id) curGone = true;
      }
      if (S.cfg.pinnedWs) delete S.cfg.pinnedWs[ws];
      if (S.cfg.wsClosed) delete S.cfg.wsClosed[ws];
      saveCfg();
      if (curGone){
        S.sid = null; S.msgs = [];
        if (S.sessions.length) selectSession(S.sessions[0].id);
        else { renderMsgs(); $title.textContent = 'SoloChat'; }
      }
      renderSessions();
      toast('已删除项目');
    });
  }

  /* 输入区 */
  function autosize(){
    $input.style.height = 'auto';
    $input.style.height = Math.min($input.scrollHeight, 180) + 'px';
  }
  function setSending(v){
    S.sending = v;
    var use = $send.querySelector('use');
    use.setAttribute('href', v ? '#i-stop' : '#i-send'); // 生成中 → 主题化圆角方块停止键
    $send.title = v ? '停止生成（Esc）' : '发送 (Enter)';
  }
  /* v1.28.1：回合的文字流结束了，但工具链（子智能体 / 抓取 / 下载）还在跑 ——
     用计数器把「停止」状态挂住，别让按钮提前变回发送键。 */
