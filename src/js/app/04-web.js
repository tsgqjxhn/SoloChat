function webLastUrl(){
  try { return localStorage.getItem('sc.rn.web') || ''; } catch (e) { return ''; }
}
function webSaveUrl(u){
  try { if (/^https?:\/\//i.test(String(u || ''))) localStorage.setItem('sc.rn.web', String(u)); } catch (e) {}
}
function webRect(){
  /* v1.1.8：原生 WebView2 只能盖住 iframe 区域，不能盖住上面的地址栏/关闭按钮。
     之前用 #pane-web 的整块矩形，连 .rn-pvbar 一起盖住，用户点不到关闭，
     看起来就是“打开网页后回不到主界面”。 */
  var f = $('#web-frame'), pane = $('#pane-web');
  var el = f || pane;
  if (!el) return { x: 0, y: 0, w: 0, h: 0 };
  var r = el.getBoundingClientRect();
  if ((!r.width || !r.height) && pane){
    var p = pane.getBoundingClientRect();
    var bar = pane.querySelector('.rn-pvbar');
    var bh = bar ? bar.getBoundingClientRect().height : 0;
    r = { left: p.left, top: p.top + bh, width: p.width, height: Math.max(0, p.height - bh) };
  }
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
}
var _webLast = { url: '', x: -1, y: -1, w: -1, h: -1, t: 0 }; // v1.1.8：ResizeObserver/重复 open 去抖
function webHost(url){
  /* v1.1.8：重新启用宿主内嵌 WebView2（真浏览器，不受 X-Frame-Options 限制）。
     安全性由 webRect() 保证：原生控件只覆盖 iframe 区域，地址栏和关闭按钮始终可点。 */
  try {
    if (!(NET.bridge && NET.bridge.ok && NET.bridge.engine === 'webview2')) return false;
    if (!document.body.classList.contains('rn-open')) return false;
    if (document.querySelector('#modal.show') || document.querySelector('.lightbox.on')) return false;
    if (!/^https?:\/\//i.test(String(url || ''))) return false;
    var rect = webRect();
    if (!rect || rect.w < 40 || rect.h < 40) return false;
    var now = Date.now();
    if (url === _webLast.url && rect.x === _webLast.x && rect.y === _webLast.y &&
        rect.w === _webLast.w && rect.h === _webLast.h && now - _webLast.t < 300) return true;
    _webLast = { url: url, x: rect.x, y: rect.y, w: rect.w, h: rect.h, t: now };
    NET.bridge.send({ t: 'webview', op: 'show', url: url, rect: rect });
    return true;
  } catch (e) { return false; }
}
function webHostHide(){
  _webLast = { url: '', x: -1, y: -1, w: -1, h: -1, t: 0 };
  try { if (NET.bridge && NET.bridge.ok && NET.bridge.engine === 'webview2') NET.bridge.send({ t: 'webview', op: 'hide' }); } catch (e) {}
}
function webHostRestore(){
  /* v1.1.8：弹窗/灯箱关闭后，如果还停在「网页」标签，把原生浏览器放回来 */
  try {
    if (!document.body.classList.contains('rn-open')) return;
    var r = $('#runner');
    if (!r || r.getAttribute('data-tab') !== 'web') return;
    var u = ($('#web-url') || {}).value || webLastUrl();
    if (u) webHost(u);
  } catch (e) {}
}
function openWeb(url){
  var u = String(url || '').trim();
  if (!u) return false;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  var f = $('#web-frame'), inp = $('#web-url');
  if (!f) return false;
  /* 先写地址栏，再 open：open() 里若停在「网页」标签会按新地址直接叫出原生浏览器。 */
  if (inp) inp.value = u;
  webSaveUrl(u);
  try { $('#runner').setAttribute('data-web', u); } catch (e) {}
  open(); setTab('web');
  if (webHost(u)){
    f.removeAttribute('src');   // 宿主内嵌：真实页面在上层原生控件里
  } else {
    f.setAttribute('src', u);   // 浏览器版回退 iframe
  }
  return true;
}
function bindWeb(){
  var go = $('#web-go'), inp = $('#web-url'), pop = $('#web-pop');
  /* v1.1.14：重启应用后恢复上次侧栏网页地址；关闭侧栏再打开也有地址可回填 */
  try { var _lastW = webLastUrl(); if (inp && !inp.value && _lastW) inp.value = _lastW; } catch (e) {}
  function run(){ var v = inp && inp.value.trim(); if (!v) return; openWeb(v); }
  if (go) go.addEventListener('click', run);
  if (inp) inp.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); run(); } });
  var txb = $('#web-txt');
  if (txb) txb.addEventListener('click', function(){
    var u = ($('#web-url') || {}).value || '';
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    UI.toast('正在抓取…');
    NET.raw({ url: u, method: 'GET', headers: { 'Accept': 'text/html,application/xhtml+xml' }, timeout: 20000 })
      .then(function(r){
        if (!r || r.status < 200 || r.status >= 300) return UI.toast('抓取失败：HTTP ' + (r && r.status), true);
        var html = String(r.text || '');
        /* 去掉脚本：srcdoc 与父页同源，执行外部脚本不安全 */
        html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
        if (!/<base\s/i.test(html)) html = html.replace(/<head[^>]*>/i, function(m){ return m + '<base href="' + u + '">'; });
        var f = $('#web-frame');
        if (f){ f.removeAttribute('src'); f.srcdoc = html; }
        UI.toast('已用文本模式渲染（脚本已禁用）');
      }, function(e){ UI.toast('抓取失败：' + ((e && e.message) || e), true); });
  });
  if (pop) pop.addEventListener('click', function(){
    var u = ($('#web-url') || {}).value || '';
    /* v1.1.15：外链按钮也留在侧栏，不再创建「SoloChat · 播放」窗口 */
    if (u) openWeb(u);
  });
  /* v0.9.9：面板拖动/窗口缩放时，同步原生网页控件的位置 */
  try {
    var pw = document.getElementById('pane-web');
    if (pw && window.ResizeObserver){
      var sync = function(){
        try {
          var r = $('#runner');
          if (r && r.getAttribute('data-tab') === 'web' && document.body.classList.contains('rn-open')){
            var u2 = ($('#web-url') || {}).value || '';
            if (u2) webHost(u2);
          }
        } catch (e) {}
      };
      new ResizeObserver(sync).observe(pw);
      window.addEventListener('resize', sync);
    }
  } catch (e) {}
}

  var agentPath = ''; var agentRootFor = '';   // v1.13：Agent 文件夹浏览的当前子路径

  /* ---- v2.1：运行面板内的「工作区」区（Work 沙箱文件：列表 / 单文件下载 / 打包 zip）---- */
  /* v0.2.5：切会话/重开应用后恢复工作区 —— 该会话有产物就打开面板并切到「工作区」 */
  function syncForSession(sid){
    if (!sid) return;
    DB.workfsBySid(sid).then(function(fs){
      if (S.sid !== sid) return;
      renderWs();   // v1.13：不再自动弹面板，产物列表留给用户自己开
    }, function(){});
  }
  /* v1.13：Agent 的工作区 = 用户选中的真实文件夹（列目录 / 查看 / 删除） */
  function agentRoot(){ var cs = (typeof curSession === 'function') ? curSession() : null; return (cs && cs.workspace) || ''; }
  function agentRel(p){ return agentPath ? (agentPath + '/' + p) : p; }
  function renderAgentWs(){
    var list = $('#rn-ws-list'), cnt = $('#rn-ws-count');
    if (!list) return;
  if (root && agentPath && agentRootFor && agentRootFor !== root){ agentPath = ''; } // v0.3.67：换会话/换根就回到根目录，别把上一个工作区的子路径带过来
  agentRootFor = root;
    var root = agentRoot();
    list.textContent = '';
    if (cnt) cnt.textContent = '';
    if (!root){
      list.appendChild(el('div', { class: 'hint', text: '还没选文件夹。回主页点「选择文件夹」。' }));
      return;
    }
    var head = el('div', { class: 'vfs-row', style: 'opacity:.85' }, [
      el('span', { class: 't', text: '/' + (agentPath || ''), title: root })
    ]);
    if (agentPath) head.appendChild(el('button', { class: 'btn btn-ghost rn-mini', type: 'button', text: '↑ 上级', 'data-ag-up': '1' }));
    head.appendChild(el('button', { class: 'btn btn-ghost rn-mini', type: 'button', text: '刷新', 'data-ag-refresh': '1' }));
    list.appendChild(head);
    NET.fs('list', agentPath || '', '', root).then(function(raw){
      var r = raw; try { r = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { r = {}; }
      var entries = (r && r.entries) || [];
      if (cnt) cnt.textContent = entries.length ? ('（' + entries.length + ' 项）') : '';
      if (!entries.length) list.appendChild(el('div', { class: 'hint', text: '这个文件夹是空的。' }));
      entries.forEach(function(e){
        var kids = [
          el('span', { class: 't', text: e.n + (e.d ? '/' : ''), title: e.n }),
          el('span', { class: 'hint', text: e.d ? '' : sizeFmt(e.s || 0) })
        ];
        if (e.d) kids.push(el('button', { class: 'btn btn-ghost rn-mini', type: 'button', text: '进入', 'data-ag-dir': e.n }));
        else {
          kids.push(el('button', { class: 'btn btn-ghost rn-mini', type: 'button', text: '查看', 'data-ag-view': e.n }));
          kids.push(el('button', { class: 'btn btn-ghost rn-mini', type: 'button', text: '删除', 'data-ag-del': e.n }));
        }
        list.appendChild(el('div', { class: 'vfs-row' }, kids));
      });
    }, function(err){
      list.appendChild(el('div', { class: 'hint', text: '读取失败：' + (err && err.message || err) }));
    });
  }
  function agentView(name){
    var root = agentRoot(); if (!root) return;
    var path = agentRel(name), box = $('#rn-ws-view');
    if (!box) return;
    /* v1.1.22：二进制原文件不要按 UTF-8 读成乱码；文本看同名 .md 提取文件 */
    var _ax = extOf(name);
    if (/^(png|jpe?g|gif|webp|bmp|ico|tiff?|pdf|pptx?|docx?|xlsx?|zip|rar|7z|gz|tar|mp3|wav|flac|mp4|mov|webm|mkv|exe|dll|so|bin)$/i.test(_ax)){
      box.hidden = false; box.textContent = '';
      box.appendChild(el('div', { class: 'vfs-row' }, [
        el('span', { class: 't', text: path, title: path }),
        el('button', { class: 'btn btn-ghost rn-mini', type: 'button', text: '关闭', 'data-ag-close': '1' })
      ]));
      box.appendChild(el('pre', { class: 'ag-pre', text: '二进制原文件：' + path + '\n\n请用本地应用打开；文档的提取文本在同名 .md 文件里。' }));
      return;
    }
    NET.fs('read', path, '', root).then(function(raw){
      var r = raw; try { r = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { r = {}; }
      var txt = String((r && r.text) || '');
      box.hidden = false;
      box.textContent = '';
      box.appendChild(el('div', { class: 'vfs-row' }, [
        el('span', { class: 't', text: path, title: path }),
        el('button', { class: 'btn btn-ghost rn-mini', type: 'button', text: '关闭', 'data-ag-close': '1' })
      ]));
      box.appendChild(el('pre', { class: 'ag-pre', text: txt.slice(0, 200000) }));
    }, function(err){ UI.toast('读不了：' + (err && err.message || err), true); });
  }
  function agentDel(name){
    var root = agentRoot(); if (!root) return;
    var path = agentRel(name);
    if (!confirm('删除 ' + path + ' ？不可撤销。')) return;
    NET.fs('delete', path, '', root).then(function(){
      UI.toast('已删除 ' + path); renderWs();
    }, function(err){ UI.toast('删除失败：' + (err && err.message || err), true); });
  }
  function renderWs(){
    bindOnce();
    if (!bound) return;
    if ((S.cfg.mode || 'chat') === 'agent' || S.cfg.mode === 'soul') return renderAgentWs();   // v1.13：Agent/Soul 看真实文件夹
    var list = $('#rn-ws-list'), cnt = $('#rn-ws-count');
    if (!list) return;
    var sid = (typeof S !== 'undefined' && S.sid) || null;
    if (!sid){ list.textContent = ''; if (cnt) cnt.textContent = ''; return; }
    DB.workfsBySid(sid).then(function(fs){
    var _tot = 0; for (var _fi = 0; _fi < fs.length; _fi++) _tot += (fs[_fi].size || String(fs[_fi].content || '').length);
    /* v1.1.19：顶栏空间留给刷新/最大化/关闭，只显示文件数；体积放进 tooltip。 */
    if (cnt){
      cnt.textContent = fs.length ? ('（' + fs.length + '）') : '';
      cnt.title = fs.length ? (fs.length + ' 个文件 · ' + sizeFmt(_tot)) : '';
    }
      list.textContent = '';
      if (!fs.length){
        list.appendChild(el('div', { class: 'hint', text: '沙箱工作区还没有文件。AI 用 ```vfs-write 写入（或回复里的 html/svg/js/css/md 代码块）后会自动出现在这里。' }));
        return;
      }
      fs.sort(function(a, b){ return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
      /* v3.0 #11：按目录分组（可折叠），单层平铺时不加分组 */
      function rowOf(f){
        var k = pvKind(f.path), ext = pvExt(f.path);
        var rowKids = [
          el('span', { class: 't', text: f.path, title: f.path }),
          el('span', { class: 'hint', text: sizeFmt(f.size || 0) })
        ];
        if (k !== 'src')
          rowKids.push(el('button', { class: 'btn btn-ghost rn-mini', text: '预览', 'data-vpv': f.path }));
        else
          rowKids.push(el('button', { class: 'btn btn-ghost rn-mini', text: '查看', 'data-vpv': f.path }));
        if (crKind(ext))
          rowKids.push(el('button', { class: 'btn btn-ghost rn-mini', text: '运行', 'data-vrun': f.path, title: '在沙箱运行该文件，控制台输出见下方终端' }));
        rowKids.push(el('button', { class: 'btn btn-ghost rn-mini', text: '下载', 'data-vdl': f.id, title: '下载该文件' }));
        /* v3.0 #15：有历史版本时给「回滚」入口 */
        if (f.vers && f.vers.length)
          rowKids.push(el('button', { class: 'btn btn-ghost rn-mini', text: '版本 ' + f.vers.length, 'data-vver': f.path, title: '回滚到上一个版本' }));
        return el('div', { class: 'vfs-row' + (pv && pv.sid === sid && pv.path === f.path ? ' pv-on' : '') }, rowKids);
      }
      var groups = {}, order = [];
      fs.forEach(function(f){
        var parts = String(f.path || '').split('/');
        var dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
        if (!groups[dir]){ groups[dir] = []; order.push(dir); }
        groups[dir].push(f);
      });
      if (order.length <= 1 && order[0] === ''){
        fs.forEach(function(f){ list.appendChild(rowOf(f)); });
        return;
      }
      var closedMap = S.wsTreeClosed || (S.wsTreeClosed = {});
      order.forEach(function(dir){
        var box = el('div', { class: 'tree-grp' + (closedMap[dir] ? ' closed' : '') });
        var head = el('div', { class: 'tg' }, [
          icon('folder'), el('span', { text: dir || '（根目录）' }),
          el('span', { class: 'hint', text: ' ' + groups[dir].length })
        ]);
        head.addEventListener('click', function(){
          if (closedMap[dir]) delete closedMap[dir]; else closedMap[dir] = 1;
          box.classList.toggle('closed');
        });
        box.appendChild(head);
        groups[dir].forEach(function(f){
          var r = rowOf(f);
          r.querySelector('.t').textContent = f.path.slice(dir ? dir.length + 1 : 0);
          r.querySelector('.t').title = f.path;
          r.setAttribute('title', f.path);
          box.appendChild(r);
        });
        list.appendChild(box);
      });
    });
  }

  /* ---- v2.5：内置侧边栏浏览器（Work VFS 预览）----
     在沙箱 iframe 里渲染工作区的 html/svg/md：相对引用的 css/js 自动从 VFS 内联，
     页内相对链接可多页跳转（前进/后退），AI 改写当前预览文件时自动刷新。
     安全：iframe sandbox="allow-scripts"（不透明源，碰不到主窗）；预览文档内联 CSP
     禁一切网络请求（connect-src 'none'），仅允许 https 图片/媒体展示。 */
  var pv = null; /* 当前预览 {sid, path} */
  var pvBack = [], pvFwd = [];
  var PV_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob: https:; media-src data: blob: https:; font-src \'none\'; connect-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'">';
  /* 预览页导航桥：拦截相对链接 → postMessage 回主窗换页；外链阻止并回提示 */
  var PVNAV = '<scr' + 'ipt>(' + function(){
    document.addEventListener('click', function(e){
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var h = a.getAttribute('href') || '';
      if (!h || h.charAt(0) === '#') return;                 /* 页内锚点放行 */
      if (/^(https?:|mailto:|javascript:|data:)/i.test(h)){
        if (/^https?:/i.test(h)){ e.preventDefault(); try { parent.postMessage({ __scpvext: 1, href: h }, '*'); } catch(x){} }
        return;
      }
      e.preventDefault();
      try { parent.postMessage({ __scpvnav: 1, href: h }, '*'); } catch(x){}
    }, true);
  }.toString() + ')();</scr' + 'ipt>';
  function pvExt(path){ var m = /\.([a-z0-9]+)$/i.exec(String(path || '')); return m ? m[1].toLowerCase() : ''; }
  function pvKind(path){ var e = pvExt(path);
    return (e === 'html' || e === 'htm') ? 'html' : (e === 'svg' ? 'svg' : ((e === 'md' || e === 'markdown') ? 'md' : 'src')); }
  function pvResolve(dir, rel){ /* 相对路径 → VFS 规范路径（禁逃逸根） */
    rel = String(rel || '').split('#')[0].split('?')[0];
    if (!rel) return null;
    var parts = (rel.charAt(0) === '/' ? [] : (dir ? dir.split('/') : [])).concat(rel.split('/'));
    var out = [], i, p;
    for (i = 0; i < parts.length; i++){
      p = parts[i];
      if (!p || p === '.') continue;
      if (p === '..'){ if (!out.length) return null; out.pop(); continue; }
      out.push(p);
    }
    return out.join('/');
  }
  function pvInline(html, dir, map){ /* 把相对引用的 css/js 从 VFS 内联（外链原样保留） */
    html = html.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi, function(m, href){
      if (/^(https?:|data:|\/\/)/i.test(href)) return m;
      var key = pvResolve(dir, href), f = key && map[key];
      if (!f || !/\.css$/i.test(f.path)) return m;
      return '<style>\n/* ' + f.path + ' */\n' + (f.content || '') + '\n</style>';
    });
    html = html.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, function(m, src){
      if (/^(https?:|data:|\/\/)/i.test(src)) return m;
      var key = pvResolve(dir, src), f = key && map[key];
      if (!f || !/\.js$/i.test(f.path)) return m;
      return '<scr' + 'ipt>\n/* ' + f.path + ' */\n' + (f.content || '') + '\n</scr' + 'ipt>';
    });
    return html;
  }
  /* v2.8：预览文档的深色代码面跟随当前主题 token（Claude=#181715 / Linear=#0f1011），
     不再写死 #0b0b0c；code-bg 在两个主题下都保持深色，符合设计文档「代码面恒深」。 */
  function tok(name, fb){
    try{
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fb;
    }catch(e){ return fb; }
  }
  var MD_STY = null;
  function mdSty(){ /* 每次生成时取值，跟随当前主题 */
    return '<style>body{margin:0;padding:16px 20px;background:' + tok('--code-bg', '#0f1011') + ';color:' + tok('--code-ink', '#f7f8f8') + ';font:14px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;max-width:860px}' +
      'h1,h2,h3{line-height:1.3}a{color:' + tok('--primary', '#5e6ad2') + '}code,pre{font-family:ui-monospace,Consolas,monospace;background:' + tok('--code-bg-soft', '#141516') + ';border-radius:6px}' +
      'code{padding:1px 5px}pre{padding:10px 12px;overflow:auto}pre code{padding:0;background:none}' +
      'blockquote{border-left:3px solid ' + tok('--hairline', '#23252a') + ';margin:8px 0;padding:2px 12px;color:' + tok('--code-muted', '#8a8f98') + '}' +
      'table{border-collapse:collapse}td,th{border:1px solid ' + tok('--hairline', '#23252a') + ';padding:5px 9px}img,video{max-width:100%;height:auto}' +
      '.md-media{display:inline-block;max-width:100%}</style>';
  }
  function pvDoc(f, fs){ /* 生成预览文档（注入 CSP + console 桥 + 导航桥） */
    var kind = pvKind(f.path), dir = f.path.indexOf('/') >= 0 ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    var head = '<meta charset="utf-8">' + PV_CSP + BRIDGE.replace('__SC_NONCE__', JSON.stringify(String(curNonce || ''))) + PVNAV;
    var content = f.content || '';
    if (kind === 'svg')
      return '<!doctype html><html><head>' + head + '</head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:' + tok('--code-bg','#0f1011') + ';color:' + tok('--code-ink','#f7f8f8') + '">' + content + '</body></html>';
    if (kind === 'md')
      return '<!doctype html><html><head>' + head + mdSty() + '</head><body><div class="md">' + MD.render(content) + '</div></body></html>';
    /* html：内联 VFS 相对资源后注入 head */
    var map = {}, i;
    for (i = 0; i < fs.length; i++) map[fs[i].path] = fs[i];
    content = pvInline(content, dir, map);
    if (/<head[\s>]/i.test(content)) return content.replace(/<head[^>]*>/i, function(m){ return m + head; });
    if (/<html[\s>]/i.test(content)) return content.replace(/<html[^>]*>/i, function(m){ return m + '<head>' + head + '</head>'; });
    return '<!doctype html><html><head>' + head + '</head><body>\n' + content + '\n</body></html>';
  }
  function pvBarSync(){
    var view = $('#pane-view');
    if (view) view.classList.toggle('pv', !!pv);
    var bb = $('#pv-back'), fb = $('#pv-fwd');
    if (bb) bb.disabled = !pvBack.length;
    if (fb) fb.disabled = !pvFwd.length;
  }
  function pvRender(entry){ /* 渲染指定 VFS 文件到预览 iframe */
    bindOnce();
    DB.workfsBySid(entry.sid).then(function(fs){
      fs = fs || [];
      var f = null, i;
      for (i = 0; i < fs.length; i++) if (fs[i].path === entry.path) f = fs[i];
      if (!f){ UI.toast('文件不存在（可能已删除）：' + entry.path, true); pvClose(); return; }
      pv = { sid: entry.sid, path: entry.path }; /* 先置 pv：open()→renderWs 才能高亮当前预览行 */
      open();
      cur = { kind: pvKind(entry.path) === 'src' ? pvExt(entry.path) : pvKind(entry.path), code: f.content || '' }; // 顶部「下载」可用
      curNonce = uuid(); /* 换 nonce：旧 iframe 迟到消息丢弃 */
      var bar = $('#rn-pvbar'), pl = $('#pv-path');
      if (bar){ bar.hidden = false; }
      if (pl){ pl.textContent = pv.path; pl.title = pv.path + '（' + sizeFmt(f.size || 0) + '）'; }
      srcEl.hidden = true; srcEl.textContent = '';
      frame.style.display = 'block'; emptyEl.hidden = true;
      statusEl.textContent = '预览';
      kindEl.textContent = pvKind(pv.path) === 'src' ? pvExt(pv.path) : pvKind(pv.path);
      pvBarSync();
      /* v1.1.22：二进制原文件（图片可预览；PDF/Office/压缩包提示下载） */
      if (f.binary){
        var _bx = pvExt(f.path), _bm = f.mime || '';
        var _isImg = (/^image\//.test(_bm) || /^(png|jpe?g|gif|webp|bmp|ico|tiff?)$/i.test(_bx));
        cur = { kind: _bx || 'bin', code: '', blob: null };
        if (f.attachmentId){
          DB.getAttachment(f.attachmentId).then(function(a){
            if (!a) { UI.toast('原文件已不存在（附件可能已删除）', true); return; }
            cur.blob = a.rawBlob || a.blob;
            if (_isImg && a.blob) return blobToDataURL(a.blob).then(function(url){
              frame.style.display = 'block'; srcEl.hidden = true; srcEl.textContent = '';
              frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#111}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100vh;display:block}</style></head><body><img src="' + url + '" alt=""></body></html>';
              statusEl.textContent = '图片';
              pvBarSync();
            });
          }).catch(function(){});
        }
        if (_isImg) return;
        frame.style.display = 'none'; srcEl.hidden = false;
        srcEl.className = 'rn-src';
        var _bt = (_bm && !/^text\/plain/i.test(_bm)) ? _bm : (_bx || '二进制');
        srcEl.textContent = '二进制原文件：' + f.path + '\n大小：' + sizeFmt(f.size || 0) + '\n类型：' + _bt + '\n\n请在右侧工作区点「下载」后用本地应用打开。';
        statusEl.textContent = '原文件';
        pvBarSync();
        return;
      }
      if (pvKind(pv.path) === 'src'){ /* 非可渲染文本：源码视图 */
        frame.style.display = 'none'; srcEl.hidden = false;
        var _ext = pvExt(pv.path);
        var _bin = /^(png|jpe?g|gif|webp|bmp|ico|tiff?|pdf|pptx?|docx?|xlsx?|zip|rar|7z|gz|tar|mp3|wav|flac|mp4|mov|webm|mkv|exe|dll|so|bin)$/i.test(_ext);
        if (_bin){
          srcEl.className = 'rn-src';
          srcEl.textContent = '「.' + _ext + '」暂不支持在侧栏预览。\n\n请点工具栏的「下载」保存到本地后打开。';
          statusEl.textContent = '不支持预览';
          pvBarSync();
          return;
        }
        var _doc = /^(txt|text|log|csv|tsv)$/i.test(_ext);
        srcEl.className = 'rn-src' + (_doc ? ' is-doc' : '');
        srcEl.textContent = f.content || '';
        statusEl.textContent = _doc ? '文本' : '源码';
        return;
      }
      frame.srcdoc = pvDoc(f, fs);
    });
  }
  function previewTo(sid, path, push){
    setTab('view'); // v0.2.5：预览属于「运行」分栏
    if (push && pv && (pv.sid !== sid || pv.path !== path)){
      pvBack.push({ sid: pv.sid, path: pv.path });
      if (pvBack.length > 50) pvBack.shift();
      pvFwd.length = 0;
    }
    pvRender({ sid: sid, path: path });
  }
  function pvGoBack(){ if (!pvBack.length) return; if (pv) pvFwd.push({ sid: pv.sid, path: pv.path }); pvRender(pvBack.pop()); }
  function pvGoFwd(){ if (!pvFwd.length) return; if (pv) pvBack.push({ sid: pv.sid, path: pv.path }); pvRender(pvFwd.pop()); }
  function pvClose(){ pv = null; pvBack.length = 0; pvFwd.length = 0;
    var bar = $('#rn-pvbar'); if (bar) bar.hidden = true;
    pvBarSync();
    if (bound){ frame.style.display = 'none'; srcEl.hidden = true; srcEl.textContent = ''; emptyEl.hidden = false; statusEl.textContent = '控制台'; kindEl.textContent = ''; renderWs(); } /* v2.5：刷新列表以清掉 pv-on 高亮 */ }
  /* 预览中的文本文件：源码视图（Work 产物非 html/svg/md 时用） */
  function previewSource(sid, path){
    bindOnce();
    DB.workfsBySid(sid).then(function(fs){
      var f = null, i;
      for (i = 0; i < fs.length; i++) if (fs[i].path === path) f = fs[i];
      if (!f){ UI.toast('文件不存在（可能已删除）：' + path, true); return; }
      open(); setTab('view');
      pv = null; pvBarSync();
      var bar = $('#rn-pvbar'); if (bar) bar.hidden = true;
      cur = { kind: pvExt(path) || 'txt', code: f.content || '' };
      curNonce = uuid();
      killFrame();
      srcEl.hidden = false; srcEl.textContent = f.content || '';
      frame.style.display = 'none'; emptyEl.hidden = true;
      statusEl.textContent = '源码 · ' + path;
      kindEl.textContent = pvExt(path) || 'txt';
    });
  }
  /* AI 改写了当前预览的文件 → 自动刷新（防抖；Work 执行期间由 capFinish 后恢复） */
  function previewRefreshIf(sid, path){
    if (!pv || pv.sid !== sid || pv.path !== path) return;
    if (cap && !cap.done) return; /* 沙箱执行中不抢 iframe，capFinish 会恢复预览 */
    if (pvTmr) clearTimeout(pvTmr);
    pvTmr = setTimeout(function(){ pvTmr = null; if (pv) pvRender({ sid: pv.sid, path: pv.path }); }, 250);
  }

  function bindOnce(){
  setTimeout(function(){ try { bindWeb(); } catch (e) {} }, 0);
    if (bound) return; bound = true;
    frame = $('#rn-frame'); out = $('#rn-out'); srcEl = $('#rn-src');
    emptyEl = $('#rn-empty'); kindEl = $('#rn-kind'); statusEl = $('#rn-status');
    window.addEventListener('message', function(e){
      var d = e.data;
      if (!d) return;
      /* v3.0 #18：只接受当前沙箱 iframe 发来的消息（sandbox 无 same-origin → origin 为 'null'，
         因此用 source 比对；其它窗口/扩展注入的 message 直接丢弃） */
      var _fr = $('#rn-frame');
      if (!_fr || e.source !== _fr.contentWindow) return;
      if (d.__scpvnav === 1){ /* v2.5：预览页内相对链接 → VFS 多页跳转 */
        if (!pv) return;
        var dir = pv.path.indexOf('/') >= 0 ? pv.path.slice(0, pv.path.lastIndexOf('/')) : '';
        var np = pvResolve(dir, String(d.href || ''));
        if (!np){ UI.toast('链接超出工作区范围：' + String(d.href || '').slice(0, 60), true); return; }
        previewTo(pv.sid, np, true);
        return;
      }
      if (d.__scpvext === 1){ UI.toast('预览沙箱不打开外链：' + String(d.href || '').slice(0, 60)); return; }
      if (d.__scrun !== 1) return;
      if (String(d.nonce || '') !== curNonce) return; /* 残留 iframe 串台防护（v2.0）：nonce 不匹配直接丢弃 */
      if (d.type === 'ready') return;
      var txt = String(d.text == null ? '' : d.text);
      line(d.type === 'error' ? 'rn-err' : (d.type === 'warn' ? 'rn-warn' : ''), txt);
      if (cap) capFeed(txt, d.type === 'error');
    });
    /* v0.2.5：抽屉底边 = 输入框上沿，面板悬浮但不压住输入框 */
    var compEl = $('#composer');
    function syncRnBottom(){
      if (!compEl) return;
      var h = compEl.getBoundingClientRect().height || 0;
      document.documentElement.style.setProperty('--rn-b', Math.max(8, Math.round(h) + 8) + 'px');
    }
    if (compEl && window.ResizeObserver){
      new ResizeObserver(syncRnBottom).observe(compEl);
    }
    syncRnBottom();
    window.addEventListener('resize', syncRnBottom);
    $('#rn-close').addEventListener('click', close);
    var _rmax = $('#rn-max'); if (_rmax) _rmax.addEventListener('click', toggleMax);
    var _rref = $('#rn-refresh'); if (_rref) _rref.addEventListener('click', reloadPanel);
    (function(){
      var rail = document.getElementById('rn-rail');
      if (!rail) return;
      rail.addEventListener('click', function(e){
        var b = e.target.closest('[data-rn]'); if (!b) return;
        if ((S.cfg.mode || 'chat') === 'chat'){ UI.toast('右侧面板是 Work / Agent 专用'); return; }
        setTab(b.getAttribute('data-rn'));
        open();
      });
    })();
    var pbtn = $('#btn-panel');
    if (pbtn) pbtn.addEventListener('click', function(){
      if ((S.cfg.mode || 'chat') === 'chat'){ UI.toast('右侧面板是 Work / Agent 专用'); return; }
      if (document.body.classList.contains('rn-open')) close(); else open();
    });
    document.addEventListener('keydown', function(e){
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'j' || e.key === 'J')){
        e.preventDefault();
        if ((S.cfg.mode || 'chat') === 'chat'){ UI.toast('右侧面板是 Work / Agent 专用'); return; }
        if (document.body.classList.contains('rn-open')) close(); else open();
      }
    });
    /* v0.2.5：顶部分栏切换 */
    var wsList = $('#rn-ws-list');
    if (wsList) wsList.addEventListener('click', function(e){
      var t = e.target.closest('[data-ag-dir],[data-ag-view],[data-ag-del],[data-ag-up],[data-ag-refresh],[data-ag-pick],[data-ag-close]');
      if (!t) return;
      if (t.hasAttribute('data-ag-pick')){ UI.pickWorkspace && UI.pickWorkspace(); return; }
      if (t.hasAttribute('data-ag-close')){ var vb = $('#rn-ws-view'); if (vb) vb.hidden = true; return; }
      if (t.hasAttribute('data-ag-up')){
        var parts = agentPath.split('/'); parts.pop(); agentPath = parts.join('/'); renderWs(); return;
      }
      if (t.hasAttribute('data-ag-refresh')){ renderWs(); return; }
      if (t.hasAttribute('data-ag-dir')){
        agentPath = agentPath ? (agentPath + '/' + t.getAttribute('data-ag-dir')) : t.getAttribute('data-ag-dir');
        renderWs(); return;
      }
      if (t.hasAttribute('data-ag-view')){ agentView(t.getAttribute('data-ag-view')); return; }
      if (t.hasAttribute('data-ag-del')){ agentDel(t.getAttribute('data-ag-del')); return; }
    });
    var rnTabs = $('#rn-tabs');
    if (rnTabs) rnTabs.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('.rn-tab') : null;
      if (!b) return;
      setTab(b.getAttribute('data-rt'));
      if (b.getAttribute('data-rt') === 'view' && pv) pvRender({ sid: pv.sid, path: pv.path });
    });
    /* v1.1.19：运行/终端已从顶部分栏移除，不再作为启动恢复项；
       它们只在文件预览/运行或右侧竖栏点击时进入。 */
    try {
      var lastTab = localStorage.getItem('sc.rn.tab');
      if (lastTab && ['ws', 'web', 'src'].indexOf(lastTab) >= 0) $('#runner').setAttribute('data-tab', lastTab);
      else $('#runner').setAttribute('data-tab', 'ws');
    } catch(e){}
    $('#rn-clear').addEventListener('click', clearOut);
    $('#rn-restart').addEventListener('click', function(){ if (cur) run(cur.kind, cur.code, true); });
    var dlBtn = $('#rn-dl');
    if (dlBtn) dlBtn.addEventListener('click', function(){ RUNNER.download(); });

    /* --- 工作区区（v2.1）--- */
    var zipBtn = $('#rn-ws-zip');
    if (zipBtn) zipBtn.addEventListener('click', function(){ UI.zipVfs(); });


    /* --- v2.5：预览工具条（后退/前进/刷新/关闭）--- */
    var pbb = $('#pv-back'), pfb = $('#pv-fwd'), prb = $('#pv-reload'), pcb = $('#pv-close');
    if (pbb) pbb.addEventListener('click', pvGoBack);
    if (pfb) pfb.addEventListener('click', pvGoFwd);
    if (prb) prb.addEventListener('click', function(){ if (pv) pvRender({ sid: pv.sid, path: pv.path }); });
    if (pcb) pcb.addEventListener('click', pvClose);


    /* v1.2：左右两侧同宽 —— 抽屉默认宽度 = (视口 - 正文列)/3，夹在 300~420；拖过就记住自定义宽度 */
var _customW = null;
/* v1.1.17：启动时不再恢复上次拖宽的尺寸，默认固定 390；手动拖宽仍可到 2400。
   这样“默认宽度”受控，但不会限制用户主动展开。 */
try { localStorage.removeItem('sc.rn.w2'); } catch(e) {}
function fitSide(){
  var cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--content-w')) || 780;
  var w = clampW(_customW || Math.round(cw / 2));
  document.documentElement.style.setProperty('--side-w', w + 'px');
  return w;
}

/* --- 左缘拖宽（300~2400px，双击复位，持久化；拖动时左侧栏一起同步宽度）--- */
    var rz = $('#rn-resize'), runner = $('#runner'), drag = null;
    var W_MIN = 300, W_MAX = 2400;
    /* v1.1.17：只限制“默认宽度”（390），不限制手动拖宽。
       拖到 2400 或双击复位都保留；最大化按钮另外提供全宽。 */
    function clampW(w){ return Math.max(W_MIN, Math.min(W_MAX, Math.round(w))); }
    function setW(w){
  if (document.body.classList.contains('rn-max')) document.body.classList.remove('rn-max');
  var n = clampW(w);
  runner.style.width = n + 'px';
  document.documentElement.style.setProperty('--side-w', n + 'px');
  return n;
}
    function resetW(){
  _customW = null; runner.style.width = '';
  try { localStorage.removeItem('sc.rn.w2'); } catch(e){}
  fitSide();
}
    if (_customW){ setW(_customW); } else fitSide();
    window.addEventListener('resize', function(){
      if (document.body.classList.contains('rn-max')) return;
      if (_customW) setW(_customW); else fitSide();
    });
    if (rz){
      rz.addEventListener('mousedown', function(e){
        if (e.button !== 0) return;
        drag = { x: e.clientX, w: runner.getBoundingClientRect().width };
        document.body.classList.add('rn-dragging');
        e.preventDefault();
      });
      rz.addEventListener('dblclick', resetW);
    }
    window.addEventListener('mousemove', function(e){
      if (!drag) return;
      setW(drag.w + (drag.x - e.clientX)); /* 把手在左缘：左移变宽 */
    });
    window.addEventListener('mouseup', function(){
      if (!drag) return;
      drag = null;
      document.body.classList.remove('rn-dragging');
      try { _customW = setW(runner.getBoundingClientRect().width); } catch(e){}
    });
  }

  function runCInto(code){
    var t0 = Date.now(), res;
    try { res = runC(code); }
    catch (e){ res = { output: '', error: '解释器异常：' + ((e && e.message) || String(e)) }; }
    if (res.output) line('', res.output.replace(/\n$/, ''));
    if (res.error) line('rn-err', '✗ ' + res.error);
    else line('rn-note', '✓ 运行结束（' + (Date.now() - t0) + ' ms，int/char 子集，printf 内建）');
    return { ok: !res.error, output: (res.output || '').replace(/\n$/, ''), error: res.error || '', ms: Date.now() - t0 };
  }

  /* ---- v2.0：捕获态（Work 循环用）——收集输出 + 截断 + 空闲判定完成 ---- */
  function capFeed(txt, isErr){
    if (!cap || cap.done) return;
    if (cap.lines.length >= LIMITS.WORK_OUT_LINES || cap.chars >= LIMITS.WORK_OUT_CHARS){ cap.cut = true; return; }
    cap.lines.push((isErr ? '✗ ' : '') + txt);
    cap.chars += txt.length + 1;
    if (isErr){ cap.errs = true; if (!cap.errText) cap.errText = txt.slice(0, 300); }
    /* 有输出即认为"还在跑"，重置空闲计时 */
    if (cap.idle) clearTimeout(cap.idle);
    cap.idle = setTimeout(capFinish, 350); /* 空闲 350ms 视为运行结束（JS/CSS/HTML 无显式完成信号） */
  }
  function capFinish(){
    if (!cap || cap.done) return;
    cap.done = true;
    if (cap.idle) clearTimeout(cap.idle);
    if (cap.tmo) clearTimeout(cap.tmo);
    killFrame(); /* 结束即拆 iframe：不留后台定时器/动画 */
    var r = { ok: !cap.errs, output: cap.lines.join('\n'), error: cap.errs ? (cap.errText || '运行有错误输出') : '',
              ms: Date.now() - cap.t0, cut: cap.cut };
    var res = cap.res; cap = null;
    if (res) res(r);
    if (pv) pvRender({ sid: pv.sid, path: pv.path }); /* v2.5：Work 执行结束 → 恢复被占用的预览 */
  }
  /* 超时强杀：移除 iframe 节点并重建空 iframe（无 onbeforeunload，只能物理拆） */
  function killFrame(){
    if (!frame) return;
    var nf = document.createElement('iframe');
    nf.id = 'rn-frame'; nf.setAttribute('sandbox', 'allow-scripts'); nf.title = '沙箱预览';
    frame.parentNode.replaceChild(nf, frame);
    frame = nf;
  }

  function run(kind, code, silent){
    bindOnce();
    if (pv) pvClose(); /* v2.5：手动运行代码块 → 退出文件预览，避免工具条与画面不符 */
    cur = { kind: kind, code: code };
    curNonce = uuid(); /* 每次运行换 nonce：旧 iframe 的迟到消息一律丢弃 */
    open();
    kindEl.textContent = kind === 'c' ? 'C' : kind;
    clearOut();
    setTab(kind === 'c' ? 'out' : 'view'); // v0.2.5：C 是纯控制台输出，其余先看画面
    if (kind === 'c'){
      srcEl.hidden = false; srcEl.textContent = code;
      frame.style.display = 'none';
      emptyEl.hidden = true;
      statusEl.textContent = '程序输出';
      runCInto(code);
      return;
    }
    srcEl.hidden = true; srcEl.textContent = '';
    frame.style.display = 'block';
    emptyEl.hidden = true;
    statusEl.textContent = '控制台';
    if (!silent) line('rn-note', '▶ 沙箱预览已运行（禁外网，console 输出见下）');
    frame.srcdoc = buildDoc(kind, code, curNonce);
  }

  /* v2.0：捕获式运行（Work 循环用）——Promise 返回结构化结果 */
  function runCapture(kind, code, showPanel){
    bindOnce();
    cur = { kind: kind, code: code };
    curNonce = uuid();
    if (showPanel !== false) open(); // v2.2：后台会话执行时不抢运行面板（iframe 隐藏也能执行）
    kindEl.textContent = kind === 'c' ? 'C' : kind;
    clearOut();
    if (kind === 'c'){
      srcEl.hidden = false; srcEl.textContent = code; frame.style.display = 'none'; emptyEl.hidden = true;
      statusEl.textContent = '程序输出';
      var rc = runCInto(code);
      rc.cut = false;
      return Promise.resolve(rc);
    }
    return new Promise(function(res){
      cap = { lines: [], chars: 0, cut: false, errs: false, errText: '', t0: Date.now(), done: false, res: res, idle: null, tmo: null };
      srcEl.hidden = true; srcEl.textContent = '';
      frame.style.display = 'block'; emptyEl.hidden = true;
      statusEl.textContent = '控制台';
      line('rn-note', '▶ Work 沙箱执行中（禁外网/禁磁盘）');
      if (LIMITS.WORK_RUN_MS > 0){
        cap.tmo = setTimeout(function(){ /* 可选硬超时（默认已关闭） */
          if (!cap || cap.done) return;
          line('rn-err', '✗ 超时（' + (LIMITS.WORK_RUN_MS / 1000) + 's）已强制终止');
          cap.lines.push('…（执行超时已强制终止）');
          capFinish();
        }, LIMITS.WORK_RUN_MS);
        cap.idle = setTimeout(capFinish, LIMITS.WORK_RUN_MS);
      }
      /* v1.1.24：无硬超时后，用 iframe load + 短空闲判定完成：
         同步长脚本在 load 前跑完；有 console 输出时 capFeed 会重置空闲计时。 */
      frame.onload = function(){
        if (!cap || cap.done) return;
        if (cap.idle) clearTimeout(cap.idle);
        cap.idle = setTimeout(capFinish, 800);
      };
      frame.srcdoc = buildDoc(kind, code, curNonce);
    });
  }

  /* v2.0：复位（切换/删除会话时调用，拆沙箱清状态，零遗留） */
  function reset(){
    if (cap && !cap.done){ cap.done = true; if (cap.idle) clearTimeout(cap.idle); if (cap.tmo) clearTimeout(cap.tmo);
      var r = cap.res; cap = null; if (r) r({ ok: false, output: '', error: '已中止（会话切换/删除）', ms: 0, cut: false }); }
    cur = null; curNonce = uuid();
    if (pvTmr){ clearTimeout(pvTmr); pvTmr = null; }
    killFrame();
    if (bound){ clearOut(); srcEl.textContent = ''; pvClose(); renderWs(); } /* v2.5：pvClose 清预览态/工具条 */
  }

  function dlExt(kind){ return kind === 'c' ? 'c' : (kind || 'html'); }
  /* v2.0：下载当前运行产物（源码按类型落扩展名） */
  function download(){
    if (!cur){ UI.toast('还没有可下载的运行产物', true); return; }
    var name = 'sandbox-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.' + dlExt(cur.kind);
    var blob = cur.blob || new Blob([cur.code], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
    UI.toast('已下载 ' + name);
  }

  /* v2.8：工作区文件 → 在沙箱里直接运行（html/js/css/svg 走 iframe 预览，c 走解释器） */
  function runVfs(sid, path){
    var kind = crKind(pvExt(path));
    if (!kind){ UI.toast('该文件类型不支持运行：' + path, true); return; }
    DB.workfsBySid(sid || S.sid).then(function(fs){
      var f = null, i;
      for (i = 0; i < fs.length; i++) if (fs[i].path === path) f = fs[i];
      if (!f){ UI.toast('文件不存在（可能已删除）：' + path, true); return; }
      run(kind, f.content || '');
    });
  }

  /* v1.29.0：研究来源（本会话）—— 只记真实跑过的 search / web，失败也记 */
  var SRCS = [];
  function addSources(q, items, ok, err){
    var arr = (items || []).map(function(x){
      return { t: String((x && (x.t || x.title || x.name)) || ''), u: String((x && (x.u || x.url || x.link)) || ''), s: String((x && (x.snippet || x.desc)) || '') };
    }).filter(function(x){ return x.u; });
    SRCS.unshift({ q: String(q || ''), ts: Date.now(), ok: ok !== false, err: String(err || ''), items: arr });
    if (SRCS.length > 40) SRCS.length = 40;
    try { renderSrc(); } catch (e) {}
  }
  function renderSrc(){
    var list = document.getElementById('rn-src-list'); if (!list) return;
    var cnt = document.getElementById('rn-src-count');
    if (cnt) cnt.textContent = SRCS.length ? ('（' + SRCS.reduce(function(a, b){ return a + b.items.length; }, 0) + '）') : '';
    list.textContent = '';
    if (!SRCS.length){
      list.appendChild(el('div', { class: 'hint', text: '还没有来源。开着联网搜索，或在 Work / Agent 里让模型用 search / web 抓取后，这里会按查询列出每条来源和抓取状态。' }));
      return;
    }
    SRCS.forEach(function(g){
      var box = el('div', { class: 'src-grp' });
      box.appendChild(el('div', { class: 'src-q' }, [
        el('span', { class: 'src-qt', text: g.q || '（未命名查询）' }),
        el('span', { class: 'hint', text: ' ' + new Date(g.ts).toLocaleTimeString() })
      ]));
      if (!g.ok) box.appendChild(el('div', { class: 'src-bad', text: '这次没拿到正文' + (g.err ? '：' + g.err : '') }));
      if (!g.items.length && g.ok) box.appendChild(el('div', { class: 'hint', text: '搜索返回 0 条' }));
      g.items.forEach(function(it){
        var row = el('div', { class: 'src-row' });
        var a = el('a', { class: 'src-t', href: '#', text: it.t || it.u, title: it.t || it.u });
        a.addEventListener('click', function(ev){
          ev.preventDefault();
          /* v1.1.13：来源链接也先进侧栏；侧栏不可用才退回独立窗口 */
          var _ok = false;
          try { _ok = openWeb(it.u); } catch (e) { _ok = false; }
          if (!_ok){ try { NET.openExternal(it.u, 'window'); } catch (e) {} }
        });
        row.appendChild(a);
        row.appendChild(el('span', { class: 'src-u', text: it.u.length > 64 ? it.u.slice(0, 64) + '…' : it.u }));
        box.appendChild(row);
      });
      list.appendChild(box);
    });
  }

  return { run: run, runCapture: runCapture, close: close, open: open, reset: reset, download: download, runVfs: runVfs,
    openWeb: openWeb, renderWs: renderWs, setTab: setTab, syncForSession: syncForSession, addSources: addSources, renderSrc: renderSrc, srcs: function(){ return SRCS; }, open: open, close: close, curKind: function(){ return cur && cur.kind; },
    previewTo: previewTo, previewSource: previewSource, pvKind: pvKind, previewRefreshIf: previewRefreshIf,
    webHostHide: webHostHide, webHostRestore: webHostRestore }; /* v2.5/v2.8 · v1.1.8 弹窗/灯箱让位 */
})();

/* ==== 运行面板注入结束 ==== */

/* v2.1：流式增量渲染——未闭合代码围栏临时补一个闭合标记，避免半截代码块渲染错乱 */
function mdStream(acc){
  var t = acc;
  if (((t.match(/```/g) || []).length % 2) === 1) t += '\n```';
  return MD.render(t, { noMedia: 'stream' }); // C3：流式期远程媒体仍延后，未闭合围栏先闭合，避免闪成裸文本
}

/* 文档解析（v1.4）：docx/xlsx/pptx = zip + 原生 DecompressionStream 解压；
   pdf = 尽力而为（解 Flate 流再取 Tj/TJ 字面串，扫描版需先 OCR）；rtf = 控制字剥离。
   零依赖：ZIP 中央目录手写解析，无任何外部库。 */
var DOC_EXT = { docx: 1, xlsx: 1, pptx: 1, pdf: 1, rtf: 1 };
var DOC = (function(){
  function inflateFmt(u8, fmt){
    if (typeof DecompressionStream === 'undefined')
      return Promise.reject(new Error('当前环境不支持解压'));
    var ds = new DecompressionStream(fmt);
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function(ab){ return new Uint8Array(ab); });
  }
  function inflateRaw(u8){ return inflateFmt(u8, 'deflate-raw'); }           // zip 本地项：裸 deflate
  function inflateAuto(u8){                                                  // PDF FlateDecode：多为 zlib 包裹，失败再试裸 deflate
    return inflateFmt(u8, 'deflate').catch(function(){ return inflateFmt(u8, 'deflate-raw'); });
  }
  function findEOCD(u8){ /* zip 末尾中央目录结束记录 0x06054b50，向前扫 64KB+22 */
    for (var i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65536; i--)
      if (u8[i] === 0x50 && u8[i+1] === 0x4b && u8[i+2] === 0x05 && u8[i+3] === 0x06) return i;
    return -1;
  }
  function unzip(buf){
    var u8 = new Uint8Array(buf), dv = new DataView(buf);
    var e = findEOCD(u8);
    if (e < 0) return Promise.reject(new Error('不是有效的 zip/office 文档'));
    var n = dv.getUint16(e + 10, true), off = dv.getUint32(e + 16, true);
    var names = [], jobs = [];
    for (var i = 0; i < n; i++){
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true),
          nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true),
          cl = dv.getUint16(off + 32, true), lo = dv.getUint32(off + 42, true);
      var name = new TextDecoder('utf-8').decode(u8.subarray(off + 46, off + 46 + nl));
      off += 46 + nl + el + cl;
      if (dv.getUint32(lo, true) !== 0x04034b50) continue; /* 本地头 */
      var ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      var raw = u8.subarray(ds, ds + csize);
      names.push(name);
      jobs.push(method === 0 ? Promise.resolve(raw) : inflateRaw(raw).catch(function(){ return null; }));
    }
    return Promise.all(jobs).then(function(list){
      var map = {};
      for (var j = 0; j < list.length; j++) if (list[j]) map[names[j]] = list[j];
      return map;
    });
  }
  function decodeEnt(s){
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#x([0-9a-fA-F]+);/g, function(m, h){ return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function(m, d){ return String.fromCharCode(+d); })
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function stripTags(x){ return String(x).replace(/<[^>]+>/g, ''); }
  function xml(u8){ return new TextDecoder('utf-8').decode(u8); }
  function uniqNum(map, re){ /* zip 条目按序号排序（slide3 < slide10） */
    return Object.keys(map).filter(function(k){ return re.test(k); }).sort(function(a, b){
      return (+re.exec(a)[1]) - (+re.exec(b)[1]);
    });
  }
  function parseDocx(map){
    var d = map['word/document.xml'];
    if (!d) return Promise.reject(new Error('docx 缺少 word/document.xml'));
    var x = xml(d).replace(/<\/w:p>/g, '\n').replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:br\b[^>]*\/>/g, '\n');
    return Promise.resolve(decodeEnt(stripTags(x)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  function parsePptx(map){
    var re = /^ppt\/slides\/slide(\d+)\.xml$/;
    var keys = uniqNum(map, re);
    if (!keys.length) return Promise.reject(new Error('pptx 未找到幻灯片'));
    var out = [];
    keys.forEach(function(k, i){
      var x = xml(map[k]).replace(/<\/a:p>/g, '\n');
      var t = decodeEnt(stripTags(x)).trim();
      if (t) out.push('【幻灯片 ' + (i + 1) + '】\n' + t);
    });
    return Promise.resolve(out.join('\n\n'));
  }
  function parseXlsx(map){
    var ss = [], ssx = map['xl/sharedStrings.xml'];
    if (ssx){
      var sx = xml(ssx), siRe = /<si>([\s\S]*?)<\/si>/g, m;
      while ((m = siRe.exec(sx))){
        var t = '', tRe = /<t[^>]*>([\s\S]*?)<\/t>/g, tm;
        while ((tm = tRe.exec(m[1]))) t += decodeEnt(tm[1]);
        ss.push(t);
      }
    }
    var keys = uniqNum(map, /^xl\/worksheets\/sheet(\d+)\.xml$/);
    if (!keys.length && !ss.length) return Promise.reject(new Error('xlsx 未找到工作表'));
    var out = [];
    keys.forEach(function(k, i){
      var x = xml(map[k]), rows = [], rRe = /<row[^>]*>([\s\S]*?)<\/row>/g, rm;
      while ((rm = rRe.exec(x))){
        var cells = [], cRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g, cm;
        while ((cm = cRe.exec(rm[1]))){
          var attrs = cm[1] || cm[2] || '', body = cm[3] || '', ty = /t="([^"]+)"/.exec(attrs), val = '';
          var v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body);
          if (ty && ty[1] === 's' && v) val = ss[+v[1]] != null ? ss[+v[1]] : '';
          else if (ty && ty[1] === 'inlineStr'){ var it = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body); val = it ? decodeEnt(it[1]) : ''; }
          else if (v) val = decodeEnt(v[1]);
          cells.push(val);
        }
        if (cells.join('').replace(/\t/g, '')) rows.push(cells.join('\t'));
      }
      if (rows.length) out.push('【工作表 ' + (i + 1) + '】\n' + rows.join('\n'));
    });
    return Promise.resolve(out.join('\n\n').trim());
  }
  function pdfStr(lit){ /* "(…)Tj" 字面串 → 文本（处理 \n \t \( \\ \ddd 八进制） */
    var body = lit.slice(1, lit.lastIndexOf(')')), out = '', i = 0;
    while (i < body.length){
      var c = body[i];
      if (c === '\\'){
        var nx = body[i + 1];
        if (nx >= '0' && nx <= '7'){
          var oc = /^[0-7]{1,3}/.exec(body.slice(i + 1));
          out += String.fromCharCode(parseInt(oc[0], 8)); i += 1 + oc[0].length;
        } else {
          out += nx === 'n' ? '\n' : nx === 'r' ? '\r' : nx === 't' ? '\t' :
                 (nx === '(' || nx === ')' || nx === '\\') ? nx : '';
          i += 2;
        }
      } else { out += c; i++; }
    }
    return out;
  }
  function pdfExtract(u8){
    var s = new TextDecoder('latin1').decode(u8); /* 字节↔字符 1:1，仅用于定位 stream 边界 */
    var stRe = /stream\r?\n?/g, m, jobs = [];
    function pushJob(st, en){ /* 独立参数捕获，避免 var 循环变量被闭包共享（实测踩过一次） */
      while (en > st && (u8[en - 1] === 0x0A || u8[en - 1] === 0x0D)) en--; // 去 endstream 前 EOL（尾随垃圾字节会让 Chromium 解压失败）
      jobs.push(inflateAuto(u8.subarray(st, en))
        .catch(function(){ return inflateAuto(u8.subarray(st, en - 1)); }) // 再退一格容错
        .catch(function(){ return null; }));
    }
    while ((m = stRe.exec(s))){
      if (m.index > 0 && s[m.index - 1] === 'd') continue; // "endstream" 的尾部匹配，跳过
      var start = m.index + m[0].length, end = s.indexOf('endstream', start);
      if (end < 0) break;
      stRe.lastIndex = end;
      if (!/FlateDecode/.test(s.slice(Math.max(0, m.index - 400), m.index))) continue;
      pushJob(start, end);
    }
    return Promise.all(jobs).then(function(list){
      var lines = [];
      for (var i = 0; i < list.length; i++){
        if (!list[i]) continue;
        var t = new TextDecoder('latin1').decode(list[i]);
        var opRe = /\[((?:\((?:\\[\s\S]|[^\\()])*\)|[^\]])*)\]\s*TJ|\((?:\\[\s\S]|[^\\()])*\)\s*(?:Tj|')/g, om;
        while ((om = opRe.exec(t))){
          if (om[1] != null){
            var arr = om[1], sr = /\((?:\\[\s\S]|[^\\()])*\)/g, sm, part = '';
            while ((sm = sr.exec(arr))) part += pdfStr(sm[0]);
            if (part) lines.push(part);
          } else {
            var lit = om[0].slice(0, om[0].lastIndexOf(')') + 1), q = pdfStr(lit);
            if (q) lines.push(q);
          }
        }
      }
      var txt = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!txt) return Promise.reject(new Error('未能提取文本（扫描版 PDF 需先 OCR）'));
      return txt;
    });
  }
  function parseRtf(file){
    return file.text().then(function(t){
      var s = t.replace(/\{\\\*(\\[a-zA-Z]+)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')  /* 目的地/元数据组 */
        .replace(/\\'([0-9a-fA-F]{2})/g, ' ')                                   /* 十六进制转义（近似丢弃） */
        .replace(/\\u(-?\d+)\s*\??/g, function(m, d){ var c = +d; return String.fromCharCode(c < 0 ? c + 65536 : c); })
        .replace(/\\par[d]?\b|\\line\b/g, '\n').replace(/\\tab\b/g, '\t')
        .replace(/\\[a-zA-Z]+-?\d*\s?/g, '').replace(/[{}]/g, '');
      return s.replace(/\n{3,}/g, '\n\n').trim();
    });
  }
  function parse(file){
    var mm = /\.([a-z0-9]+)$/i.exec(file.name || '');
    var ext = mm ? mm[1].toLowerCase() : ''; // DOC 独立取扩展名（extOf 在 UI 作用域内，不可跨模块引用）
    if (ext === 'pdf')
      return file.arrayBuffer().then(function(b){
        var u8 = new Uint8Array(b);
        if (OCR.active() && OCR.cfg().always) return OCR.parsePdf(file); // v1.5：强制 OCR 模式
        function ocrFallback(){ // 无文本层/文本过少 → 判定扫描版，交专用 OCR 模型
          if (!OCR.active())
            return Promise.reject(new Error('未能提取文本（扫描版 PDF，在 设置 → 文档解析 选一个 OCR 引擎即可自动识别）'));
          if (typeof UI !== 'undefined' && UI.toast) UI.toast('PDF 无文本层，改用 OCR 识别：' + file.name);
          return OCR.parsePdf(file);
        }
        return pdfExtract(u8).then(function(t){
          return (t && t.replace(/\s/g, '').length >= 50) ? t : ocrFallback(); // 文本层过少同样视为扫描版
        }, ocrFallback);
      });
    if (ext === 'rtf') return parseRtf(file);
    return file.arrayBuffer().then(function(buf){
      return unzip(buf).then(function(map){
        if (ext === 'docx') return parseDocx(map);
        if (ext === 'pptx') return parsePptx(map);
        if (ext === 'xlsx') return parseXlsx(map);
        throw new Error('不支持的文档格式：.' + ext);
      });
    });
  }
  return { parse: parse, exts: 'docx/xlsx/pptx/pdf/rtf' };
})();

/* 页内 ZIP 打包（v2.0）：STORE 不压缩 + CRC32 查表，全程内存零临时文件。
   输入 [{name, data(string|Uint8Array)}] → Blob。 */
var ZIP = (function(){
  var TBL = (function(){ /* CRC32 标准查表 */
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++){
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8){
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = TBL[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(d){
    return { t: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31),
             dt: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31) };
  }
  function pack(entries){ /* entries: [{name, data}] → Blob(zip) */
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var now = dosTime(new Date());
    entries.forEach(function(e){
      var nameU8 = enc.encode(e.name);
      var dataU8 = (typeof e.data === 'string') ? enc.encode(e.data) : e.data;
      var crc = crc32(dataU8), n = nameU8.length, sz = dataU8.length;
      var lh = new Uint8Array(30 + n), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);      /* 本地头签名 */
      dv.setUint16(4, 20, true);              /* 版本 */
      dv.setUint16(6, 0x0800, true);          /* UTF-8 文件名标志 */
      dv.setUint16(8, 0, true);               /* 方法：STORE */
      dv.setUint16(10, now.t, true); dv.setUint16(12, now.dt, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, sz, true); dv.setUint32(22, sz, true);
      dv.setUint16(26, n, true); dv.setUint16(28, 0, true);
      lh.set(nameU8, 30);
      parts.push(lh, dataU8);
      var ch = new Uint8Array(46 + n), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);      /* 中央目录签名 */
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, now.t, true); cv.setUint16(14, now.dt, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, sz, true); cv.setUint32(24, sz, true);
      cv.setUint16(28, n, true);
      cv.setUint32(42, offset, true);          /* 本地头偏移 */
      ch.set(nameU8, 46);
      central.push(ch);
      offset += 30 + n + sz;
    });
    var cdSize = central.reduce(function(a, b){ return a + b.length; }, 0);
    var eo = new Uint8Array(22), ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054b50, true);         /* EOCD 签名 */
    ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [eo]), { type: 'application/zip' });
  }
  function dl(blob, name){ /* 统一下载（a[download]，与导出 JSON 同款先例） */
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
  }
  return { pack: pack, dl: dl };
})();
/* 文档 OCR（v1.5）：扫描版（图片型）PDF 交给专用文档识别模型转文本。
   - Mistral OCR（官方 api.mistral.ai / mistral-ocr-latest；任何 Mistral OCR 兼容网关改「接口地址」即可）
   - Azure Document Intelligence（{endpoint}/documentintelligence/documentModels/{model}:analyze，异步轮询 operation-location）
   请求走 NET.raw（宿主桥自动带代理配置，浏览器模式回退 fetch）。 */
var OCR = (function(){
  var MAX_OCR = 30 * 1048576;   // OCR 上传上限：base64 膨胀后约 40MB，宿主桥消息体可控
  function cfg(){ var o = S.cfg.ocr; return o || (S.cfg.ocr = Object.assign({}, DEF_CFG.ocr)); }
  function engine(){ return cfg().engine || 'none'; }
  function active(){ return engine() !== 'none'; }
  function b64of(file){
    return file.arrayBuffer().then(function(ab){
      var u8 = new Uint8Array(ab), s = '', CH = 0x8000;
      for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
      return btoa(s);
    });
  }
  function errOf(r){ // 从错误响应体里榨出可读原因
    try {
      var j = JSON.parse(r.text), e = j.error || j;
      return e.message || e.code || JSON.stringify(e).slice(0, 200);
    } catch(err){ return (r.text || '').slice(0, 200) || ('HTTP ' + r.status); }
  }
  function testB64(){ // 内置连通性测试图（白底黑字，内容不作数，只验 Key/端点）
    var cv = document.createElement('canvas'); cv.width = 240; cv.height = 64;
    var g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#000'; g.font = 'bold 28px sans-serif'; g.textBaseline = 'middle';
    g.fillText('OCR TEST 2026', 12, 34);
    var d = cv.toDataURL('image/png');
    return d.slice(d.indexOf(',') + 1);
  }
  function mistral(b64data, mime){
    var o = cfg();
    var base = (o.mistralBase || 'https://api.mistral.ai').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) base = 'https://' + base;
    return NET.raw({
      url: base + '/v1/ocr', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (o.mistralKey || '') },
      body: JSON.stringify({
        model: (o.mistralModel || 'mistral-ocr-latest').trim(),
        document: { type: 'document_url', document_url: 'data:' + mime + ';base64,' + b64data },
        include_image_base64: false
      }),
      timeout: 300000
    }).then(function(r){
      if (r.status < 200 || r.status >= 300) throw new Error('Mistral OCR HTTP ' + r.status + '：' + errOf(r));
      var j;
      try { j = JSON.parse(r.text); } catch(e){ throw new Error('Mistral OCR 响应不是合法 JSON'); }
      var pages = j.pages || [], out = [];
      pages.forEach(function(pg, i){
        if (pg.markdown) out.push((pages.length > 1 ? '【第 ' + (i + 1) + ' 页】\n' : '') + pg.markdown);
      });
      if (!out.length) throw new Error('Mistral OCR 未识别出内容');
      return out.join('\n\n');
    });
  }
  function azure(b64data, mime){
    var o = cfg();
    var base = (o.azureEndpoint || '').trim().replace(/\/+$/, '');
    if (!base) return Promise.reject(new Error('未填写 Azure 资源端点（设置 → 文档解析）'));
    if (!/^https?:\/\//.test(base)) base = 'https://' + base;
    var url = base + '/documentintelligence/documentModels/' + encodeURIComponent((o.azureModel || 'prebuilt-read').trim()) +
              ':analyze?api-version=' + encodeURIComponent((o.azureApiVer || '2024-11-30').trim());
    return NET.raw({
      url: url, method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': (o.azureKey || '').trim() },
      bodyB64: b64data, contentType: mime, timeout: 60000
    }).then(function(r){
      if (r.status < 200 || r.status >= 300) throw new Error('Azure HTTP ' + r.status + '：' + errOf(r));
      var op = r.headers && r.headers['operation-location'];
      if (!op) throw new Error('Azure 未返回 operation-location（宿主版本过旧？请用最新源码重新编译宿主）');
      return azurePoll(op, Date.now() + 300000);
    });
  }
  function azurePoll(op, deadline){
    return NET.raw({
      url: op, method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': (cfg().azureKey || '').trim() },
      timeout: 60000
    }).then(function(r){
      if (r.status < 200 || r.status >= 300) throw new Error('Azure 轮询 HTTP ' + r.status + '：' + errOf(r));
      var j;
      try { j = JSON.parse(r.text); } catch(e){ throw new Error('Azure 轮询响应不是合法 JSON'); }
      if (j.status === 'succeeded'){
        var ar = j.analyzeResult || {}, out = [];
        if (ar.content && ar.content.replace(/\s/g, '')) return ar.content;
        (ar.pages || []).forEach(function(pg, i){ // 老版本响应无 content 字段时按行拼
          var t = (pg.lines || []).map(function(l){ return l.content; }).join('\n');
          if (t) out.push('【第 ' + (i + 1) + ' 页】\n' + t);
        });
        if (!out.length) throw new Error('Azure 未识别出内容');
        return out.join('\n\n');
      }
      if (j.status === 'failed') throw new Error('Azure 识别失败：' + ((j.error && j.error.message) || '未知错误'));
      if (Date.now() > deadline) throw new Error('Azure 识别超时（5 分钟），大文件建议改用 Mistral');
      return new Promise(function(res){ setTimeout(res, 2000); }).then(function(){ return azurePoll(op, deadline); });
    });
  }
  /* v0.5.0：视觉模型识别 —— 用当前（或指定）聊天模型直接读图 / 读 PDF */
  function vision(b64data, mime){
    var o = cfg();
    var isPdf = /pdf/i.test(mime || '');
    var dataUrl = 'data:' + mime + ';base64,' + b64data;
    var proto = S.cfg.protocol || 'openai-chat';
    var content;
    if (isPdf){
      if (proto !== 'anthropic-messages' && proto !== 'openai-responses')
        return Promise.reject(new Error('视觉模型识别 PDF 需要 Anthropic / Responses 协议（当前：' + proto + '）；识别图片不受限制'));
      content = [{ type: 'text', text: '把这份 PDF 的全文转成 Markdown，保留标题层级与表格；只输出正文，不要解释。' },
                 { type: 'document', name: 'doc.pdf', url: dataUrl }];
    } else {
      content = [{ type: 'text', text: '把图片里的文字原样转成纯文本，保留段落与表格；只输出文字，不要解释。' },
                 { type: 'image_url', image_url: { url: dataUrl } }];
    }
    return NET.chatOnce([{ role: 'user', content: content }],
        { maxTokens: 4096, timeout: 0, model: (o.visionModel || '').trim() || S.cfg.currentModel })
      .then(function(m){
        var t = m && m.content;
        if (!t || !String(t).replace(/\s/g, '')) throw new Error('视觉模型没有返回文本（确认当前模型支持视觉）');
        return String(t);
      });
  }
  /* 百度智能云 OCR：API Key + Secret Key 换 token，再 form 提交 */
  function baidu(b64data, mime){
    var o = cfg();
    var key = (o.baiduKey || '').trim(), sec = (o.baiduSecret || '').trim();
    if (!key || !sec) return Promise.reject(new Error('未填写百度 OCR 的 API Key / Secret Key'));
    if (/pdf/i.test(mime || '')) return Promise.reject(new Error('百度 OCR 只支持图片；PDF 请用视觉模型识别或 Mistral OCR'));
    return NET.raw({ url: 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=' +
        encodeURIComponent(key) + '&client_secret=' + encodeURIComponent(sec),
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 })
      .then(function(r){
        var j; try { j = JSON.parse(r.text); } catch (e) { throw new Error('百度 token 响应非法'); }
        if (!j.access_token) throw new Error('百度 token 获取失败：' + (j.error_description || j.error || '未知'));
        return NET.raw({ url: 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=' + encodeURIComponent(j.access_token),
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'image=' + encodeURIComponent(b64data), timeout: 90000 });
      })
      .then(function(r2){
        var j2; try { j2 = JSON.parse(r2.text); } catch (e) { throw new Error('百度 OCR 响应非法'); }
        if (j2.error_code) throw new Error('百度 OCR ' + j2.error_code + '：' + (j2.error_msg || ''));
        var words = (j2.words_result || []).map(function(w){ return w.words; });
        if (!words.length) throw new Error('百度 OCR 未识别出内容');
        return words.join('\n');
      });
  }
  /* 其它云 OCR：官方接口要签名/OAuth，这里统一走用户自建网关（POST JSON，返回文本字段） */
  function gateway(name, b64data, mime){
    var o = cfg();
    var ep = (o.gwEndpoint || '').trim();
    if (!ep) return Promise.reject(new Error(name + '：官方接口需要签名 / OAuth，本版走自建网关 —— 请在设置里填「网关地址」'));
    return NET.raw({ url: ep, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (o.gwKey || '') },
      body: JSON.stringify({ service: name, mime: mime, data: b64data }), timeout: 0 })
      .then(function(r){
        if (r.status < 200 || r.status >= 300) throw new Error(name + ' 网关 HTTP ' + r.status + '：' + errOf(r));
        var t = r.text || '';
        try {
          var j = JSON.parse(t);
          t = j.text || j.content || j.markdown || (j.data && (j.data.text || j.data.content)) || t;
        } catch (e) {}
        if (!String(t).replace(/\s/g, '')) throw new Error(name + ' 网关没有返回文本');
        return String(t);
      });
  }
  var GW_NAMES = { google: 'Google Document AI', aws: 'Amazon Textract', adobe: 'Adobe PDF Services',
                   abbyy: 'ABBYY Vantage', aliyun: '阿里云 OCR', tencent: '腾讯云 OCR' };
  function run(b64data, mime){
    var e = engine();
    if (e === 'vision') return vision(b64data, mime);
    if (e === 'baidu') return baidu(b64data, mime);
    if (e === 'mistral') return mistral(b64data, mime);
    if (e === 'azure') return azure(b64data, mime);
    if (GW_NAMES[e]) return gateway(GW_NAMES[e], b64data, mime);
    return Promise.reject(new Error('未选择 OCR 引擎（设置 → 文档解析）'));
  }
  function parsePdf(file){
    if (file.size > MAX_OCR)
      return Promise.reject(new Error('OCR 上传上限 30MB（当前 ' + Math.round(file.size / 1048576) + 'MB），请先拆分或压缩 PDF'));
    return b64of(file).then(function(b){ return run(b, 'application/pdf'); });
  }
  function test(){ return run(testB64(), 'image/png'); } // 连通性测试：识别出文本即 Key/端点可用
  return { cfg: cfg, engine: engine, active: active, parsePdf: parsePdf, test: test };
})();
/*  */
/* v0.3.35：会话导出为 Markdown（对标 ChatGPT 的导出对话） */
function chatToMarkdown(msgs, s){
  var t = (s && s.title) || '对话';
  var out = ['# ' + t, '', '> 导出自 SoloChat ' + APP_VER + ' · ' + new Date().toLocaleString(), ''];
  (msgs || []).forEach(function(m){
    if (m.status && m.status !== 'ok') return;
    var body = String(m.content || '').trim(); if (!body) return;
    var who = m.role === 'user' ? '你' : (m.role === 'assistant' ? '助手' : (m.role === 'tool' ? '工具' : m.role));
    out.push('## ' + who + (m.model ? '（' + m.model + '）' : ''));
    out.push(''); out.push(body); out.push('');
    if (m.srcs && m.srcs.length){
      out.push('来源：');
      m.srcs.forEach(function(x, k){ out.push((k + 1) + '. [' + String(x.t || x.u || '') + '](' + String(x.u || '') + ')'); });
      out.push('');
    }
  });
  return out.join('\n');
}

var UI = (function(){
  var lbEl = null;
  function lightbox(url){ /* v0.2.9：图片放大查看，点任意处/ESC 关闭 */
    if (!url) return;
    function closeLb(){ if (lbEl) lbEl.classList.remove('on'); try { RUNNER.webHostRestore(); } catch (e) {} }
    try { RUNNER.webHostHide(); } catch (e) {} // v1.1.8：灯箱是全屏 HTML 层，原生网页控件必须让位
    if (!lbEl){
      lbEl = document.createElement('div');
      lbEl.className = 'lightbox';
      lbEl.addEventListener('click', closeLb);
      var _x = document.createElement('button');
      _x.textContent = '✕ 关闭';
      _x.style.cssText = 'position:absolute;right:24px;top:24px;z-index:2;padding:8px 16px;border-radius:8px;'
        + 'border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.55);color:#fff;font-size:14px;cursor:pointer';
      _x.addEventListener('click', function(ev){ ev.stopPropagation(); closeLb(); });
      lbEl.appendChild(_x);
      document.body.appendChild(lbEl);
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && lbEl) closeLb(); });
    }
    lbEl.innerHTML = '';
    lbEl.appendChild(document.createElement('img')).src = url;
    lbEl.classList.add('on');
  }
  var $list, $scroll, $empty, $input, $send, $chips, $modal, $panel, $title;

  /* 主题（§8.4：手动覆盖后持久化；auto 跟随系统） */
  var mq = matchMedia('(prefers-color-scheme: dark)');
  function resolvedTheme(){
    var t = S.cfg.theme;
    if (t === 'auto') return mq.matches ? 'dark' : 'light';
    return t;
  }
  function applyTheme(){
    var t = resolvedTheme();
    document.documentElement.dataset.theme = t;
    notifyQuickbar(); // 主题变化同步给快速输入条
  }
  /* 任务栏快速输入条联动（仅宿主环境）
     v0.4.2：启动时只同步主题、不弹出 —— 否则一开机它就一直浮在主窗顶上；
             只有用户按热键召唤、或手动打开开关时才显示 */
  var QB_READY = false;
  function notifyQuickbar(){
    if (!NET.bridge.ok) return;
    NET.bridge.send({ t: 'quickbar', show: QB_READY && !!S.cfg.quickbar, theme: resolvedTheme() });
  }
  /* 全局热键绑定下发宿主（四路：快速条 / 显示主窗 / 新建会话 / 临时会话） */
  function notifyHotkey(){
    if (!NET.bridge.ok) return;
    var sc = S.cfg.shortcuts || {};
    NET.bridge.send({ t: 'hotkey', combo: sc.quickbar || '',
      combos: { showMain: sc.showMain || '', newSession: sc.newGlobal || '', tempSession: sc.tempGlobal || '' } });
  }
  var qa = null; // 快速提问同步标记 {sid, last}
  var quickPending = false; // 快速条提问先于建会话：sendMessage 内建会话后再补 sid，保证小窗收到流式回复
  function stripFs(t){ /* 小窗同步用：剥掉工具围栏（fs-*、run、vfs-*），避免原始标记直接显示成乱码 */
    return String(t || '').replace(/```(?:fs-(?:read|list|write|done|rej)|run|preview|python|vfs-(?:write|list|read))[ \t]*\r?\n[\s\S]*?```/g, '〔工具执行中…〕');
  }
  function quickAsk(text){
    text = (text || '').trim();
    if (!text) return;
    /* v0.4.2：小窗固定 Chat 模式（弹窗里的模式切换已取消） */
    if (S.cfg.mode !== 'chat'){ setCfg({ mode: 'chat' }); try { renderComposerCtl(); updateEmpty(); } catch (e) {} }
    if (S.sending){
      $input.value = text;
      autosize();
      if (NET.bridge.ok) NET.bridge.send({ t: 'quick.answer', text: '（正在生成中，问题已填入主窗输入框，请稍候）', done: true });
      toast('正在生成中，内容已填入输入框');
      return;
    }
    if (!NET.isMock() && !S.cfg.baseURL){ openSettings(); toast('请先在设置中填写接口地址与 API Key', true); return; }
    /* 默认新对话（v1.4.1 用户要求）：不续聊当前会话；当前会话已开始或带文件夹时先回草稿态（无文件夹） */
    var cs = curSession();
    if (cs && (S.msgs.length || cs.workspace)) { newDraft(); S.pendWs = ''; }
    quickPending = true; // 留在 sendMessage 建会话后绑定 qa.sid（首条消息 curSession() 为 null）
    $input.value = text;
    autosize();
    sendMessage();
  }
  /* 小窗按钮 → 页面动作（文件/联网/Agent/新建/设置），宿主 quick.cmd 中转 */
  function quickCmd(cmd){
    if (cmd === 'attach'){ $('#file-input').click(); return; }
    if (cmd === 'web'){
      setCfg({ webSearch: !S.cfg.webSearch });
      renderComposerCtl();
      UI.toast(S.cfg.webSearch ? '联网搜索：开' : '联网搜索：关');
      return;
    }
    if (cmd === 'agent'){ // 选 Agent → 打开文件夹选择提示框（默认文件夹内免确认）
      setCfg({ mode: 'agent' });
      renderComposerCtl(); updateEmpty();
      /* 会话已开始时 pickWorkspace 会以「不能更改工作区」提前返回——先回草稿态再选（v1.4.1 修复） */
      var cs2 = curSession();
      if (cs2 && (S.msgs.length || cs2.workspace)) { newDraft(); S.pendWs = ''; }
      UI.toast('Agent 模式已开启，选择工作区文件夹');
      UI.pickWorkspace();
      return;
    }
    if (cmd === 'chat'){
      setCfg({ mode: 'chat' });
      renderComposerCtl(); updateEmpty();
      return;
    }
    if (cmd === 'new'){ UI.newDraft(); return; }
    if (cmd === 'temp'){ UI.toggleTemp(); return; }   /* v0.4.2：全局热键「新建临时会话」 */
    if (cmd === 'settings'){ UI.openSettings(); return; }
    if (cmd === 'main'){ return; }
  }
  /* 小窗按钮状态回显（联网/Agent 开关、待发附件数） */
  function notifyQuickState(){
    if (!NET.bridge.ok) return;
    NET.bridge.send({ t: 'quick.state', web: !!S.cfg.webSearch, agent: S.cfg.mode === 'agent', files: S.pendAtts.length });
  }
  function resetQuick(){ qa = null; quickPending = false; } /* v2.0：清空/删除时静默复位快速条标记 */
  mq.addEventListener('change', function(){ if (S.cfg && S.cfg.theme === 'auto') applyTheme(); });

  /* Toast */
  function toast(msg, isErr){
    var t = el('div', { class: 'toast' + (isErr ? ' err' : ''), text: msg });
    $('#toast-root').appendChild(t);
    setTimeout(function(){ t.remove(); }, 3200);
  }

  /* 弹层基础设施 */
  function openModal(build, wide, narrow){
    /* v1.1.8：原生网页控件是窗口子控件，会盖住弹窗；打开弹窗前先收起，关闭后由 closeModal 放回 */
    try { RUNNER.webHostHide(); } catch (e) {}
    $panel.classList.toggle('wide', !!wide);
    $panel.classList.toggle('narrow', !!narrow); // Issue 20: 确认框收窄（原 #confirm-box 选择器从未命中）
    $panel.textContent = '';
    $panel.appendChild(build);
    $modal.classList.add('show');
  }
  function closeModal(){
  try { if (S) { S.recKey = null; S.recBtn = null; } } catch (e) {} // v0.3.65：关弹层就退出快捷键录制，否则下一次按键会被静默写成快捷键
  $modal.classList.remove('show'); $panel.textContent = '';
  var r = S._confirmRes; S._confirmRes = null;
  if (r){ try { r(false); } catch (e) {} } // v0.3.2：放弃的确认要先落定，不然调用方永远等下去
  try { RUNNER.webHostRestore(); } catch (e) {} // v1.1.8
}
  function modalOpen(){ return $modal.classList.contains('show'); }
  function confirmBox(opt){
    return new Promise(function(res){
      var box = el('div', {}, [
        el('h2', { text: opt.title }),
        el('div', { class: 'sub', text: opt.text || '' }),
        el('div', { class: 'f-actions' }, [
          el('button', { class: 'btn btn-sec', 'data-m': 'no', text: '取消' }),
          el('button', { class: 'btn ' + (opt.danger ? 'btn-danger' : 'btn-primary'), 'data-m': 'yes', text: opt.okText || '确定' })
        ])
      ]);
      S._confirmRes = res;
      openModal(box, false, true); // Issue 20: 确认框用 narrow 宽度
    });
  }

  /* 设置弹层（改动即保存） */
  function field(label, node, hint){
    return el('div', { class: 'f-row' }, [
      el('label', { text: label }), node,
      hint ? el('div', { class: 'hint', text: hint }) : ''
    ]);
  }
  function cfgGet(key){
    var o = S.cfg, ps = key.split('.');
    for (var i = 0; i < ps.length; i++){ if (o == null) return undefined; o = o[ps[i]]; }
    return o;
  }
  function cfgInput(key, type, ph){
    var v = cfgGet(key);
    return el('input', { class: 'f-in', type: type || 'text', 'data-cfg': key, value: v == null ? '' : v, placeholder: ph || '' });
  }
  /* 配置组：AP=当前组；扁平四字段镜像，请求层零改动 */
  function AP(){
    var ps = S.cfg.presets || [];
    for (var i = 0; i < ps.length; i++) if (ps[i].id === S.cfg.activePreset) return ps[i];
    return ps[0] || { id: 'p1', name: '默认', baseURL: '', apiKey: '', models: [], currentModel: '' };
  }
  function mirrorPreset(){
    var p = AP();
    S.cfg.baseURL = p.baseURL || ''; S.cfg.apiKey = p.apiKey || '';
    S.cfg.models = p.models || []; S.cfg.currentModel = p.currentModel || '';
    S.cfg.defaultModel = p.currentModel || ''; // 全局默认（会话没自己的 model 时用它）
    S.cfg.provId = p.provId || ''; S.cfg.protocol = p.protocol || 'openai-chat';
    S.cfg.authType = p.authType || 'bearer'; S.cfg.chatPath = p.chatPath || '';
    S.cfg.modelsPath = p.modelsPath || ''; S.cfg.quirks = p.quirks || {};
  }
  function applyPreset(id, model){
    var ps = S.cfg.presets || [], p = null;
    for (var i = 0; i < ps.length; i++) if (ps[i].id === id) p = ps[i];
    if (!p) return;
    S.cfg.activePreset = id;
    if (model != null) p.currentModel = model;
    applyCtx(); // 切组/切模型后按已探测窗口映射/模型名规则刷新（v1.6 全自动）
    mirrorPreset(); saveCfg(); renderComposerCtl();
    metaLazy(); // v2.9：静默补全能力（只读目录缓存）
  }

  /* v0.4.5：套用供应商预设（纯数据）—— 只改当前配置组的地址/鉴权/怪癖，不动模型池 */
  function applyProv(id){
    var p = AP(), cat = NET.provEntry(id);
    if (!cat || id === '') return;
    var prevProvId = p.provId;
    p.provId = id;
    if (id !== 'custom'){
      p.baseURL = cat.base || '';
      p.authType = cat.auth || 'bearer';
      p.protocol = cat.protocol || 'openai-chat';
      p.quirks = JSON.parse(JSON.stringify(cat.quirks || {}));
    }
    mirrorPreset(); saveCfg();
    try { UI.openSettings(); } catch (e) {}
    try { UI.toast('已套用预设：' + cat.name); } catch (e2) {}
    /* B3-3：换了厂商但模型池没清（可能是同一网关多地址），提示核对模型 ID，不自动清空 */
    if (p.models && p.models.length && id !== prevProvId){
      try { UI.toast('已切换供应商，模型池保留；请确认模型 ID 属于该厂商，或手动删除不兼容的模型'); } catch (e3) {}
    }
  }
  /* v0.4.5：三步测试连接（① /models ② 最小对话 ③ 流式） */
  function testConnBtn(btn){
    var names = { 1: '拉模型列表', 2: '最小对话', 3: '流式' };
    btn.disabled = true; btn.textContent = '测试中…';
    NET.testConn(function(n){ btn.textContent = '测试中… ' + (names[n] || n); }).then(function(rows){
      btn.disabled = false; btn.textContent = '测试连接';
      var ok = rows.length && rows.every(function(r){ return r.ok; });
      var txt = rows.map(function(r){ return (r.ok ? '✓' : '✗') + r.msg; }).join('  ');
      try { UI.toast((ok ? '连接正常：' : '连接失败：') + txt, !ok); } catch (e) {}
    }, function(e){
      btn.disabled = false; btn.textContent = '测试连接';
      try { UI.toast('测试失败：' + ((e && e.message) || e), true); } catch (e2) {}
    });
  }
  /* 上下文窗口自动探测（v1.6 起唯一来源，无手动开关）：① /models 窗口字段映射
     （内存 S.ctxMap + 持久化 p.ctxMap，切模型/重启后仍生效）② 接口没给字段时按模型名规则推断
     （NET.guessCtx）。结果写入当前配置组「上下文上限」，返回被写入的窗口值（未变化返回 null）。 */
  function applyCtx(map, meta){
    var p = AP();
    if (map){ S.ctxMap = map; S.ctxMapPid = p.id; p.ctxMap = map; saveCfg(); }
    if (meta){ for (var id in meta) mSet(id, meta[id], 'api'); } /* v2.9：/models 给的能力直接入库 */
    var m = (S.ctxMap && S.ctxMapPid === p.id) ? S.ctxMap : (p.ctxMap || null);
    var v = 0;
    if (m){
      v = m[p.currentModel] || 0;
      if (!v){
        var ks = Object.keys(m);
        if (ks.length === 1) v = m[ks[0]]; // 仅一个模型且 id 未对上：直接采信
      }
    }
    if (!v) v = NET.guessCtx(p.currentModel); // 兜底：按模型名规则推断（接口未提供窗口字段时）
    if (!v || parseInt(p.ctxLimit, 10) === v) return null;
    p.ctxLimit = v; saveCfg();
    return v;
  }
  /* 上下文上限只读展示文案（前端不提供手填） */
  function ctxDisp(){
    var id = S.cfg.currentModel, m = mMeta(id), src;
    if (m && m.ctx > 0){
      src = { api: '接口', catalog: '目录', manual: '手工', guess: '推断' }[m.src || ''] || '';
      return m.ctx.toLocaleString() + (src ? '（' + src + '）' : '');
    }
    var v = +AP().ctxLimit;
    if (v) return v.toLocaleString();
    var g = NET.guessCtx(id);
    return g ? g.toLocaleString() + '（按模型名推断）' : '（未探测，默认 131,072）';
  }
  /* ---- v2.9：模型能力表 cfg.modelMeta ---- */
  function mMeta(id){ return (S.cfg.modelMeta || {})[id || S.cfg.currentModel] || null; }
  function mSet(id, rec, src){
    if (!id) return;
    var all = S.cfg.modelMeta || (S.cfg.modelMeta = {});
    var cur = all[id] || {};
    for (var k in rec) if (rec[k] !== undefined && rec[k] !== null && rec[k] !== '') cur[k] = rec[k];
    if (src) cur.src = src;
    all[id] = cur;
  }
  /* 上下文窗口：模型能力表 → 旧探测值 → 模型名规则 */
  function ctxLimitFor(id){
    id = id || S.cfg.currentModel;
    var m = mMeta(id);
    if (m && m.ctx > 0) return m.ctx;
    var v = parseInt(AP().ctxLimit, 10);
    if (v > 0) return v;
    return NET.guessCtx(id) || 131072;
  }
  function fmtTok(n){
    n = +n || 0;
    if (n >= 1e6){ var x = n / 1e6; return (x % 1 === 0 ? x : x.toFixed(1)) + 'M'; }
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(n);
  }
  var MM_IN = [['text', '文本'], ['image', '图片'], ['pdf', '文档'], ['audio', '音频'], ['video', '视频']];
  var MM_REASON = [['', '不指定（按档位通用字段）'], ['reasoning_effort', 'reasoning_effort'],
    ['reasoning', 'reasoning'], ['thinking', 'thinking'], ['enable_thinking', 'enable_thinking']];
  function mmSummary(id){
    var m = mMeta(id) || {}, bits = [];
    if (m.nonChat) return '非对话模型（无上下文窗口）';
    if (m.ctx) bits.push(fmtTok(m.ctx) + ' 上下文');
    if (m.out) bits.push(fmtTok(m.out) + ' 输出');
    if (m.in && m.in.length){
      var nm = { text: '文', image: '图', pdf: '档', audio: '音', video: '视' };
      bits.push(m.in.map(function(x){ return nm[x] || x; }).join('/'));
    }
    if (m.reason){
      bits.push('思考' + ((m.efforts && m.efforts.length) ? '·' + m.efforts.join('/') : ''));
    }
    var s = bits.join(' · ');
    if (!s) return '能力未获取';
    return m.src === 'guess' ? s + ' · 推断' : s;
  }
  /* 目录都没覆盖时的名称推断：非对话模型打标记，其余按名字规则给 ctx/模态/思考 */
  var RE_NONCHAT = /(reward|embedding|rerank|guard|classifier|moderation|safety|asr|tts|whisper|ocr-|dall|stable-diffusion|flux)/;
  function guessCaps(id){
    var s = String(id || '').toLowerCase();
    if (!s) return null;
    if (RE_NONCHAT.test(s)) return { nonChat: 1 };
    var rec = {}, c = NET.guessCtx(id);
    if (c) rec.ctx = c;
    if (/(vl|vision|omni|multimodal)/.test(s)) rec.in = ['text', 'image'];
    if (/(reasoning|thinking|qwq|\/r1|[-_.]r1[-_.]|o[134][-_ ]|gpt-5)/.test(s)) rec.reason = 'reasoning_effort';
    return (rec.ctx || rec.in || rec.reason) ? rec : null;
  }
  /* 模型池：每行一个已选模型 + ⚙ 能力设置 / 🗑 删除（v2.9 取代原来的逗号分隔文本框） */
  function renderPool(boxArg){
    var box = boxArg || $('#mdl-pool'); if (!box) return;
    box.textContent = '';
    /* v0.3.1：手动输入模型 ID —— 加进池子后自动补全能力（目录 → OpenRouter → 名称推断） */
    var manIn = el('input', { class: 'f-in', id: 'mdl-manual', placeholder: '手动输入模型 ID，如 qwen3-max / claude-sonnet-4', style: 'flex:1' });
    var manBtn = el('button', { class: 'btn', type: 'button', text: '添加并获取信息' });
    manBtn.addEventListener('click', function(){ addModelManual(String(manIn.value || '').trim()); });
    manIn.addEventListener('keydown', function(ev){ if (ev.key === 'Enter'){ ev.preventDefault(); addModelManual(String(manIn.value || '').trim()); } });
    box.appendChild(el('div', { class: 'f-row', style: 'gap:8px;margin-bottom:8px' }, [manIn, manBtn]));
    var ap = AP(), ms = ap.models || [], cur = ap.currentModel;
    if (!ms.length){
      box.appendChild(el('div', { class: 'mdl-empty', text: '还没有模型：上面手动填一个，或点「获取列表」挑几个。' }));
      return;
    }
    for (var i = 0; i < ms.length; i++){
      (function(id){
        var m = mMeta(id) || {}, on = id === cur;
        var row = el('div', { class: 'mdl-row' + (on ? ' on' : ''), 'data-row': id });
        row.appendChild(el('button', { class: 'mdl-nm', 'data-m': 'mm-use', 'data-id': id, title: '设为当前模型' }, [
          el('span', { class: 'nm', text: modelLabel(id) }),
          el('span', { class: 'mdl-caps', text: mmSummary(id) })
        ]));
        row.appendChild(el('span', { class: 'mdl-ops' }, [
          el('button', { 'data-m': 'mm-cfg', 'data-id': id, title: '模型能力设置' }, [icon('gear')]),
          el('button', { 'data-m': 'mm-del', 'data-id': id, title: '从模型池删除' }, [icon('trash')])
        ]));
        box.appendChild(row);
        /* 能力编辑面板（默认收起） */
        var cfgBox = el('div', { class: 'mdl-cfg', hidden: true });
        function numField(label, key, ph){
          var inp = el('input', { class: 'f-in', type: 'number', min: '0', step: '1', 'data-mm': key, 'data-id': id,
            placeholder: ph, value: m[key] == null ? '' : String(m[key]) });
          return el('label', { class: 'mm-f' }, [el('span', { text: label }), inp]);
        }
        var inRow = el('div', { class: 'mm-in' });
        for (var k = 0; k < MM_IN.length; k++){
          (function(kv){
            var ck = el('input', { type: 'checkbox', 'data-mmin': kv[0], 'data-id': id });
            ck.checked = !!(m.in && m.in.indexOf(kv[0]) >= 0);
            inRow.appendChild(el('label', { class: 'mm-ck' }, [ck, ' ' + kv[1]]));
          })(MM_IN[k]);
        }
        var rsel = el('select', { class: 'f-in', 'data-mmr': '1', 'data-id': id });
        for (var r = 0; r < MM_REASON.length; r++)
          rsel.appendChild(el('option', { value: MM_REASON[r][0], text: MM_REASON[r][1], selected: (m.reason || '') === MM_REASON[r][0] ? '' : null }));
        cfgBox.appendChild(el('div', { class: 'mm-grid' }, [
          numField('上下文窗口', 'ctx', '如 200000'),
          numField('最大输出', 'out', '如 64000')
        ]));
        cfgBox.appendChild(el('div', { class: 'mm-f' }, [el('span', { text: '输入类型' }), inRow]));
        cfgBox.appendChild(el('div', { class: 'mm-f' }, [el('span', { text: '思考字段' }), rsel]));
        /* v3.0 #5：该模型的默认采样参数（留空 = 跟随全局） */
        var def = m.def || {};
        var tIn = el('input', { class: 'f-in', type: 'number', step: '0.1', min: '0', max: '2',
          'data-mmdef': 'temperature', 'data-id': id, value: def.temperature == null ? '' : String(def.temperature), placeholder: '跟随全局' });
        var mtIn = el('input', { class: 'f-in', type: 'number', min: '0', step: '1',
          'data-mmdef': 'maxTokens', 'data-id': id, value: def.maxTokens == null ? '' : String(def.maxTokens), placeholder: '跟随全局' });
        cfgBox.appendChild(el('div', { class: 'mm-grid' }, [
          el('label', { class: 'mm-f' }, [el('span', { text: 'temperature' }), tIn]),
          el('label', { class: 'mm-f' }, [el('span', { text: 'max_tokens' }), mtIn])
        ]));
        cfgBox.appendChild(el('div', { class: 'mm-src', text: '来源：' + ({ api: '接口 /models', catalog: 'models.dev 目录', manual: '手工校正', guess: '模型名推断' }[(m.src || 'guess')] || '未获取') }));
        box.appendChild(cfgBox);
      })(ms[i]);
    }
  }
  /* v0.3.1：手动加模型 → 立刻联网补全上下文/模态/思考字段，取不到再按名称推断 */
