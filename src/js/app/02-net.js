function hostHeaders(headers, url){
  try {
    if (/opencode\.ai/i.test(String(url || S.cfg.baseURL || '')) && !headers['x-opencode-session']) headers['x-opencode-session'] = _ocSess;
  } catch (e) {}
  return headers;
}

var _lastRaw = '';
function fetchStream(opt){
    var url0 = endpoint('chat', true);
    var headers = authHeaders();
    hostHeaders(headers, url0);
    var attempt = 0, MAX_RETRY = 3;
    var gotFirst = false, idleTimer = null, firstTimer = null;
    var failed = false, rawBuf = '';
    _lastRaw = '';
    function saveRaw(){
      if (rawBuf.length > 16384) rawBuf = rawBuf.slice(-16384);
      _lastRaw = rawBuf;
      try { NET._lastRaw = _lastRaw; } catch (e) {}
    }

    function clearTimers(){ clearTimeout(idleTimer); clearTimeout(firstTimer); idleTimer = firstTimer = null; }
    function armFirst(){
      clearTimeout(firstTimer);
      firstTimer = null;
      var ms = (S.cfg.timeout.first || 0) * 1000;
      if (ms <= 0) return;
      firstTimer = setTimeout(function(){
        var e = new Error('first-token timeout'); e.tmo = 'first';
        opt.abort(e);
      }, ms);
    }
    function armIdle(){
      clearTimeout(idleTimer);
      idleTimer = null;
      var ms = (S.cfg.timeout.idle || 0) * 1000;
      if (ms <= 0) return;
      idleTimer = setTimeout(function(){
        var e = new Error('idle timeout'); e.tmo = 'idle';
        opt.abort(e);
      }, ms);
    }

    function once(){
      armFirst();
      return fetch(url0, {
        method: 'POST', headers: headers, body: JSON.stringify(opt.body), signal: opt.signal
      }).then(function(res){
        if (!res.ok){
          clearTimers();
          if (+res.status === 429 && attempt < MAX_RETRY){
            attempt++;
            return sleep(1000 * Math.pow(2, attempt - 1)).then(once); // 1s/2s/4s
          }
          throw new Error('HTTP ' + res.status);
        }
        var ct = res.headers.get('content-type') || '';
        if (ct.indexOf('application/json') >= 0){ // 服务端忽略 stream 的兜底（§6.2）
          clearTimers();
          return res.text().then(function(txt){
            rawBuf = txt || ''; saveRaw();
            var j;
            try { j = JSON.parse(txt); } catch (e) { throw new Error('响应不是合法 JSON'); }
            if (j && j.error){
              var em = j.error.message || j.error.code || (typeof j.error === 'string' ? j.error : JSON.stringify(j.error));
              throw new Error('上游错误：' + em);
            }
            /* v0.4.x：统一走 parseNonStream，并补 usage / tool_calls（P1-4） */
            var ms = parseNonStream(j) || {};
            if (ms.content) opt.onDelta(ms.content, false);
            var proto = protocolNow(), usage = null;
            if (proto === 'gemini' && j.usageMetadata)
              usage = { prompt_tokens: j.usageMetadata.promptTokenCount || 0, completion_tokens: j.usageMetadata.candidatesTokenCount || 0 };
            else if (j.usage)
              usage = (proto === 'anthropic-messages' || proto === 'openai-responses')
                ? { prompt_tokens: j.usage.input_tokens || 0, completion_tokens: j.usage.output_tokens || 0 } : j.usage;
            if (usage && opt.onUsage) opt.onUsage(usage);
            var tacc = makeToolAcc();
            tacc.feed(nonStreamCalls(j, proto));
            opt.onDone(usage, tacc.list());
          });
        }
        var reader = res.body.getReader();
        var dec = new TextDecoder('utf-8');
        var tacc = makeToolAcc();   // v0.8.3：旁路累积 tool_calls（不改解析器）
        function onUpstreamErr(msg){
          if (failed) return; failed = true;
          clearTimers(); saveRaw();
          try { opt.onError(new Error('上游错误：' + msg)); } catch (e) {}
          try { reader.cancel(); } catch (e) {}
        }
        var parser = createParserFor(protocolNow(),
          function(t, isR){
            if (failed) return;
            if (!gotFirst){ gotFirst = true; clearTimeout(firstTimer); }
            armIdle();
            opt.onDelta(t, isR);
          },
          function(u){ if (!failed) opt.onUsage(u); },
          onUpstreamErr
        );
        opt.onReader && opt.onReader(reader);
        function pump(){
          return reader.read().then(function(r){
            if (failed) return;
            if (r.done){ clearTimers(); if (!failed){ parser.end(); saveRaw(); if (!failed) opt.onDone(null, tacc.list()); } return; }
            var _ct = dec.decode(r.value, { stream: true });
            rawBuf += _ct; saveRaw();
            scanToolCalls(tacc, _ct, protocolNow());
            var _fin = parser.feed(_ct);
            if (failed) return;
            if (_fin === true){ clearTimers(); saveRaw(); if (!failed) opt.onDone(null, tacc.list()); try { reader.cancel(); } catch (e) {} return; } // v0.3.36：收到 DONE 就收尾，避免 keep-alive 连接触发空闲超时
            return pump();
          });
        }
        return pump().catch(function(e){ clearTimers(); saveRaw(); if (!failed) throw e; });
      });
    }
    return once().catch(function(e){ clearTimers(); saveRaw(); if (!failed) opt.onError(e); });
  }

  /* 通道② 宿主桥（§7.2）：页面侧适配器 —— 引擎无关
     WebView2：window.chrome.webview.postMessage / addEventListener('message')
     Sciter   ：window.xcall('solohost', json) 页面→宿主；宿主经 SciterCall 调全局 __hostPush(json) 宿主→页面
     浏览器   ：降级（无宿主，http 直连 fetch 走通道①） */
  var ENGINE = (window.chrome && window.chrome.webview) ? 'webview2'
             : (typeof Window !== 'undefined' && Window.this && typeof window.xcall === 'function') ? 'sciter'
             : 'browser';
  var bridge = {
    engine: ENGINE,
    ok: ENGINE !== 'browser',
    pend: {}, seq: 0,
    init: function(){
      if (this.engine === 'webview2'){
        /* v2.4：宿主推送包在 try/catch 里 —— 任一处理器抛错不再打断消息循环、也不再冒泡成"未预期错误" */
        window.chrome.webview.addEventListener('message', function(e){
          try { bridge._dispatch(e.data); }
          catch (err) { try { console.error('[bridge dispatch]', err && (err.stack || err.message)); } catch (x) {} }
        });
      } else if (this.engine === 'sciter'){
        window.__hostPush = function(data){ // 宿主 SciterCall 调用入口
          try { bridge._dispatch(typeof data === 'string' ? JSON.parse(data) : data); } catch(e){}
        };
      }
    },
    _dispatch: function(d){
      if (!d || !d.t) return;
      /* 宿主推送（无关联 id）先于 pend 匹配处理 */
      if (d.t === 'shot.done'){
      var sp = bridge.pend[d.id];
      if (sp){ delete bridge.pend[d.id]; d.message ? sp.reject(new Error(d.message)) : sp.resolve(d.data); }
      return;
    }
    if (d.t === 'quick.ask'){ UI.quickAsk(d.text, d.image); return; }
      if (d.t === 'quick.cmd'){ UI.quickCmd(d.cmd); return; } // 小窗按钮：文件/联网/Agent/新建/设置
      if (d.t === 'open.web'){
        /* v1.1.9：主页面里的 target=_blank / window.open → 右侧「网页」侧栏，而不是系统浏览器 */
        try {
          if ((S.cfg.mode || 'chat') === 'chat') { NET.openExternal(d.url, 'browser'); return; }
          RUNNER.openWeb(d.url); return;
        } catch (e) {
          try { NET.openExternal(d.url, 'browser'); } catch (x) {}
          return;
        }
      }
      if (d.t === 'webview.url'){
        /* v1.1.12：侧栏内跳转后同步地址栏；只是回填，不再触发 webHost，避免循环导航 */
        try {
          var _wi = document.querySelector('#web-url');
          if (_wi && d.url) _wi.value = d.url;
          try { if (d.url && /^https?:\/\//i.test(d.url)) localStorage.setItem('sc.rn.web', d.url); } catch (e2) {}
          var _wr2 = document.querySelector('#runner');
          if (_wr2 && d.url) _wr2.setAttribute('data-web', d.url);
        } catch (e) {}
        return;
      }
      if (d.t === 'quickbar.sync'){ setCfg({ quickbar: !!d.show }); return; } // 热键切换显隐后的静默同步
      if (d.t === 'quickbar.hidden'){ setCfg({ quickbar: false }); UI.toast('快速输入条已隐藏，可在 设置 → 主题 中重新开启'); return; }
      if (d.t === 'hotkey.result'){
        if (!d.ok) UI.toast('全局热键注册失败：' + d.combo + '（可能被其它程序占用）', true);
        return;
      }
      if (d.t === 'pair.event'){
        try { window.dispatchEvent(new CustomEvent('sc-pair', { detail: d })); } catch (e) {}
        return;
      }
      var p = d.id && bridge.pend[d.id];
      if (!p) return;
      if (d.t === 'http.chunk') p.onChunk(d.data);
      else if (d.t === 'http.meta'){ /* 状态码统一由 done/error 通道携带；响应头（operation-location/content-type 等）交给 onMeta */
        if (p.onMeta && d.data){ try { p.onMeta(JSON.parse(d.data)); } catch(e){} }
      }
      else if (d.t === 'http.done'){ delete bridge.pend[d.id]; p.onDone(d.status); }
      else if (d.t === 'http.error'){ delete bridge.pend[d.id]; p.onError(new Error(d.message || 'bridge error')); }
      else if (d.t === 'media.progress'){ if (p.onProgress && d.data){ try { p.onProgress(JSON.parse(d.data)); } catch(e){} } }
      else if (d.t === 'media.done'){
        delete bridge.pend[d.id];
        var md = null; try { md = JSON.parse(d.data); } catch(e){}
        if (p.resolve) p.resolve(md || {}); else if (p.onDone) p.onDone(d.data);
      }
      else if (d.t === 'file.done'){
        delete bridge.pend[d.id];
        var fd = null; try { fd = JSON.parse(d.data); } catch(e){}
        if (p.resolve) p.resolve(fd || {}); else if (p.onDone) p.onDone(d.data);
      }
      else if (d.t === 'file.error'){ delete bridge.pend[d.id]; if (p.reject) p.reject(new Error(d.message || '抓取失败')); else if (p.onError) p.onError(new Error(d.message || '抓取失败')); }
      else if (d.t === 'media.error'){ delete bridge.pend[d.id]; if (p.reject) p.reject(new Error(d.message || '下载失败')); else if (p.onError) p.onError(new Error(d.message || '下载失败')); }
      else if (d.t === 'pkg.done'){ delete bridge.pend[d.id]; var pkd = (d.data && typeof d.data === 'object') ? d.data : null; if (!pkd) { try { pkd = JSON.parse(d.data); } catch(e){ pkd = {}; } } if (p.resolve) p.resolve(pkd); else if (p.onDone) p.onDone(pkd); }
      else if (d.t === 'runtime.done'){ delete bridge.pend[d.id]; var rtd = null; try { rtd = JSON.parse(d.data); } catch(e){ rtd = null; } if (p.resolve) p.resolve(rtd || {}); else if (p.onDone) p.onDone(d.data); }
      else if (d.t === 'runtime.error'){ delete bridge.pend[d.id]; if (p.reject) p.reject(new Error(d.message || '运行时操作失败')); else if (p.onError) p.onError(new Error(d.message || '运行时操作失败')); }
      else if (d.t === 'pkg.error'){ delete bridge.pend[d.id]; if (p.reject) p.reject(new Error(d.message || '导出失败')); }
      else if (d.t === 'fs.done'){ delete bridge.pend[d.id]; p.onDone(d.data); }
      else if (d.t === 'fs.error'){ delete bridge.pend[d.id]; p.onError(new Error(d.message || '文件操作失败')); }
      else if (d.t === 'mem.done'){ delete bridge.pend[d.id]; p.onDone(d.data != null ? d.data : d); } /* v0.5.4：Soul 记忆落盘回包；Android 桥是扁平回包 */
      else if (d.t === 'mem.error'){ delete bridge.pend[d.id]; p.onError(new Error(d.message || '记忆操作失败')); }
      else if (d.t === 'pair.done'){ delete bridge.pend[d.id]; var pd = null; try { pd = JSON.parse(d.data); } catch(e){ pd = d.data; } p.resolve(pd || {}); }
      else if (d.t === 'pair.error'){ delete bridge.pend[d.id]; p.reject(new Error(d.message || '配对操作失败')); }
      else if (d.t === 'save.done'){ delete bridge.pend[d.id]; p.onDone(d); }
      else if (d.t === 'save.error'){ delete bridge.pend[d.id]; p.onError(new Error(d.message || '保存失败')); }
      else if (d.t === 'cmd.done'){
        delete bridge.pend[d.id];
        var cd = null; try { cd = JSON.parse(d.data); } catch(e){}
        if (p.resolve) p.resolve(cd ? cd : { code: -1, stdout: '', stderr: d.message || '' });
        else if (p.onDone) p.onDone(d.data);
      }
      else if (d.t === 'cmd.audit.done'){
        delete bridge.pend[d.id];
        var al = []; try { al = JSON.parse(d.data) || []; } catch(e){}
        if (p.resolve) p.resolve(al); else if (p.onDone) p.onDone(al);
      }
      else if (d.t === 'cmd.error'){ delete bridge.pend[d.id]; if (p.reject) p.reject(new Error(d.message || '命令执行失败')); else if (p.onError) p.onError(new Error(d.message || '命令执行失败')); }
      else if (d.t === 'secret.done' || d.t === 'secret.error'){
        var pv = bridge.pend[d.id];
        if (pv){ delete bridge.pend[d.id];
          if (d.t === 'secret.error') pv.reject(new Error(d.message || '保险库错误'));
          else pv.resolve(d.status === 404 ? null : d.data);
        }
      }
    },
    send: function(msg){
      if (msg && msg.t === 'http') msg.proxy = (typeof S !== 'undefined' && S.cfg && S.cfg.proxy) || ''; // 代理只随宿主桥通道下发
      if (this.engine === 'webview2') window.chrome.webview.postMessage(msg);
      else if (this.engine === 'sciter') window.xcall('solohost', JSON.stringify(msg)); // 同步投递，宿主异步回推
    },
    abort: function(id){ this.send({ t: 'http.abort', id: id }); },
    /* v0.9.0：宿主执行命令（白名单 + 授权 cwd + 超时）；仅 exe 宿主可用 */
    /* v1.0.1：读命令审计（宿主留痕） */
    cmdAudit: function(){
      if (!this.ok) return Promise.reject(new Error('需要 exe 宿主版'));
      return new Promise(function(resolve, reject){
        var id = 'a' + (++bridge.seq);
        bridge.pend[id] = { resolve: resolve, onDone: resolve, reject: reject, onError: reject };
        bridge.send({ t: 'cmd.audit', id: id });
      });
    },
    cmd: function(exe, args, cwd, timeoutMs){
      if (!this.ok) return Promise.reject(new Error('需要 exe 宿主版才能执行命令'));
      return new Promise(function(resolve, reject){
        var id = 'c' + (++bridge.seq);
        /* v1.1.24：timeoutMs=0 表示不限制；不设看门狗 */
        var to = timeoutMs > 0 ? setTimeout(function(){ if (!bridge.pend[id]) return; delete bridge.pend[id]; reject(new Error('命令超时（无回包）')); }, timeoutMs + 8000) : null;
        function done(v){ if (to) clearTimeout(to); resolve(v || {}); }
        function fail(e){ if (to) clearTimeout(to); reject(e instanceof Error ? e : new Error(String(e))); }
        bridge.pend[id] = { resolve: done, reject: fail, onDone: done, onError: fail };
        bridge.send({ t: 'cmd', id: id, cmd: exe, args: args || [], cwd: cwd || '', timeoutMs: timeoutMs || 0 });
      });
    },
    /* v1.1.26：运行时插件（Python 等）安装 / 列表 / 执行 */
    runtime: function(op, payload){
      if (!this.ok) return Promise.reject(new Error('需要 exe 宿主版才能管理运行时'));
      payload = payload || {};
      return new Promise(function(resolve, reject){
        var id = 'rt' + (++bridge.seq);
        bridge.pend[id] = { resolve: resolve, reject: reject };
        var msg = {};
        for (var k in payload) msg[k] = payload[k];
        msg.t = 'runtime'; msg.id = id; msg.op = op;
        bridge.send(msg);
      });
    },
    media: function(opts){ // v0.2.4：宿主侧下载视频（带 Referer/UA，落盘到 下载\SoloChat）
      if (!this.ok) return Promise.reject(new Error('需要 exe 宿主版才能保存到磁盘'));
      opts = opts || {};
      var id = 'md' + (++this.seq);
      return new Promise(function(res, rej){
        bridge.pend[id] = { resolve: res, reject: rej, onProgress: opts.onProgress };
        bridge.send({ t: 'media', id: id, action: opts.bvid ? 'bili' : 'url', bvid: opts.bvid || '',
          url: opts.url || '', qn: opts.qn || 80, referer: opts.referer || '',
          proxy: (typeof S !== 'undefined' && S.cfg && S.cfg.proxy) || '' });
      });
    },
    file: function(opts){ // v0.2.8：通用 URL → 磁盘（图片/PDF/Office/压缩包…），需要 exe 版
      if (!this.ok) return Promise.reject(new Error('需要 exe 宿主版才能保存到磁盘'));
      opts = opts || {};
      var id = 'fl' + (++this.seq);
      return new Promise(function(res, rej){
        bridge.pend[id] = { resolve: res, reject: rej, onProgress: opts.onProgress };
        bridge.send({ t: 'file', id: id, url: opts.url || '', name: opts.name || '', readBack: !!opts.readBack,
          proxy: (typeof S !== 'undefined' && S.cfg && S.cfg.proxy) || '' });
      });
    },
    reveal: function(path){ if (this.ok && path) this.send({ t: 'reveal', path: path }); },
    pkg: function(name, files, where){ /* v1.23：扩展包导出到磁盘（宿主落盘，仅限桌面/下载下同名文件夹） */
      if (!this.ok) return Promise.reject(new Error('需要 exe 宿主版才能写入磁盘'));
      var id = 'pk' + (++this.seq);
      return new Promise(function(res, rej){
        bridge.pend[id] = { resolve: res, reject: rej };
        bridge.send({ t: 'pkg', id: id, name: name, where: where || 'desktop', files: files || [] });
      });
    },
    vault: function(op, name, value){ // F4：密钥保险库（DPAPI），get→string|null / set→void
      if (!this.ok) return Promise.resolve(null);
      var id = 'v' + (++this.seq);
      return new Promise(function(res, rej){
        bridge.pend[id] = { resolve: res, reject: rej };
        var msg = { t: 'secret', op: op, name: name, id: id };
        if (value !== undefined) msg.value = value;
        bridge.send(msg);
      });
    }
  };
  function bridgeStream(opt){
    var id = 'r' + (++bridge.seq);
    var tacc = makeToolAcc();   // v0.8.3：桥通道同样采集 tool_calls
    var finished = false, rawBuf = '';
    _lastRaw = '';
    function saveRaw(){ if (rawBuf.length > 16384) rawBuf = rawBuf.slice(-16384); _lastRaw = rawBuf; try { NET._lastRaw = _lastRaw; } catch (e) {} }
    function finErr(e){
      if (finished) return; finished = true;
      saveRaw();
      delete bridge.pend[id];
      opt.onError(e);
    }
    var parser = createParserFor(protocolNow(), opt.onDelta, function(u){ opt.onUsage(u); },
      function(msg){ finErr(new Error('上游错误：' + msg)); });
    bridge.pend[id] = {
      onChunk: function(text){
        if (finished) return;
        rawBuf += text; saveRaw();
        scanToolCalls(tacc, text, protocolNow());
        if (parser.feed(text) === true){ // v0.3.38：桥通道也在收到 [DONE] 时收尾
          if (finished) return; finished = true;
          saveRaw();
          delete bridge.pend[id];
          try { bridge.abort(id); } catch (e) {}
          parser.end(); opt.onDone(null, tacc.list());
        }
      },
      onDone: function(status){
        if (finished) return; finished = true;
        saveRaw();
        delete bridge.pend[id];
        // Issue 12: 非 2xx 视为失败（此前 401/500 仍当成功，UI 停在空回复且无错误提示）
        if (status != null && (status < 200 || status >= 300)) {
          var e = new Error('HTTP ' + status); e.status = status; e.name = 'HttpError';
          opt.onError(e); return;
        }
        parser.end(); opt.onDone(status == null ? null : status, tacc.list());
      },
      onError: finErr
    };
    bridge.send({
      t: 'http', id: id,
      direct: isDirectHost(endpoint()),
      url: endpoint(),
      method: 'POST',
      headers: hostHeaders(authHeaders(), endpoint()),
      body: JSON.stringify(opt.body)
    });
    return { abort: function(){
      bridge.abort(id);
      var e = new Error('aborted'); e.name = 'AbortError';
      finErr(e); // 中止也要走完成回调，否则 UI 卡在发送态
    } };
  }

  /* 内置 mock：离线演示流式+推理+usage */
  var MOCK_REPLY = [
    '这是**离线演示**回复：「%Q」。演示流式、Markdown、代码块与操作条。\n\n',
    '```js\nconsole.log("你好")\n```\n\n> 配置 Base URL 后即为真实对话。\n\n',
    '行内 `code`、*斜体*、**粗体**、[链接](https://example.com)、表格：\n\n| 项 | 值 |\n| --- | --- |\n| SSE | 正常 |'
  ].join('');
  var MOCK_REASON = '（演示）组织覆盖 Markdown 各元素的回复。';
  function mockStream(opt){
    var q = '';
    var lastU = null;
    for (var i = opt.body.messages.length - 1; i >= 0; i--)
      if (opt.body.messages[i].role === 'user'){ lastU = opt.body.messages[i]; break; }
    if (lastU) q = (typeof lastU.content === 'string' ? lastU.content : '（含图片）').slice(0, 60);
    var text = MOCK_REPLY.replace('%Q', q || '…');
    /* 文件 Agent 演示：读→写申请→确认 */
    var lastText = lastU && typeof lastU.content === 'string' ? lastU.content : '';
    if (S.cfg.mode === 'agent' && lastText.indexOf('[fs-result]') === 0){
      if (lastText.indexOf('已确认写入') >= 0 || lastText.indexOf('已拒绝写入') >= 0 || lastText.indexOf('已写入工作区') >= 0) text = '文件 Agent 演示完成：写入申请已处理，工作区状态已同步。还需要我做别的吗？';
      else if (lastText.indexOf('失败') >= 0) text = '工具调用失败了（见上方 [fs-result] 消息）。可检查工作区设置后重试。';
      else text = '好的：\n\n```fs-write\nreadme.md\n# 说明\n```\n\n请卡片上确认写入。';
    } else if (S.cfg.mode === 'agent' && /文件|fs/i.test(q)) text = '好的，我先看一下工作区里有什么：\n\n```fs-list\n\n```\n\n```fs-read\nreadme.md\n```';
    else if (S.cfg.mode === 'work' && lastText.indexOf('[run-result]') === 0 && lastText.indexOf('[vfs]') >= 0) text = '文件已写入并核对（见上条 [vfs] 结果）。打开预览自检：\n\n```preview\nindex.html\n```\n\n交付完成：\n\n验收清单\n1. 页面生成并运行通过（见 [run-result]）\n2. 产物已写入虚拟工作区 index.html\n3. 已知限制：无';
    else if (S.cfg.mode === 'work' && lastText.indexOf('[vfs]') === 0) text = '文件已写入。打开预览自检：\n\n```preview\nindex.html\n```\n\n交付完成：\n\n验收清单\n1. 页面生成并运行通过\n2. 产物已写入虚拟工作区 index.html\n3. 已知限制：无';
    else if (S.cfg.mode === 'work' && lastText.indexOf('[run-result]') === 0 && lastText.indexOf('js 成功') >= 0) text = '运行通过。写入产物到虚拟工作区：\n\n```vfs-write\nindex.html\n<h1>hello</h1>\n```';
    else if (S.cfg.mode === 'work' && lastText.indexOf('[preview]') >= 0) text = '预览已打开并核对（见上条 [preview] 结果），页面标题与预期一致。交付完成，不再调用工具。';
    else if (S.cfg.mode === 'work') text = '好的：\n\n```run\njs\nconsole.log("ok");\n```';
    var aborted = false;
    var steps = [], si = 0;
    for (i = 0; i < MOCK_REASON.length; i += 3) steps.push({ t: MOCK_REASON.slice(i, i + 3), r: true });
    for (i = 0; i < text.length; i += 2) steps.push({ t: text.slice(i, i + 2), r: false });
    var timer = setInterval(function(){
      if (aborted) return;
      if (si >= steps.length){
        clearInterval(timer);
        opt.onUsage({ prompt_tokens: 128, completion_tokens: Math.ceil(text.length / 4), total_tokens: 128 + Math.ceil(text.length / 4), prompt_cache_hit_tokens: 96 });
        opt.onDone(null);
        return;
      }
      var s = steps[si++];
      opt.onDelta(s.t, s.r);
    }, 18);
    return { abort: function(){
      if (aborted) return;
      aborted = true; clearInterval(timer);
      var e = new Error('aborted'); e.name = 'AbortError';
      opt.onError(e); // 通知 UI 结束流式态
    } };
  }

  /* 文件 Agent 桥：优先桥，mock 走内存 */
  var MOCK_FS = { // 内存 VFS：离线验收文件 Agent 全链路
    'readme.md': '# 演示工作区\n\nmock 文件系统根目录，可在设置换真实目录。\n',
    'src/main.js': 'function main(){\n  console.log("hello SoloChat");\n}\nmain();\n',
    'src/util.js': 'function add(a, b){ return a + b; }\nmodule.exports = { add: add };\n' };
  function mockFs(op, path, data){
    return sleep(120).then(function(){
      var p = String(path || ''), key; // GuardPath 同款：绝对路径/.. 拒绝
      if (/^[A-Za-z]:[\\/]/.test(p) || p.indexOf('..') >= 0) throw new Error('必须使用工作区内相对路径（越界已拒绝）');
      key = p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (op === 'config' || op === 'setroot') return { root: 'mock://workspace' };
      if (op === 'rmroot') return { root: '' };
      if (op === 'write'){
        if (!key) throw new Error('路径为空');
        if ((data || '').length > LIMITS.FS_WRITE_MAX) throw new Error('内容超过 ' + Math.round(LIMITS.FS_WRITE_MAX / 1024) + 'KB，拒绝写入');
        MOCK_FS[key] = data || '';
        return { path: p, bytes: (data || '').length };
      }
      if (op === 'writeb64'){
        if (!key) throw new Error('路径为空');
        var b64 = String(data || ''), comma = b64.indexOf(',');
        if (/^data:/i.test(b64) && comma >= 0) b64 = b64.slice(comma + 1);
        var n = Math.floor(b64.length * 3 / 4);
        MOCK_FS[key] = '〔二进制附件 ' + n + ' 字节〕';
        return { path: p, bytes: n };
      }
      if (op === 'read'){
        var t = MOCK_FS[key];
        if (t == null) throw new Error('文件不存在: ' + p);
        return { path: p, text: t, bytes: t.length, lines: t.split('\n').length };
      }
      if (op === 'list'){
        var dirs = {}, files = {}, entries = [], k;
        for (k in MOCK_FS){
          if (key && k.indexOf(key + '/') !== 0) continue;
          var rest = key ? k.slice(key.length + 1) : k, sl = rest.indexOf('/');
          if (sl >= 0) dirs[rest.slice(0, sl)] = 1; else files[rest] = MOCK_FS[k].length;
        }
        for (k in dirs) entries.push({ n: k, d: true, s: 0 });
        for (k in files) entries.push({ n: k, d: false, s: files[k] });
        return { path: p, entries: entries, truncated: false };
      }
      throw new Error('未知文件操作: ' + op);
    });
  }
  function fsCall(op, path, data, root, out){
    if (isMock()) return mockFs(op, path, data);
    return new Promise(function(res, rej){
      if (!bridge.ok){ rej(new Error('文件 Agent 需在 SoloChat 宿主内或 mock 模式使用')); return; }
      var id = 'f' + (++bridge.seq);
      bridge.pend[id] = { onChunk: function(){}, onDone: res, onError: rej };
      // out=1：工作区外写入（页面已弹出位置+操作详情确认，宿主仍会做系统目录/重解析点校验）
      bridge.send({ t: 'fs', id: id, op: op, path: path || '', data: data == null ? '' : data, root: root || '', out: !!out });
      setTimeout(function(){ // setroot 含选目录交互放宽超时；普通 IO 15s
        if (bridge.pend[id]){ delete bridge.pend[id]; rej(new Error('文件操作超时')); }
      }, op === 'setroot' ? 300000 : 15000);
    });
  }

  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  /* v0.5.5：托盘气泡（Soul 定时任务提醒）；没有宿主时静默跳过 */
  function notify(title, body){
    try { if (bridge.ok) bridge.send({ t: 'notify', title: String(title || 'SoloChat'), body: String(body || '') }); } catch (e) {}
  }

  /* v0.5.4：Soul 记忆落盘（宿主 mem op；文件优先，浏览器里退回 localStorage） */
  function memCall(op, name, text){
    return new Promise(function(res, rej){
      if (!bridge.ok){ rej(new Error('记忆落盘需要 SoloChat 宿主（浏览器版仍在 localStorage）')); return; }
      var id = 'm' + (++bridge.seq);
      bridge.pend[id] = { onChunk: function(){}, onDone: res, onError: rej };
      bridge.send({ t: 'mem', id: id, op: op || 'load', name: name || '', text: text == null ? '' : text });
      setTimeout(function(){ if (bridge.pend[id]){ delete bridge.pend[id]; rej(new Error('记忆操作超时')); } }, 15000);
    });
  }

  /* v0.5.17：手机 ↔ 电脑 配对服务（桌面宿主） */
  function pairCall(op, data){
    return new Promise(function(res, rej){
      if (!bridge.ok){ rej(new Error('配对需要桌面宿主')); return; }
      var id = 'pp' + (++bridge.seq);
      bridge.pend[id] = { resolve: res, reject: rej };
      var msg = { t: 'pair', id: id, op: op || 'status' };
      if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) msg[k] = data[k];
      bridge.send(msg);
      setTimeout(function(){ if (bridge.pend[id]){ delete bridge.pend[id]; rej(new Error('配对操作超时')); } }, 15000);
    });
  }

  /* ---- 联网搜索管线：查询预处理 → LLM 改写 → 九源检索 → 网页正文抓取 → 结构化注入 ---- */
  var SEARCH_HEADS = ['请帮我查', '请帮我搜索', '请帮我', '麻烦帮我', '能不能帮我', '可以帮我', '麻烦', '请你', '请问',
    '帮我查', '帮我搜索', '帮我', '给我查', '查一下', '查询一下', '搜一下', '搜索一下', '检索一下',
    '找一下', '查找一下', '想知道', '我要查', '我要搜索'];
  var SEARCH_REFER = /(第\s*[一二三四五六七八九十\d]+\s*[个条项种类号页章节款]|上面|前面|刚才|之前|后者|前者|上述|上文|这个问题|那个问题|该问题|这些|那些|这个|那个|它|他们)/;

  /* 规则预处理（档①）：去客套前缀；短且含指代 → 判定追问，拼上上一条用户消息 */
  function prepQuery(raw, prev){
    var s = String(raw || '').trim().replace(/\s+/g, ' ');
    for (var pass = 0; pass < 3; pass++){ // 多轮去客套：麻烦请帮我查一下… → 实体
      var before = s;
      for (var i = 0; i < SEARCH_HEADS.length; i++){
        if (s.indexOf(SEARCH_HEADS[i]) === 0){
          var rest = s.slice(SEARCH_HEADS[i].length)
            .replace(/^[\s,，。.、;；:：!！?？]+/, '').replace(/^一下/, '')
            .replace(/^[\s,，。.、;；:：!！?？]+/, '');
          if (rest) s = rest;
          break;
        }
      }
      if (s === before) break;
    }
    var follow = s.length > 0 && s.length <= 40 && SEARCH_REFER.test(s);
    if (follow && prev){
      var p = String(prev).replace(/\s+/g, ' ').trim();
      if (p) s = p.slice(-160) + ' ' + s;
    }
    return { q: s || String(raw || '').trim(), follow: follow };
  }
  /* 当前消息发送前已入列，取更早的一条不同内容的用户消息作追问上下文 */
  function lastUserBefore(msgs, raw){
    var t = String(raw || '').trim();
    for (var i = (msgs || []).length - 1; i >= 0; i--){
      var m = msgs[i];
      if (m && m.role === 'user'){
        var c = String(m.content || '').trim();
        if (c && c !== t) return c;
      }
    }
    return null;
  }

  /* 非流式 chat 补全（查询改写用）：双通道，任何失败返回 null */
  function chatOnce(messages, opt){
    opt = opt || {};
    var base = opt.baseURL || S.cfg.baseURL, model = opt.model || S.cfg.currentModel;
    if (!normBase(base) || !model) return Promise.resolve(null);
    var headers = authHeaders(opt.apiKey);
    var body = { model: model, messages: messages, stream: false,
      temperature: opt.temperature == null ? 0.2 : opt.temperature, max_tokens: opt.maxTokens || 160 };
    applyQuirks(body);
    /* v1.1.24：timeout=0 表示不设超时；未传才用 15s 默认 */
    var ms = (opt.timeout == null ? 15000 : opt.timeout);
    var url = endpoint('chat', false, opt.baseURL, model);
    if (bridge.ok && S.cfg.useBridge){
      return new Promise(function(resolve){
        var id = 'q' + (++bridge.seq), acc = '', fin = false;
        var to = ms > 0 ? setTimeout(function(){ if (fin) return; fin = true; bridge.abort(id); delete bridge.pend[id]; resolve(null); }, ms) : null;
        function stop(){ if (!fin){ fin = true; if (to) clearTimeout(to); delete bridge.pend[id]; } }
        bridge.pend[id] = {
          onChunk: function(t){ if (acc.length < 500000) acc += t; },
          onDone: function(status){
            if (fin) return; stop();
            if (status && (status < 200 || status >= 300)){ console.warn('[chatOnce] http ' + status + ' ' + String(acc).slice(0, 300)); return resolve(null); }
            try { var jj = JSON.parse(acc); var ms0 = parseNonStream(jj); if (!ms0 || !String(ms0.content || '').trim()) console.warn('[chatOnce] empty content, finish=' + (jj.choices[0].finish_reason) + ' msg=' + JSON.stringify(ms0).slice(0, 260)); resolve(ms0); } catch (e) { console.warn('[chatOnce] parse fail ' + String(acc).slice(0, 200)); resolve(null); }
          },
          onError: function(){ stop(); resolve(null); }
        };
        bridge.send({ t: 'http', id: id, direct: isDirectHost(url), url: url, method: 'POST', headers: headers, body: JSON.stringify(body) });
      });
    }
    var ac = new AbortController();
    var t = ms > 0 ? setTimeout(function(){ ac.abort(); }, ms) : null;
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ac.signal })
      .then(function(res){ if (t) clearTimeout(t); if (!res.ok) return null; return res.json(); })
      .then(function(j){ if (t) clearTimeout(t); return parseNonStream(j); })
      .catch(function(){ if (t) clearTimeout(t); return null; });
  }
  /* 搜索规划（档③，v1.4.2 / 本次）：模型给出「简化检索词」。need 字段仅为兼容保留；
     searchWeb 不再因为 need:false 跳过联网（用户手动打开联网开关即视为要搜索）。
     调用失败/关改写 → 回退 {need:true, q:原查询}。 */
  function planSearch(q, msgs){
    var fb = { need: true, q: q };
    if (!S.cfg.searchRewrite || isMock()) return Promise.resolve(fb);
    var sys = '你是联网搜索规划器。对用户问题做两步判断与处理：' +
      '(1)是否需要实时联网搜索才能准确回答——需要：最新新闻/公告、实时数据(价格、天气、股价、赛况)、近期事件、' +
      '某个具体网页的内容、或你不确定且时效性强的事实；不需要：常识问答、数学计算、代码编写调试、通用概念解释、闲聊、创作写作。' +
      '(2)若需要，把问题精简成一条适合网页搜索的检索词：保留实体、年份、数字，去掉客套与指代。' +
      '严格输出两行：第一行只能是 YES 或 NO；第二行在 YES 时为检索词(不带引号与解释)、在 NO 时为一个减号 -。不要输出其它任何内容。';
    var ctx = '';
    (msgs || []).slice(-3).forEach(function(m){
      if (m && m.role === 'user' && m.content) ctx += '用户：' + String(m.content).slice(0, 160) + '\n';
    });
    return chatOnce([
      { role: 'system', content: sys },
      { role: 'user', content: (ctx ? '最近对话：\n' + ctx : '') + '当前问题：' + q }
    ], { temperature: 0.2, maxTokens: 120, timeout: 15000 }).then(function(m){
      var r = m && m.content ? String(m.content).trim() : '';
      var lines = r.split(/\r?\n/).map(function(s){ return s.trim(); })
        .filter(function(s){ return s && !/^```/.test(s); });
      if (!lines.length) return fb;
      var head = lines[0];
      var no = /^no/i.test(head) || /不需要|无需/.test(head);
      var yes = /^yes/i.test(head) || (/需要/.test(head) && !no);
      if (no) return { need: false, q: q };
      if (yes){
        var rq = (lines[1] || '').replace(/^[-—:：]\s*/, '')
          .replace(/^["'「『\s]+/, '').replace(/["'」』\s]+$/, '').replace(/\s+/g, ' ');
        return { need: true, q: (rq.length >= 2 && rq.length <= 200) ? rq : q };
      }
      return fb; // 无法识别 → 保守回退为需要搜索（保持联网开关语义）
    });
  }

  function safeUrl(u){
    try {
      var p = new URL(String(u));
      return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : null;
    } catch (e) { return null; }
  }
  /* HTML → 纯文本：块级标签先转 \n，再去脚本样式与导航壳 */
  function htmlToText(html){
    var src = String(html || '')
      .replace(/<(br\s*\/?|\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre))\s*>/gi, '\n');
    var doc = null;
    try { doc = new DOMParser().parseFromString(src, 'text/html'); } catch (e) { return ''; }
    if (!doc || !doc.body) return '';
    var drop = doc.querySelectorAll('script,style,noscript,svg,canvas,iframe,nav,header,footer,aside,form,button,select,textarea,template');
    for (var i = 0; i < drop.length; i++) if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]);
    return (doc.body.textContent || '').replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  /* 单页抓取（档④）：桥 GET 优先，浏览器直连受 CORS 约束，失败返回 null（回退摘要） */
  /* v0.2.3：把外部地址交给宿主 —— mode='window' 是应用内播放窗口（同一浏览器环境，带 cookie/登录态），
     'browser' 是系统默认浏览器。纯网页版退化为 window.open。 */
  /* v0.2.8：通用抓取 —— 宿主把 URL 存成文件（按真实类型命名），文档类回传字节让页面本地解析 */
  function fileGet(url, name, onProgress){
    var u = safeUrl(url);
    if (!u) return Promise.reject(new Error('地址无效'));
    return bridge.file({ url: u, name: name || '', readBack: true, onProgress: onProgress });
  }
  function fileText(entry){
    if (!entry || !entry.b64) return Promise.resolve('');
    var bin = atob(String(entry.b64).replace(/\s/g, ''));
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    var ext = String(entry.name || entry.path || '').split('.').pop().toLowerCase();
    if (/^(docx|xlsx|pptx|pdf|rtf|epub)$/.test(ext)){
      try { return DOC.parse(new File([u8], entry.name || ('file.' + ext))); }
      catch (e) { return Promise.reject(e); }
    }
    try { return Promise.resolve(new TextDecoder('utf-8').decode(u8)); }
    catch (e) { return Promise.resolve(''); }
  }
  /* v0.2.4：视频下载（宿主做，页面只收进度/结果） */
  function mediaDownload(opts){ return bridge.media(opts); }
  function revealPath(path){ bridge.reveal(path); }
  function openExternal(url, mode){
    var u = safeUrl(url);
    if (!u) return false;
    if (bridge.ok){
      try { bridge.send({ t: 'open', url: u, mode: mode || 'window' }); return true; } catch (e) {}
    }
    try { window.open(u, '_blank', 'noopener'); return true; } catch (e) {}
    return false;
  }
  /* v0.2.4：图片/媒体/压缩包之类抓成文本只会得到乱码，直接拒掉（web 工具只取文本） */
  var BIN_RE = /\.(jpe?g|png|gif|webp|ico|bmp|avif|heic|mp4|m4s|mp3|m4a|flv|mov|avi|mkv|zip|rar|7z|gz|tar|pdf|woff2?|ttf|otf|eot|wasm|exe|msi|dmg|apk|jar)(\?|#|$)/i;
  function isBinaryUrl(u){
    try { return BIN_RE.test(new URL(String(u)).pathname); } catch (e) { return BIN_RE.test(String(u)); }
  }
  function looksBinary(t){
    if (!t) return false;
    var n = Math.min(t.length, 4000), bad = 0;
    for (var i = 0; i < n; i++){
      var c = t.charCodeAt(i);
      if (c === 0xFFFD || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++;
    }
    return n > 0 && bad / n > 0.02;
  }
  var lastFetchErr = '';
  /* v0.7.0：批量抓取 —— 给起点 URL，沿 #next_url 连续抓 N 页；走宿主桥，失败记录原因不中断 */
  function crawl(startUrl, opts){
    opts = opts || {};
    var maxPages = Math.min(LIMITS.CRAWL_MAX_PAGES || 2000, Math.max(1, parseInt(opts.max, 10) || 20));
    var followNext = opts.next !== false;
    var delay = Math.max(0, parseInt(opts.delay, 10) || 250);
    var out = [], fails = [], seen = {}, url = safeUrl(startUrl);
    function absHref(h, base){
      try { return new URL(String(h || '').trim(), base).href; } catch (e) { return ''; }
    }
    /* v1.1.14：不再只认 id="next_url"。很多小说站用 rel=next / “下一章”文字 / 相对地址。 */
    function nextFromDoc(doc, base){
      if (!doc) return '';
      var a = doc.querySelector('#next_url[href], a[rel="next"][href], link[rel="next"][href]');
      if (a) return absHref(a.getAttribute('href'), base);
      var as = doc.querySelectorAll('a[href]'), i, t, h;
      for (i = 0; i < as.length; i++){
        t = String(as[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (/^(下一[章页節节]|下章|下一节|next)(\s|$)/i.test(t) || /下一[章页節节]|下章|next chapter/i.test(t)){
          h = absHref(as[i].getAttribute('href'), base); if (h) return h;
        }
      }
      for (i = 0; i < as.length; i++){
        h = String(as[i].getAttribute('href') || '');
        if (/(next|xia|下一)/i.test(h) && !/(prev|上一|back)/i.test(h)){
          var hh = absHref(h, base); if (hh) return hh;
        }
      }
      return '';
    }
    /* 目录页直接列出章节链接时，按列表逐章抓，避免“下一章”在某一章断掉只抓 30 多章 */
    function chapterLinksFromDoc(doc, base){
      if (!doc) return [];
      var as = doc.querySelectorAll('a[href]'), items = [], seenH = {}, i, t, h, mm;
      var bu = null; try { bu = new URL(base); } catch (e) { bu = null; }
      var dir = bu ? bu.pathname.replace(/[^/]*$/, '') : '';
      for (i = 0; i < as.length; i++){
        t = String(as[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (!/第\s*[0-9一二三四五六七八九十百千]+\s*章/.test(t)) continue;
        h = absHref(as[i].getAttribute('href'), base);
        if (!h || !/^https?:\/\//i.test(h) || seenH[h]) continue;
        /* 过滤“推荐阅读/其他书”的章节链接，只留同一本书目录下 */
        try {
          var hu = new URL(h);
          if (bu && (hu.host !== bu.host || (dir && hu.pathname.indexOf(dir) !== 0))) continue;
        } catch (e2) { continue; }
        seenH[h] = 1;
        mm = /第\s*(\d+)\s*章/.exec(t);
        items.push({ u: h, n: mm ? +mm[1] : 0 });
      }
      /* 目录常见倒序；有阿拉伯章号时按章号升序，保证从第一章开始 */
      if (items.length > 1 && items[0].n && items[items.length - 1].n){
        items.sort(function(a, b){ return a.n - b.n; });
      }
      return items.map(function(x){ return x.u; });
    }
    function crawlList(list, ref){
      var idx = 0, lastNext = '', lastUrl = '';
      function nextOne(){
        if (idx >= list.length || out.length >= maxPages){
          /* 目录只列出前 30 章时，从最后一章继续沿「下一章」抓，避免 60 章只抓 30 章 */
          if (lastNext && out.length < maxPages) return step(lastNext, out.length, lastUrl);
          return Promise.resolve();
        }
        var cu = list[idx++];
        if (seen[cu]) return nextOne();
        seen[cu] = 1;
        return one(cu, ref).then(function(r){
          if (r.err){ fails.push({ url: cu, err: r.err }); return nextOne(); }
          var doc = null;
          try { doc = new DOMParser().parseFromString(r.html || '', 'text/html'); } catch (e) { doc = null; }
          var h1 = doc && doc.querySelector('h1');
          var title = h1 ? String(h1.textContent || '').replace(/\s+/g, ' ').trim()
                         : ((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(r.html) || [,''])[1] || '').replace(/<[^>]+>/g, '').trim();
          lastNext = nextFromDoc(doc, cu); lastUrl = cu;
          out.push({ url: cu, title: title, text: htmlToText(r.html), next: lastNext });
          return new Promise(function(res){ setTimeout(res, delay); }).then(nextOne);
        });
      }
      return nextOne();
    }
    /* 起点是“目录页”时，自动找第一章/开始阅读 */
    function firstChapterFromDoc(doc, base){
      if (!doc) return '';
      var as = doc.querySelectorAll('a[href]'), i, t;
      for (i = 0; i < as.length; i++){
        t = String(as[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (/^(第[一1]章|开始阅读|立即阅读|从头阅读|start reading)(\s|$)/i.test(t) || /第[一1]章/.test(t)){
          var h = absHref(as[i].getAttribute('href'), base); if (h) return h;
        }
      }
      return '';
    }
    function one(u, referer){
      return new Promise(function(res){
        /* v0.9.3：没有宿主桥（浏览器版）时退回 fetch，同源或带 CORS 的站照样能抓 */
        if (!(bridge.ok && S.cfg.useBridge)){
          var ac = new AbortController();
          var t2 = setTimeout(function(){ try { ac.abort(); } catch (e) {} }, 20000);
          return fetch(u, { signal: ac.signal, headers: { 'Accept': 'text/html,application/xhtml+xml' } })
            .then(function(r){ clearTimeout(t2); if (!r.ok) return { err: 'HTTP ' + r.status }; return r.text().then(function(t){ return { html: t }; }); })
            .then(function(o){ res(o); })
            .catch(function(e){ clearTimeout(t2); res({ err: '连接失败：' + ((e && e.message) || '未知') }); });
        }
        var id = 'c' + (++bridge.seq), acc = '', fin = false;
        var to = setTimeout(function(){
          if (fin) return; fin = true; lastFetchErr = '超时（20s）';
          try { bridge.abort(id); } catch (e) {}
          delete bridge.pend[id]; res({ err: '超时 20s' });
        }, 20000);
        bridge.pend[id] = {
          onChunk: function(t){ if (acc.length < 800000) acc += t; },
          onDone: function(status){
            if (fin) return; fin = true; clearTimeout(to); delete bridge.pend[id];
            if (!(status >= 200 && status < 300)){ lastFetchErr = 'HTTP ' + status; return res({ err: 'HTTP ' + status }); }
            res({ html: acc });
          },
          onError: function(e){
            if (fin) return; fin = true; clearTimeout(to); delete bridge.pend[id];
            lastFetchErr = '连接失败：' + ((e && e.message) || '未知');
            res({ err: lastFetchErr });
          }
        };
        bridge.send({ t: 'http', id: id, direct: isDirectHost(u), url: u, method: 'GET', cookies: true,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
                     'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9',
                     'Referer': referer || u } });
      });
    }
    function step(u, n, ref){
      if (!u || out.length >= maxPages) return Promise.resolve();
      if (seen[u]){ fails.push({ url: u, err: '循环引用' }); return Promise.resolve(); }
      seen[u] = 1;
      return one(u, ref).then(function(r){
        if (r.err){ fails.push({ url: u, err: r.err }); return; }
        var doc = null;
        try { doc = new DOMParser().parseFromString(r.html || '', 'text/html'); } catch (e) { doc = null; }
        var h1 = doc && doc.querySelector('h1');
        var title = h1 ? String(h1.textContent || '').replace(/\s+/g, ' ').trim()
                       : ((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(r.html) || [,''])[1] || '').replace(/<[^>]+>/g, '').trim();
        var nxt = nextFromDoc(doc, u);
        var _isChapterTitle = /第\s*[0-9一二三四五六七八九十百千]+\s*章/.test(title);
        if (n === 0 && !_isChapterTitle){
          /* 目录页：拿目录里第一章的 URL（按章号排序），再沿章节页的“下一章”走。
             不要直接抓目录列表：有些站点的目录会漏/重复章节链接，章节页 next 才是完整链条。 */
          var _chapters0 = chapterLinksFromDoc(doc, u);
          if (_chapters0.length >= 1)
            return new Promise(function(res){ setTimeout(res, delay); }).then(function(){ return step(_chapters0[0], n, u); });
          var _first0 = firstChapterFromDoc(doc, u);
          if (_first0)
            return new Promise(function(res){ setTimeout(res, delay); }).then(function(){ return step(_first0, n, u); });
        }
        var _numM = /第\s*(\d+)\s*章/.exec(title);
        var _num = _numM ? +_numM[1] : 0;
        var _last = out[out.length - 1];
        /* “第5章（2/2）”这种同章分页并入上一章，不单独占一个章节名额 */
        if (_last && _num && _last.num && _num === _last.num){
          _last.text += '\n' + htmlToText(r.html);
          _last.next = nxt;
        } else {
          out.push({ url: u, title: title, text: htmlToText(r.html), next: nxt, num: _num });
        }
        if (!followNext || !nxt || out.length >= maxPages) return;
        return new Promise(function(res){ setTimeout(res, delay); }).then(function(){ return step(nxt, n + 1, u); });
      });
    }
    return step(url, 0, '').then(function(){ return { pages: out, fails: fails, start: startUrl }; });
  }

  function fetchPageText(u){
    var href = safeUrl(u);
    if (!href) return Promise.resolve(null);
    if (isBinaryUrl(href)) return Promise.resolve(null); // 图片/视频等直接跳过
    var ms = 8000;
    if (bridge.ok && S.cfg.useBridge){
      return new Promise(function(resolve){
        var id = 'p' + (++bridge.seq), acc = '', fin = false;
        var to = setTimeout(function(){ if (fin) return; fin = true; bridge.abort(id); delete bridge.pend[id]; resolve(null); }, ms);
        function stop(){ if (!fin){ fin = true; clearTimeout(to); delete bridge.pend[id]; } }
        bridge.pend[id] = {
          onChunk: function(t){ if (acc.length < 400000) acc += t; },
          onDone: function(status){
            if (fin) return; stop();
            if (!(status >= 200 && status < 300)) return resolve(null);
            var txt = htmlToText(acc);
            resolve(looksBinary(txt) ? null : txt);
          },
          onError: function(){ stop(); resolve(null); }
        };
        bridge.send({ t: 'http', id: id, direct: isDirectHost(href), url: href, method: 'GET', cookies: true,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml' } });
      });
    }
    var ac = new AbortController();
    var t = setTimeout(function(){ ac.abort(); }, ms);
    return fetch(href, { signal: ac.signal, headers: { 'Accept': 'text/html,application/xhtml+xml' } })
      .then(function(res){ clearTimeout(t); if (!res.ok) return null; return res.text(); })
      .then(function(h){ clearTimeout(t); if (!h) return null; var txt = htmlToText(h); return looksBinary(txt) ? null : txt; })
      .catch(function(){ clearTimeout(t); return null; });
  }
  function fetchPages(list){
    if (!S.cfg.searchFetch || !list || !list.length) return Promise.resolve(list);
    var n = clamp(parseInt(S.cfg.searchFetchCount, 10), 0, 5);
    if (!n) return Promise.resolve(list);
    var jobs = [];
    for (var i = 0; i < list.length && jobs.length < n; i++){
      (function(it){
        /* 已是长文（Firecrawl markdown）或地址非法则跳过 */
        if (!it || !safeUrl(it.url) || it.full || String(it.text || '').length >= 1600) return;
        jobs.push(fetchPageText(it.url).then(function(t){
          if (t && t.length >= 120){ it.text = t.slice(0, 3500); it.full = 1; }
        }));
      })(list[i]);
    }
    return jobs.length ? Promise.all(jobs).then(function(){ return list; }) : Promise.resolve(list);
  }

  var lastHttpErr = '';
  /* 从非 2xx 响应体提取可读错误：优先 error / message / code（Firecrawl 的 insufficient_credits 必须保留） */
  function httpErrText(body){
    var raw = String(body == null ? '' : body).trim(), j = null;
    if (!raw) return '';
    try { j = JSON.parse(raw); } catch (e) { j = null; }
    if (!j || typeof j !== 'object') return raw.replace(/\s+/g, ' ').slice(0, 200);
    var out = [];
    function push(v){
      if (v == null || v === '' || out.length >= 6) return;
      if (typeof v === 'object'){
        if (Array.isArray(v)){ for (var i = 0; i < v.length && out.length < 6; i++) push(v[i]); return; }
        var ks = ['error', 'code', 'type', 'message', 'detail', 'details', 'reason'];
        for (var k = 0; k < ks.length; k++) if (v[ks[k]] != null) push(v[ks[k]]);
        return;
      }
      var s = String(v).replace(/\s+/g, ' ').trim();
      if (s && out.indexOf(s) < 0 && out.length < 6) out.push(s);
    }
    push(j.code); push(j.error); push(j.message);
    if (!out.length) push(j.detail || j.details || j.reason);
    return (out.length ? out.join('；') : raw).replace(/\s+/g, ' ').slice(0, 200);
  }
  /* POST/GET JSON 双通道：桥/fetch，超时或非 2xx 返回 null */
  function httpJSON(req, ms){
    ms = ms || 15000;
    lastHttpErr = '';
    if (bridge.ok && S.cfg.useBridge){
      return new Promise(function(resolve){
        var id = 's' + (++bridge.seq), acc = '', fin = false;
        var to = setTimeout(function(){ if (fin) return; fin = true; bridge.abort(id); delete bridge.pend[id]; resolve(null); }, ms);
        function stop(){ if (!fin){ fin = true; clearTimeout(to); delete bridge.pend[id]; } }
        bridge.pend[id] = {
          onChunk: function(t){ if (acc.length < 1000000) acc += t; },
          onDone: function(status){
            if (fin) return; stop();
            if (status && (status < 200 || status >= 300)){
              var em = httpErrText(acc);
              lastHttpErr = 'HTTP ' + status + (em ? '：' + em : '');
              return resolve(null);
            }
            lastHttpErr = '';
            try { resolve(req.parse(JSON.parse(acc))); } catch (e) { resolve(null); }
          },
          onError: function(){ stop(); resolve(null); }
        };
        bridge.send({ t: 'http', id: id, direct: isDirectHost(req.url), url: req.url, method: req.method || 'POST', headers: req.headers, body: req.body });
      });
    }
    var ac = new AbortController();
    var t = setTimeout(function(){ ac.abort(); }, ms);
    var mth = req.method || 'POST';
    return fetch(req.url, { method: mth, headers: req.headers, body: mth === 'GET' ? undefined : req.body, signal: ac.signal })
      .then(function(res){
        clearTimeout(t);
        if (!res.ok){
          return res.text().then(function(txt){
            var em = httpErrText(txt);
            lastHttpErr = 'HTTP ' + res.status + (em ? '：' + em : '');
            return null;
          }, function(){ lastHttpErr = 'HTTP ' + res.status; return null; });
        }
        return res.json();
      })
      .then(function(j){ clearTimeout(t); if (!j) return null; lastHttpErr = ''; try { return req.parse(j); } catch (e) { return null; } })
      .catch(function(){ clearTimeout(t); return null; });
  }
  /* 各源响应解析（命名函数，便于单测抓取） */
  function parseSerper(j){
    return (j.organic || []).map(function(r){ return { title: r.title, url: r.link, text: r.snippet }; });
  }
  function parseSerpApi(j){
    return (j.organic_results || []).map(function(r){ return { title: r.title, url: r.link, text: r.snippet }; });
  }
  function parseBrave(j){
    return ((j.web && j.web.results) || []).map(function(r){ return { title: r.title, url: r.url, text: r.description }; });
  }
  function parseTavily(j){
    return (j.results || []).map(function(r){ return { title: r.title, url: r.url, text: (r.content || '').slice(0, 1500) }; });
  }
  function parseFirecrawl(j){
    return (j.data || []).map(function(r){
      return { title: (r.metadata && r.metadata.title) || '', url: (r.metadata && r.metadata.sourceURL) || '', text: (r.markdown || '').slice(0, 2000) };
    });
  }
  function parseBocha(j){
    var wp = (j && (j.webPages || (j.data && j.data.webPages))) || {};
    return (wp.value || []).map(function(r){ return { title: r.name, url: r.url, text: (r.summary || r.snippet || '').slice(0, 2000) }; });
  }
  function parseJina(j){
    return (j.data || []).map(function(r){ return { title: r.title, url: r.url, text: (r.content || r.description || '').slice(0, 2000) }; });
  }
  function parseExa(j){
    return (j.results || []).map(function(r){ return { title: r.title, url: r.url, text: (r.text || '').slice(0, 2000) }; });
  }
  /* v0.4.9：新增四家（Perplexity / 百度千帆 / You.com / Google Grounding） */
  function parsePerplexity(j){
    return (j.results || j.data || []).map(function(r){
      return { title: r.title || '', url: r.url || r.link || '', text: String(r.snippet || r.text || r.description || '').slice(0, 2000) };
    });
  }
  function parseBaidu(j){
    var arr = j.references || (j.data && j.data.references) || (j.data && j.data.results) || j.results || [];
    return arr.map(function(r){
      return { title: r.title || r.name || '', url: r.url || r.link || '', text: String(r.content || r.snippet || r.summary || '').slice(0, 2000) };
    });
  }
  function parseYou(j){
    var w = (j.results && (j.results.web || j.results.news)) || j.results || j.hits || [];
    if (!Array.isArray(w)) w = [];
    return w.map(function(r){
      var sn = r.snippets || r.snippet || r.description || '';
      if (Array.isArray(sn)) sn = sn.join(' ');
      return { title: r.title || '', url: r.url || '', text: String(sn).slice(0, 2000) };
    });
  }
  /* Google 的 Grounding 不是 SERP API：它是"带引用的回答"，这里转成一条 full 结果 */
  function parseGoogleGround(j){
    var cand = (j.candidates || [])[0] || {};
    var txt = ((cand.content && cand.content.parts) || []).map(function(p){ return p.text || ''; }).join('');
    var gm = cand.groundingMetadata || {};
    var chunks = gm.groundingChunks || [];
    var url = (chunks[0] && chunks[0].web && chunks[0].web.uri) || 'https://www.google.com/';
    var cites = chunks.map(function(c){
      return (c.web && c.web.uri) ? ('- ' + (c.web.title || '') + ' ' + c.web.uri) : '';
    }).filter(Boolean).join('\n');
    if (!txt) return [];
    return [{ title: 'Google 联网回答', url: url, text: (txt + (cites ? '\n\n来源：\n' + cites : '')).slice(0, 3000), full: true }];
  }


  /* v0.4.7：搜索缓存 + URL 归一化去重 + SearXNG/自定义解析 */
  var SEARCH_CACHE = {}, SEARCH_TTL = 10 * 60 * 1000;
  function dedupeKey(u){
    return String(u).toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  }
  function parseSearx(j){
    return ((j && j.results) || []).map(function(r){
      return { title: r.title, url: r.url, text: (r.content || r.snippet || '').slice(0, 2000) };
    });
  }
  function pickPath(o, path){
    if (!path) return o;
    var segs = String(path).replace(/^\$?\.?/, '').split(/[.\[\]]+/).filter(Boolean);
    var v = o;
    for (var i = 0; i < segs.length && v != null; i++) v = v[segs[i]];
    return v;
  }
  function parseCustom(j, c){
    var arr = pickPath(j, c.path || '');
    if (!Array.isArray(arr)) return [];
    return arr.map(function(r){
      return {
        title: String(pickPath(r, c.fTitle || 'title') || ''),
        url: String(pickPath(r, c.fUrl || 'url') || ''),
        text: String(pickPath(r, c.fText || 'snippet') || '').slice(0, 2000)
      };
    });
  }
  /* 检索：地址校验 + URL 去重 + 本地缓存 */
  function runProviders(query, num){
    var prov = (S.cfg.searchProvider || 'none').toLowerCase();
    var key = S.cfg.searchKey || '';
    var noKey = (prov === 'searxng' || prov === 'custom');
    if (prov === 'none' || (!key && !noKey)) return Promise.resolve(null);
    var ck = prov + '|' + String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
    var hit = SEARCH_CACHE[ck];
    if (hit && Date.now() - hit.ts < SEARCH_TTL) return Promise.resolve(hit.list);
    var req = null;
    if (prov === 'serper'){
      req = {
        url: 'https://google.serper.dev/search',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: num }),
        parse: parseSerper
      };
    } else if (prov === 'serpapi'){
      req = {
        method: 'GET',
        url: 'https://serpapi.com/search.json?engine=google&q=' + encodeURIComponent(query) + '&num=' + clamp(num, 1, 100) + '&api_key=' + encodeURIComponent(key),
        headers: { 'Accept': 'application/json' },
        parse: parseSerpApi
      };
    } else if (prov === 'brave'){
      req = {
        method: 'GET',
        url: 'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + clamp(num, 1, 20),
        headers: { 'X-Subscription-Token': key, 'Accept': 'application/json' },
        parse: parseBrave
      };
    } else if (prov === 'tavily'){
      req = {
        url: 'https://api.tavily.com/search',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, query: query, max_results: num }),
        parse: parseTavily
      };
    } else if (prov === 'firecrawl'){
      req = {
        url: 'https://api.firecrawl.dev/v1/search',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query, limit: num, scrapeOptions: { formats: ['markdown'] } }),
        parse: parseFirecrawl
      };
    } else if (prov === 'bocha'){
      req = {
        url: 'https://api.bochaai.com/v1/web-search',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query, count: num, freshness: 'noLimit', summary: true }),
        parse: parseBocha
      };
    } else if (prov === 'jina'){
      req = {
        url: 'https://s.jina.ai/',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ q: query, num: num }),
        parse: parseJina
      };
    } else if (prov === 'searxng'){
      var sb = String(S.cfg.searchBase || '').replace(/\/+$/, '');
      if (!sb) return Promise.resolve(null);
      req = { method: 'GET',
        url: sb + '/search?q=' + encodeURIComponent(query) + '&format=json',
        headers: { 'Accept': 'application/json' },
        parse: parseSearx };
    } else if (prov === 'custom'){
      var cc = S.cfg.searchCustom || {};
      if (!cc.url) return Promise.resolve(null);
      var curl = String(cc.url).replace(/\{q\}/g, encodeURIComponent(query)).replace(/\{n\}/g, String(num));
      req = { method: String(cc.method || 'GET').toUpperCase(), url: curl, headers: cc.headers || {},
        parse: function(j){ return parseCustom(j, cc); } };
    } else if (prov === 'perplexity'){
      req = { url: 'https://api.perplexity.ai/search',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query, max_results: num }),
        parse: parsePerplexity };
    } else if (prov === 'baidu'){
      req = { url: 'https://qianfan.baidubce.com/v2/ai_search/web_search',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: query }], search_source: 'baidu_search_v2',
          resource_type_filter: [{ type: 'web', top_k: num }] }),
        parse: parseBaidu };
    } else if (prov === 'you'){
      req = { method: 'GET',
        url: 'https://ydc-index.io/v1/search?query=' + encodeURIComponent(query) + '&count=' + num,
        headers: { 'X-API-Key': key, 'Accept': 'application/json' },
        parse: parseYou };
    } else if (prov === 'google'){
      /* Gemini 的 Grounding with Google Search：一次调用直接拿"带引用的回答" */
      var gm2 = S.cfg.searchModel || 'gemini-2.0-flash';
      req = { url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(gm2) +
          ':generateContent?key=' + encodeURIComponent(key),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: query }] }], tools: [{ google_search: {} }] }),
        parse: parseGoogleGround };
    } else if (prov === 'bing'){
      return Promise.resolve(null);   // Azure AI Agents 专属，当前未接入
    } else if (prov === 'exa'){
      req = {
        url: 'https://api.exa.ai/search',
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query, numResults: num, type: 'auto', contents: { text: { maxCharacters: 2000 } } }),
        parse: parseExa
      };
    } else return Promise.resolve(null);
    return httpJSON(req, 15000).then(function(list){
      if (!list || !list.length) return null;
      var seen = {}, out = [];
      for (var i = 0; i < list.length; i++){
        var it = list[i]; if (!it) continue;
        var u = safeUrl(it.url);
        if (!u) continue;                       // 非 http/https 直接丢弃
        var dk = dedupeKey(u);                  // 去 utm/尾斜杠/协议差异后判重
        if (seen[dk]) continue;
        seen[dk] = 1; it.url = u; it.source = prov; out.push(it);
      }
      if (!out.length) return null;
      SEARCH_CACHE[ck] = { ts: Date.now(), list: out };
      var ks = Object.keys(SEARCH_CACHE);
      if (ks.length > 80) for (var d = 0; d < ks.length - 80; d++) delete SEARCH_CACHE[ks[d]];
      return out;
    });
  }

  /* 结构化注入格式（档②）：编号 + 引用要求 + 正文/摘要标注，总量 16384 字符 */
  function fmtBlock(list, query){
    if (!list || !list.length) return null;
    function pad(x){ return x < 10 ? '0' + x : '' + x; }
    var ts = new Date();
    var stamp = ts.getFullYear() + '-' + pad(ts.getMonth() + 1) + '-' + pad(ts.getDate()) + ' ' + pad(ts.getHours()) + ':' + pad(ts.getMinutes());
    var entries = [], total = 0;
    for (var i = 0; i < list.length && total < 16384; i++){
      var body = String((list[i] && list[i].text) || '').slice(0, 3500);
      if (!body) continue;
      total += body.length;
      entries.push({ title: ((list[i].title || '').trim()) || '（无标题）', url: list[i].url || '', body: body, full: !!list[i].full });
    }
    if (!entries.length) return null;
    var out = ['【联网搜索结果 · ' + stamp + ' · 查询：' + query + '】',
      '作答要求：仅依据下列结果作答；关键论断在句末用「可点击引用链接」标注对应来源，格式 [标题](网址)，其中标题用该条结果的标题、网址用该条结果给出的链接（严禁编造未列出的网址）；' +
      '结果未覆盖的内容须明确说明「搜索结果未覆盖」；来源冲突时以较新来源为准。正文即为最终回答，不要再另起来源清单。'];
    for (var j = 0; j < entries.length; j++){
      var e = entries[j];
      out.push('[' + (j + 1) + '] ' + e.title + '\n' + e.url + '\n' + e.body + (e.full ? '' : '\n（摘要，未抓取网页全文）'));
    }
    return out.join('\n\n');
  }

  /* 搜索是否可用：开关只决定「开不开」，这里判断「开了能不能搜」。
     bing 是未接入的占位；searxng/custom 不要 Key 但要地址。 */
  function searchReady(){
    var prov = (S.cfg.searchProvider || 'none').toLowerCase();
    if (!prov || prov === 'none' || prov === 'bing') return false;
    if (prov === 'searxng') return !!String(S.cfg.searchBase || '').trim();
    if (prov === 'custom') return !!(S.cfg.searchCustom && String(S.cfg.searchCustom.url || '').trim());
    return !!String(S.cfg.searchKey || '').trim();
  }

  /* 入口：raw=用户原话；onStage=阶段回调（更新 live 指示器）；永不 reject */
  function searchWeb(raw, onStage, force){
    var stage = typeof onStage === 'function' ? onStage : function(){};
    lastHttpErr = '';
    if (!searchReady()){ stage('未配置搜索提供商'); return Promise.resolve(null); }
    var t0 = Date.now();
    var num = clamp(parseInt(S.cfg.searchCount, 10) || 5, 1, 10);
    var prep = prepQuery(raw, lastUserBefore(S.msgs, raw));
    var q = prep.q;
    function fail(){ return { block: null, n: 0, ms: Date.now() - t0, items: [], query: q, fail: true, err: lastHttpErr || '' }; }
    stage('判断是否需要联网搜索…');
    /* v0.2.1：Work 里是模型显式要求检索（search 围栏），跳过「是否需要联网」的二次判定，省一次模型调用 */
    return (force ? Promise.resolve({ need: true, q: prep.q })
                  : planSearch(prep.q, S.msgs).catch(function(){ return { need: true, q: prep.q }; }))
      .then(function(plan){
        if (plan && plan.need === false){
          q = prep.q; // 用户手动开了联网开关：仍然搜索，只忽略“是否需要”的判断
        } else {
          q = (plan && plan.q) || prep.q;
        }
        stage('正在联网搜索：' + q);
        return runProviders(q, num);
      })
      .then(function(list){
        if (!list || !list.length){ stage('搜索无结果'); return fail(); }
        stage('抓取网页正文…');
        return fetchPages(list).then(function(l2){
          var blk = fmtBlock(l2, q);
          if (!blk){ stage('搜索无结果'); return fail(); }
          var items = [];
          for (var i = 0; i < Math.min(l2.length, 8); i++) items.push({ t: l2[i].title || '', u: l2[i].url || '' });
          return { block: blk, n: l2.length, ms: Date.now() - t0, items: items, query: q };
        });
      })
      .catch(function(){ return fail(); });
  }

  /* GET {base}/models；桥优先 */
  /* /models 解析：模型列表 + 各家上下文窗口字段。
     v1.6 加固：① 字段名全集（context_window / context_length / max_model_len / input_token_limit …）
     ② 嵌套容器（topProvider / architecture / info / model_info / capabilities / configuration）
     ③ 值兼容 1000000 / "1,000,000" / "128k" / "1m" 字面量
     ④ 接口完全没给窗口字段时，调用方走 guessCtx 按模型名规则兜底（修：百万上下文模型只认出 131072 默认值） */
  var CTX_KEYS = ['context_window', 'contextWindow', 'context_length', 'contextLength',
    'max_context_length', 'max_context_tokens', 'max_model_len', 'max_input_tokens',
    'input_token_limit', 'context_window_in_tokens'];
  var CTX_BOXES = ['', 'topProvider', 'architecture', 'info', 'model_info', 'capabilities', 'configuration'];
  function parseCtxVal(v){
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return (isFinite(v) && v >= 1024) ? Math.floor(v) : 0;
    var s = String(v).toLowerCase().replace(/[,_\s]/g, ''), mult = 1;
    if (/k$/.test(s)){ mult = 1000; s = s.slice(0, -1); }
    else if (/m$/.test(s)){ mult = 1000000; s = s.slice(0, -1); }
    var n = parseFloat(s) * mult;
    return (isFinite(n) && n >= 1024) ? Math.floor(n) : 0;
  }
  /* v2.9：通用深度取字段（同一组嵌套容器里找第一个非空值） */
  function deepField(m, keys){
    for (var b = 0; b < CTX_BOXES.length; b++){
      var o = CTX_BOXES[b] ? m[CTX_BOXES[b]] : m;
      if (!o || typeof o !== 'object') continue;
      for (var k = 0; k < keys.length; k++){
        var v = o[keys[k]];
        if (v != null && v !== '' && v !== false) return v;
      }
    }
    return null;
  }
  var OUT_KEYS = ['max_completion_tokens', 'max_output_tokens', 'max_output', 'output_token_limit', 'max_tokens'];
  /* 单条 /models 记录 → 能力片段（接口给了就信接口，没给的留给目录/规则兜底） */
  /* v0.2.5：按模型名推断「思考字段 + 可用档位」——接口目录常常只给一个 reasoning:true，
     不告诉你能选 low/medium/high 还是 enabled/disabled，这里按厂商公开规格补齐。 */
  var REASON_NAME = [
    [/gpt-5/,                        'reasoning_effort', ['minimal', 'low', 'medium', 'high']],
    [/(^|[^a-z])o[134]([^a-z]|$)/,   'reasoning_effort', ['low', 'medium', 'high']],
    [/gemini-3|gemini-2\.5/,         'reasoning_effort', ['low', 'medium', 'high']],
    [/claude|sonnet|opus|haiku/,     'reasoning_effort', ['low', 'medium', 'high']],
    [/qwq|qwen3|qwen-3/,             'enable_thinking',  ['enabled', 'disabled']],
    [/glm-4\.[5-9]|glm-z1|glm-5/,    'thinking',         ['enabled', 'disabled']],
    [/doubao|seed-oss|kimi-k2/,      'thinking',         ['enabled', 'disabled']],
    [/deepseek-r1|deepseek-reasoner/, 'enable_thinking',  ['enabled', 'disabled']]
  ];
  function reasonProfile(name){
    var s2 = String(name || '').toLowerCase();
    for (var i = 0; i < REASON_NAME.length; i++)
      if (REASON_NAME[i][0].test(s2)) return { field: REASON_NAME[i][1], efforts: REASON_NAME[i][2].slice() };
    return null;
  }
  function modelCaps(m){
    var rec = {};
    var c = parseCtxVal(deepField(m, CTX_KEYS)); if (c) rec.ctx = c;
    var o = parseCtxVal(deepField(m, OUT_KEYS)); if (o) rec.out = o;
    var mods = null;
    if (m.modalities && m.modalities.input) mods = m.modalities.input;
    else if (m.architecture && m.architecture.input_modalities) mods = m.architecture.input_modalities;
    else if (m.input_modalities) mods = m.input_modalities;
    if (mods && mods.length){
      var ins = [];
      for (var i = 0; i < mods.length; i++){
        var x = String(mods[i] || '').toLowerCase();
        if (x === 'text' || x === 'image' || x === 'audio' || x === 'video' || x === 'pdf' || x === 'file'){
          if (ins.indexOf(x) < 0) ins.push(x === 'file' ? 'pdf' : x);
        }
      }
      if (ins.length) rec.in = ins;
    }
    if (m.attachment === true && !rec.in) rec.in = ['text', 'image'];
    if (m.reasoning === false || m.supports_reasoning === false) rec.noReason = true;
    /* 思考能力：布尔字段 → true；supported_parameters 里带什么就记什么字段名 */
    var sp = m.supported_parameters || m.supportedParams;
    var reason = '', effFromSp = null;
    if (sp && sp.length){
      for (var j = 0; j < sp.length; j++){
        var p = String(sp[j]);
        if (p === 'reasoning_effort'){ reason = 'reasoning_effort'; effFromSp = ['low', 'medium', 'high']; break; }
        if (p === 'reasoning'){ reason = 'reasoning'; if (!effFromSp) effFromSp = ['enabled', 'disabled']; }
        else if (p === 'thinking'){ reason = 'thinking'; if (!effFromSp) effFromSp = ['enabled', 'disabled']; }
        else if (p === 'enable_thinking'){ reason = 'enable_thinking'; if (!effFromSp) effFromSp = ['enabled', 'disabled']; }
      }
    }
    if (!reason && (m.reasoning === true || m.supports_reasoning === true ||
        (m.capabilities && m.capabilities.reasoning === true))) reason = 'reasoning_effort';
    if (reason) rec.reason = reason;
    /* v0.2.5：思考档位 —— 目录给了就用目录，否则按模型名推断；两者都没有就不提供档位 */
    var prof = reasonProfile(m.id || m.name || m.model || '');
    var eff = null;
    if (Array.isArray(m.reasoning_efforts) && m.reasoning_efforts.length) eff = m.reasoning_efforts.slice();
    else if (effFromSp) eff = effFromSp.slice();
    else if (prof && (!reason || prof.field === reason || reason === 'reasoning_effort')) eff = prof.efforts.slice();
    if (eff) rec.efforts = eff;
    if (!rec.reason && prof) rec.reason = prof.field;
    return rec;
  }
  /* 模型名 → 上下文窗口兜底推断：接口没给窗口字段时启用；规则按公开规格维护，命中才覆盖默认值 */
  var CTX_NAME = [
    ['glm-5', 1000000], ['glm-4-long', 2000000], ['glm-4.6', 200000], ['glm-4.5', 131072],
    ['minimax-m1', 1000000], ['minimax-m2', 1000000],
    ['nemotron-4', 4096],
    ['gemini-3', 1048576], ['gemini-2.5', 1048576],
    ['gpt-4.1', 1048576], ['gpt-5', 400000], ['gpt-4o', 128000], ['gpt-4-turbo', 131072],
    ['claude-sonnet-4', 200000], ['claude-opus-4', 200000], ['claude-haiku-4', 200000], ['claude', 200000],
    ['deepseek-v3', 131072], ['deepseek-chat', 131072], ['deepseek-reasoner', 131072],
    ['qwen3-max', 262144], ['kimi-k2', 131072], ['moonshot-v1', 131072],
    ['llama-4', 1048576], ['llama-3', 131072],
    ['grok-4', 262144], ['grok-3', 131072]
  ];
  function guessCtx(id){
    var s = String(id || '').toLowerCase();
    if (!s) return 0;
    /* Qwen 家族（阿里云百炼/DashScope 兼容接口的 /models 不返回窗口字段，按系列规格推断）。
       v1.7 修：qwen3.8max / qwen3.8flash 等新一代命名未命中旧表，落到 131072 默认值。 */
    if (s.indexOf('qwen') >= 0){
      if (/long/.test(s)) return 10000000; // qwen-long：千万级
      if (/(vl|omni|audio|ocr|asr|tts|embed|rerank)/.test(s)) return 131072; // 多模态/非对话按 128k 档
  var sd = s.replace(/20\d\d[-.]\d\d([-.]\d\d)?/g, ''); // v0.3.26：先剥掉日期快照，否则 2025-03-01 会命中 3-0 被当成百万窗口
    if (/(turbo|flash|plus|coder|3[.\-][0-9])/.test(sd)) return 1000000;
      if (/max/.test(s)) return 262144; // qwen-max / qwen3-max 档
      return 131072;
    }
    for (var i = 0; i < CTX_NAME.length; i++) if (s.indexOf(CTX_NAME[i][0]) >= 0) return CTX_NAME[i][1];
    var kk = /(?:^|[-_./])(\d{1,3})k(?:[-_./]|$)/.exec(s); // moonshot-v1-128k / model-32k
    if (kk) return +kk[1] * 1000;
    var mm = /(?:^|[-_./])(\d{1,3})m(?:[-_./]|$)/.exec(s); // model-1m / context-2m
    if (mm) return +mm[1] * 1000000;
    return 0;
  }
  function parseModels(j){
    var raw = (j && (j.data || j.models)) || [];
    /* v0.4.x：兼容 Gemini /v1beta/models：{models:[{name:'models/…', inputTokenLimit, outputTokenLimit}]}（P1-3） */
    var data = [], i, m;
    for (i = 0; i < raw.length; i++){
      m = raw[i];
      if (!m) continue;
      if (!m.id && m.name)
        m = { id: String(m.name).replace(/^models\//, ''), displayName: m.displayName,
              input_token_limit: m.inputTokenLimit, output_token_limit: m.outputTokenLimit };
      data.push(m);
    }
    var list = [], ctx = {}, meta = {};
    for (i = 0; i < data.length; i++){
      m = data[i];
      if (!m || !m.id) continue;
      list.push(m.id);
      var caps = modelCaps(m);
      if (caps.ctx) ctx[m.id] = caps.ctx;
      if (caps.ctx || caps.out || caps.in || caps.reason) meta[m.id] = caps;
    }
    return { list: list.length ? list : null, ctx: ctx, meta: meta };
  }

  /* ---- v2.9：token 估算（参照 openai-cookbook「How to count tokens」、Anthropic token counting、
     Gemini tokenizer 文档给的量级；不做 BPE，只求 ±几% 的可用估算）----
   · 英文/代码：约 4 字符/token；标点符号：约 2.6 字符/token
   · 中文/日文/韩文：cl100k 约 0.7 token/字，o200k 与 Gemini 更省（0.6~0.62），Claude 略贵（0.78）
   · 每条消息信封 4 token，整体 +3（OpenAI chat 格式）
   · 图片：OpenAI 视觉公式 85 + 170 × 512px 小块数；不知尺寸时按 1100 计 */
  function famOf(id){
    var s = String(id || '').toLowerCase();
    if (/claude|anthropic/.test(s)) return 'claude';
    if (/gemini|gemma/.test(s)) return 'gemini';
    if (/gpt-4o|gpt-4\.1|gpt-5|o[1-4](-|$)|gpt-oss/.test(s)) return 'openai-new';
    if (/qwen|glm|deepseek|kimi|moonshot|doubao|hunyuan|ernie|minimax|step|yi-/.test(s)) return 'cjk';
    return 'default';
  }
  function cjkRate(fam){
    if (fam === 'claude') return 0.78;
    if (fam === 'gemini' || fam === 'openai-new') return 0.62;
    if (fam === 'cjk') return 0.66;
    return 0.70;
  }
  function textTok(str, fam){
    var s = str == null ? '' : String(str);
    if (!s) return 0;
    var cjk = 0, alnum = 0, other = 0, i, c;
    for (i = 0; i < s.length; i++){
      c = s.charCodeAt(i);
      if ((c >= 0x3040 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) ||
          (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef) ||
          (c >= 0x2e80 && c <= 0x2fdf) || (c >= 0x3000 && c <= 0x303f)) cjk++;
      else if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0xc0 && c <= 0x24f)) alnum++;
      else if (c === 32 || c === 9 || c === 10 || c === 13) { /* 空白不单独计 */ }
      else other++;
    }
    return cjk * cjkRate(fam) + alnum / 4.0 + other / 2.6;
  }
  function imgTok(w, h){
    if (!w || !h) return 1100;
    var tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
    return Math.min(85 + 170 * tiles, 4000);
  }
  function msgTok(list, fam){
    var t = 3;
    for (var i = 0; i < list.length; i++){
      var m = list[i] || {}, c = m.content;
      t += 4;
      if (typeof c === 'string'){ t += textTok(c, fam); continue; }
      if (c && c.length){
        for (var j = 0; j < c.length; j++){
          var p = c[j] || {};
          if (p.type === 'text') t += textTok(p.text, fam);
          else t += 1100; // 图片/其它附件按固定量估
        }
      }
    }
    return Math.ceil(t);
  }
  var estimate = { family: famOf, text: textTok, image: imgTok, messages: msgTok };

  /* ---- v2.9：模型能力目录（models.dev，MIT 开源、opencode 同源数据） ----
     单文件零依赖：GET 一个 JSON → 归一化 {{id:{{c,o,i,r}}}} → localStorage 缓存 7 天。
     失败/离线时静默返回空表，全部回退到 /models 字段与 guessCtx 规则，不影响任何主流程。 */
  var CAT_URL = 'https://models.dev/api.json',
      OR_URL = 'https://openrouter.ai/api/v1/models',   // 第二源：覆盖 vendor/model 形态的 id
      CAT_KEY = 'sc.cat.v1', CAT_TTL = 7 * 864e5;
  var _catP = null;
  function catNorm(j){
    var out = {};
    for (var p in j){
      var prov = j[p];
      if (!prov || !prov.models) continue;
      for (var id in prov.models){
        var m = prov.models[id];
        if (!m) continue;
        var lim = m.limit || {}, rec = {}, k = String(id).toLowerCase();
        var c = parseInt(lim.context, 10); if (c > 0) rec.c = c;
        var o = parseInt(lim.output, 10); if (o > 0) rec.o = o;
        var mods = (m.modalities && m.modalities.input) || null;
        if (mods && mods.length) rec.i = mods.slice(0, 6);
        else if (m.attachment === true) rec.i = ['text', 'image'];
        if (m.reasoning === true || m.supports_reasoning === true) rec.r = 1;
        if (!rec.c && !rec.o && !rec.i && !rec.r) continue;
        var old = out[k];
        if (!old || (!old.c && rec.c) || (!old.o && rec.o)) out[k] = rec;  // 合并：字段更全的优先
      }
    }
    return out;
  }
  /* OpenRouter /api/v1/models → 同一套 {{id:{{c,o,i,r}}}} 结构 */
  function orNorm(j){
    var out = {}, list = (j && j.data) || [];
    for (var i = 0; i < list.length; i++){
      var m = list[i] || {}, rec = {}, k = String(m.id || '').toLowerCase();
      if (!k) continue;
      var c = parseInt(m.context_length, 10); if (c > 0) rec.c = c;
      var o = parseInt(m.top_provider && m.top_provider.max_completion_tokens, 10); if (o > 0) rec.o = o;
      var mods = (m.architecture && m.architecture.input_modalities) || null;
      if (mods && mods.length) rec.i = mods.slice(0, 6);
      var sp = (m.supported_parameters || []).join(' ');
      if (/reasoning/.test(sp)) rec.r = 1;
      if (!rec.c && !rec.o && !rec.i && !rec.r) continue;
      out[k] = rec;
    }
    return out;
  }
  function httpJson(url, ms){
    if (isMock()) return Promise.resolve(null);
    return raw({ url: url, method: 'GET', timeout: ms || 15000, headers: { 'Accept': 'application/json' } })
      .then(function(r){
        if (!r || (r.status && r.status !== 200)) return null;
        try { return JSON.parse(r.text); } catch (e) { return null; }
      })
      .catch(function(){ return null; });
  }
  /* v3.0 #8/#29：缓存瘦身——只留「模型池命中」+ 常见家族，磁盘占用通常降 60%+ */
  function catPrune(map){
    var pool = (S.cfg.models || []).map(function(x){ return String(x).toLowerCase(); });
    var keep = {}, i, k;
    for (k in map){
      for (i = 0; i < pool.length; i++){
        if (pool[i] === k || pool[i].indexOf(k) === 0 || k.indexOf(pool[i]) === 0){ keep[k] = map[k]; break; }
      }
    }
    var kn = 0; for (k in keep) kn++;
    if (kn < 200){
      var common = /^(gpt-|chatgpt|claude-|gemini-|qwen|glm|deepseek|kimi|llama|mistral|mixtral|grok|o[1-4]|doubao|ernie|hunyuan|minimax|step-|yi-|command|nemotron|phi-|solar|gemma|internvl|llava|pixtral)/;
      var extra = 0;
      for (k in map){
        if (keep[k]) continue;
        if (common.test(k) && extra < 1500){ keep[k] = map[k]; extra++; }
      }
    }
    return keep;
  }
  function catalog(){
    if (_catP) return _catP;
    var cached = catCache();
    if (cached && cached.t && (Date.now() - cached.t) < CAT_TTL){
      _catP = Promise.resolve(cached.m);
      return _catP;
    }
    _catP = httpJson(CAT_URL, 20000).then(function(j){
      if (!j) return (cached && cached.m) || {};
      var m = catPrune(catNorm(j));
      var n = 0; for (var k in m) n++;
      if (n){
        try { localStorage.setItem(CAT_KEY, JSON.stringify({ t: Date.now(), m: m, or: (cached && cached.or) || false })); } catch (e) {}
      }
      return n ? m : ((cached && cached.m) || {});
    });
    return _catP;
  }
  /* 第二源按需合并：只有 models.dev 没命中的 id 才会触发（一次拉取后缓存 7 天，不再重复请求） */
  function catalogOpenRouter(){
    var c = catCache();
    if (c && c.or && c.m) return Promise.resolve(c.m);
    if (isMock()) return Promise.resolve((c && c.m) || {});
    return httpJson(OR_URL, 20000).then(function(j){
      var merged = (c && c.m) || {}, add = j ? orNorm(j) : {};
      for (var k in add) if (!merged[k] || !merged[k].c) merged[k] = add[k];
      var n = 0; for (var kk in merged) n++;
      if (n){
        try { localStorage.setItem(CAT_KEY, JSON.stringify({ t: Date.now(), m: merged, or: true })); } catch (e) {}
      }
      _catP = Promise.resolve(merged);
      return merged;
    });
  }
  /* 同步取缓存（不发请求）：切模型时静默补全用 */
  function catCache(){
    try { return JSON.parse(localStorage.getItem(CAT_KEY) || 'null'); } catch (e) { return null; }
  }
  function catalogCached(){
    var c = catCache();
    return (c && c.m) ? c.m : null;
  }
  /* 模型 id → 目录条目（兼容 provider 前缀 / :free / @version / 日期后缀） */
  function catFind(map, id){
    if (!map || !id) return null;
    var k = String(id).toLowerCase();
    if (map[k]) return map[k];
    var k2 = k.replace(/^[^/]+\//, '');
    if (map[k2]) return map[k2];
    var k3 = k2.replace(/[:@].*$/, '');
    if (map[k3]) return map[k3];
    var k4 = k3.replace(/-\d{4}-?\d{2}-?\d{2}$/, '');
    if (map[k4]) return map[k4];
    var k5 = k4.replace(/-latest$/, '');
    if (map[k5]) return map[k5];
    var best = null, bl = 0;
    for (var ck in map){
      if (k5.indexOf(ck) === 0 && ck.length > bl &&
          (k5.length === ck.length || /[-.:/]/.test(k5.charAt(ck.length)))){ bl = ck.length; best = map[ck]; }
    }
    return best;
  }

  function fetchModels(){
    if (isMock()) return Promise.resolve({ list: ['mock-demo'] });
    var url;
    try { url = endpoint('models'); }         /* v0.4.x：Azure 会抛出明确提示（P1-6） */
    catch (e){ return Promise.resolve({ list: null, err: e }); }
    if (!url) return Promise.resolve({ list: null });
    var headers = hostHeaders(authHeaders(), url);

    if (bridge.ok && S.cfg.useBridge){
      return new Promise(function(resolve){
        var id = 'm' + (++bridge.seq);
        var acc = '', finished = false;
        function fin(r){ if (!finished){ finished = true; delete bridge.pend[id]; resolve(r); } }
        bridge.pend[id] = {
          onChunk: function(t){ acc += t; },
          onDone: function(status){
            if (finished) return;
            if (status && status !== 200) return fin({ list: null, err: new Error('HTTP ' + status) });
            try {
              var j = JSON.parse(acc);
              if (j.error) return fin({ list: null, err: new Error('HTTP 401') });
              fin(parseModels(j));
            } catch (e) { fin({ list: null, err: new Error('HTTP ' + (status || 200)) }); }
          },
          onError: function(e){ fin({ list: null, err: e }); }
        };
    /* v0.3.40：桥通道也要有连接超时，否则服务端挂起时这个 Promise 永不 settle */
    var _to = null;
    var _cms = (S.cfg.timeout && S.cfg.timeout.connect || 0) * 1000;
    if (_cms > 0) _to = setTimeout(function(){ try { bridge.abort(id); } catch (e) {} fin({ list: null, err: new Error('请求超时') }); }, _cms);
    var _fin0 = fin; fin = function(r){ if (_to) clearTimeout(_to); _fin0(r); };
        bridge.send({ t: 'http', id: id, direct: isDirectHost(url), url: url, method: 'GET', headers: headers, body: '' });
      });
    }

    var ac = new AbortController();
    var t = (S.cfg.timeout.connect > 0) ? setTimeout(function(){ ac.abort(); }, S.cfg.timeout.connect * 1000) : null;
    return fetch(url, { headers: headers, signal: ac.signal })
      .then(function(res){
        clearTimeout(t);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(j){ return parseModels(j); })
      .catch(function(e){ clearTimeout(t); return { list: null, err: e }; });
  }

  /* 统一入口：按探测结果选通道（§6.4 启动探测） */
  function send(opt){
    if (isMock()) return mockStream(opt);
    if (bridge.ok && S.cfg.useBridge) return bridgeStream(opt);
    fetchStream(opt);
    return {
      abort: function(){
        var e = new Error('aborted'); e.name = 'AbortError';
        opt.abort(e);
      }
    };
  }

  /* 非流式原始 HTTP（v1.5）：代理连通性测试 / 文档 OCR 用。
     宿主桥优先（自动带代理配置、免 CORS），浏览器模式回退 fetch（跟随系统代理）。
     opt: {url, method, headers, body(JSON串), bodyB64(二进制), contentType, timeout(ms)} */
  function raw(opt){
    return new Promise(function(res, rej){
      var to = opt.timeout || 0, timer = null;
      function finish(fn, v){ if (timer){ clearTimeout(timer); timer = null; } fn(v); }
      if (bridge.ok && S.cfg.useBridge){
        var id = 'q' + (++bridge.seq), chunks = [], mh = null;
        bridge.pend[id] = {
          onChunk: function(t){ chunks.push(t); },
          onMeta: function(h){ mh = h; },
          onDone: function(status){ finish(res, { status: status, headers: mh || {}, text: chunks.join('') }); },
          onError: function(e){ finish(rej, e); }
        };
        if (to) timer = setTimeout(function(){
          bridge.abort(id); finish(rej, new Error('请求超时（' + Math.round(to / 1000) + 's）'));
        }, to);
        var msg = { t: 'http', id: id, direct: isDirectHost(opt.url), url: opt.url, method: opt.method || 'GET', headers: opt.headers || {} };
        if (opt.bodyB64 != null){ msg.bodyB64 = opt.bodyB64; if (opt.contentType) msg.contentType = opt.contentType; }
        else if (opt.body != null) msg.body = opt.body;
        bridge.send(msg);
      } else {
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (to && ctrl) timer = setTimeout(function(){
          ctrl.abort(); finish(rej, new Error('请求超时（' + Math.round(to / 1000) + 's）'));
        }, to);
        var init = { method: opt.method || 'GET', headers: opt.headers || {}, signal: ctrl ? ctrl.signal : undefined };
        if (opt.bodyB64 != null){
          var bin = atob(opt.bodyB64), arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          init.body = arr;
        } else if (opt.body != null) init.body = opt.body;
        fetch(opt.url, init).then(function(r){
          return r.text().then(function(t){
            var h = {};
            r.headers.forEach(function(v, k){ h[k.toLowerCase()] = v; });
            finish(res, { status: r.status, headers: h, text: t });
          });
        }).catch(function(e){ finish(rej, e); });
      }
    });
  }

  function rawStream(opt){
    var url = opt.url;
    var headers = hostHeaders(opt.headers || {}, url);
    var to = opt.timeout == null ? 180000 : opt.timeout;
    var timer = null, finished = false;
    var ac = opt.signal ? null : (typeof AbortController !== 'undefined' ? new AbortController() : null);
    var signal = opt.signal || (ac && ac.signal);
    function clear(){ if (timer){ clearTimeout(timer); timer = null; } }
    function arm(){ clear(); if (to > 0) timer = setTimeout(function(){ fail(Object.assign(new Error('请求超时（' + Math.round(to / 1000) + 's）'), { tmo: 'idle' })); }, to); }
    function done(status){ if (finished) return; finished = true; clear(); try { opt.onDone && opt.onDone(status); } catch (e) {} }
    function fail(e){ if (finished) return; finished = true; clear(); try { opt.onError && opt.onError(e); } catch (e2) {} }
    arm();
    if (signal && signal.addEventListener) try { signal.addEventListener('abort', function(){ fail(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true }); } catch (e) {}
    if (bridge.ok && S.cfg.useBridge){
      var id = 'rs' + (++bridge.seq);
      bridge.pend[id] = {
        onChunk: function(t){ if (finished) return; arm(); try { opt.onChunk && opt.onChunk(t); } catch (e) {} },
        onDone: function(status){ delete bridge.pend[id]; done(status); },
        onError: function(e){ delete bridge.pend[id]; fail(e); }
      };
      bridge.send({ t: 'http', id: id, direct: isDirectHost(url), url: url, method: opt.method || 'POST', headers: headers, body: opt.body == null ? '' : opt.body });
      return { abort: function(){ if (finished) return; try { bridge.abort(id); } catch (e) {} delete bridge.pend[id]; fail(Object.assign(new Error('aborted'), { name: 'AbortError' })); } };
    }
    fetch(url, { method: opt.method || 'GET', headers: headers, body: opt.body, signal: signal })
      .then(function(res){
        var reader = res.body && res.body.getReader ? res.body.getReader() : null;
        var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
        if (!reader){
          return res.text().then(function(t){ if (finished) return; if (t) try { opt.onChunk && opt.onChunk(t); } catch (e) {} done(res.status); });
        }
        function pump(){
          return reader.read().then(function(r){
            if (finished) return;
            if (r.done){ done(res.status); return; }
            arm();
            var txt = dec ? dec.decode(r.value, { stream: true }) : String(r.value || '');
            try { opt.onChunk && opt.onChunk(txt); } catch (e) {}
            return pump();
          });
        }
        return pump();
      }).catch(function(e){ if (!finished) fail(e); });
    return { abort: function(){ if (finished) return; try { if (ac) ac.abort(); } catch (e) {} fail(Object.assign(new Error('aborted'), { name: 'AbortError' })); } };
  }

  return {
    send: send,
    raw: raw,
    rawStream: rawStream,
    buildBody: buildBody,
    fetchModels: fetchModels,
    guessCtx: guessCtx,
    catalog: catalog,
    catalogOpenRouter: catalogOpenRouter,
    catalogCached: catalogCached,
    catFind: catFind,
    modelCaps: modelCaps,
    reasonProfile: reasonProfile, // v0.2.5：UI 侧按模型名取思考档位
    estimate: estimate,
    searchReady: searchReady,
    searchWeb: function(raw, onStage, force){
    return searchWeb(raw, onStage, force).then(function(r){
      try { RUNNER.addSources((r && r.query) || String(raw || '').slice(0, 40), (r && r.items) || [], !!(r && r.block), (r && r.err) || (r && r.skip ? '模型判断无需联网' : '')); } catch (e) {}
      return r;
    }, function(e){
      try { RUNNER.addSources(String(raw || '').slice(0, 40), [], false, (e && e.message) || String(e)); } catch (e2) {}
      throw e;
    });
  },
    openExternal: openExternal, // v0.2.3：Work 的 play 工具用（应用内播放窗口）
    mediaDownload: mediaDownload, // v0.2.4：Work 的 download 工具
    fileGet: fileGet, fileText: fileText, // v0.2.8：get 工具（任意文件格式）
    isBinaryUrl: isBinaryUrl,
    revealPath: revealPath,
    pkgSave: function(name, files, where){ return bridge.pkg(name, files, where); },
    safeUrl: safeUrl,          // v0.2.1：Work 的 web 工具复用
    fetchPageText: fetchPageText, // v0.2.1：Work 的 web 工具复用（桥优先 → 无 CORS 限制）
    classify: classify,
    normBase: normBase,
    isMock: isMock,
    toolSchemas: toolSchemas, // v0.8.0：原生工具 schema
    makeToolAcc: makeToolAcc, // v0.8.1：tool_calls 累加器
    scanToolCalls: scanToolCalls, // v0.8.5：四协议 tool_calls 扫描（单测用）
    shot: function(){   /* v1.0.1：截当前内置浏览器 → data URL */
      if (!bridge.ok) return Promise.reject(new Error('需要 exe 宿主版'));
      var id = 'sh' + (++bridge.seq);
      return new Promise(function(res, rej){
        bridge.pend[id] = { resolve: res, reject: rej };
        bridge.send({ t: 'shot', id: id });
        setTimeout(function(){ if (bridge.pend[id]){ delete bridge.pend[id]; rej(new Error('截图超时')); } }, 15000);
      }).then(function(b64){ return 'data:image/png;base64,' + b64; });
    },
    toolCallsToFences: toolCallsToFences, // v0.8.6：调用 → 围栏
    simpleOp: simpleOp, // v0.9.1：time/calc/json/http
    lastToolCalls: function(){ return NET._lastCalls || []; }, // v0.8.7：诊断
    buildToolTurn: buildToolTurn, // v0.8.2：工具结果回灌
    crawl: crawl,             // v0.7.0：批量抓取
    fetchPageText: fetchPageText, fetchErr: function(){ return lastFetchErr; },
    chatOnce: chatOnce,       // v0.5.0：子智能体单次调用
    PROVIDERS: PROVIDERS, provEntry: provEntry, quirksNow: quirksNow,
    endpoint: endpoint, applyQuirks: applyQuirks, testConn: testConn,   // v0.4.5：协议层
    createParserFor: createParserFor, convertBody: convertBody, protocolNow: protocolNow,   // v0.4.6：协议适配（调试用）
    modelCaps: modelCaps,     // v1.7：调试/测试用
    lastRaw: function(){ return _lastRaw || NET._lastRaw || ''; },
    _lastRaw: '',
  bridge: bridge,
    fs: fsCall,
    mem: memCall,
    pair: pairCall,
    saveFile: function(name, text, mime){
      return new Promise(function(res, rej){
        if (!bridge.ok){ rej(new Error('保存文件需要 SoloChat 宿主')); return; }
        var id = 's' + (++bridge.seq);
        bridge.pend[id] = { onChunk: function(){}, onDone: res, onError: rej };
        bridge.send({ t: 'savefile', id: id, name: name, text: text, mime: mime || 'text/plain' });
        setTimeout(function(){ if (bridge.pend[id]){ delete bridge.pend[id]; rej(new Error('保存超时')); } }, 15000);
      });
    },
    notify: notify,
  };
})();
/*  */
/* v1.28.4：写入快照表（path → snap id），跨刷新保留，用于「撤销这次写入」 */
