var FS = (function(){
  var diffCache = {};
  /* v2.2：工具循环状态按会话隔离（切走后仍在后台推进，互不干扰） */
  var stMap = {};
  function stOf(sid){ sid = sid || S.sid; return stMap[sid] || (stMap[sid] = { turns: 0, cancel: false }); }
  /* v1.29.4 重写：目标 → 工具 → 循环 → 边界 → 输出，去掉重复与口头禅 */
  var PROTOCOL = 'Agent 协议（本地工作区）：读懂现有文件 → 做最小必要修改 → 说清改了什么。\n' +
    '工具（围栏首行是参数）：\n' +
    '```fs-list —— 列目录（相对路径，可空）。动手前先看结构。\n' +
    '```fs-read —— 读文件（相对路径）。长文件会被截断：先定位再读，别整读整写。\n' +
    '```grep <正则> [--path 子目录] [--glob "*.js"] [--max 100] —— 全文检索，回「路径:行号: 文本」。\n' +
    '```glob <**/*.cs> [--path 子目录] —— 按通配符找文件，回路径列表。\n' +
    '```fs-edit —— 局部替换，首选方式，省 token。参数行写路径，体内两段：\n' +
    '--- old（原文，带足够上下文保证唯一）\n--- new（新文）\n' +
    '匹配不到或多处匹配会失败并回告：补上下文重试，不要退回整文件重写。\n' +
    '```python —— 执行 Python 脚本（需先在 设置→扩展→插件市场 安装 Python 3.11 运行时）；cwd 为当前工作区，回 stdout/stderr。\n' +
    '```crawl URL —— 批量抓取网页（沿翻页链连续抓 N 页，max=N，默认 20）；爬站/抓章节用它。\n' +
    '```fs-write —— 新建或整文件替换（相对路径，体为完整内容），只在新建/大改时用。\n' +
    '```time / ```calc 算式 / ```json 路径 / ```http 方法 URL —— 本地时间、算数、JSON 取值、直接发 HTTP。\n' +
    '工作循环：① fs-list 看结构 ② fs-read 读相关文件（别一次读整个项目：先看 README/package.json/入口，再按「入口→模块」收敛）\n' +
    '③ 一句话说清改什么、改哪几个文件 ④ fs-edit 逐处改 ⑤ 能自检就自检（语法/逻辑/小样例）⑥ 按输出格式收尾。\n' +
    '计划：多步任务把计划与进度写进 PLAN.md（fs-write），每步更新，不另立状态文件。\n' +
    '边界：路径相对工作区根，禁 ..；工作区外逐次确认；不读、不回显、不上传 .env/密钥/凭据/私钥；\n' +
    '不删除或覆盖用户未提交的内容；不擅自 git commit/push；删除、批量覆盖、装软件、管理员权限、上传数据先问用户。\n' +
    '失败处理：读 [fs-result] 的错误原因（路径错/匹配不到/权限），修正参数重试一次；同一错误两次不成就停下说明卡点。\n' +
    '输出格式（三段写完就停）：① 改动清单（文件:行/函数）② 验证方式与结果 ③ 未验证项与风险。不要整篇重贴文件内容，只贴改动片段。';
function scan(content){ /* 扫描 fs-* 围栏（与 MD 渲染器同款约定；路径为体首行）；容忍 \r\n */
    var re = /```(fs-(?:read|list|write|edit|done|rej)|grep|glob|skill|cmd|git|python|sub|agent|suball|browser-read|browser-act|browser|web|crawl|time|calc|json|http|search|get)(?:[ \t]*\r?\n|[ \t]+)([\s\S]*?)```/g, out = [], m;
    while ((m = re.exec(content || ''))){
      var nl = m[2].indexOf('\n');
      var call = { op: m[1], path: (nl >= 0 ? m[2].slice(0, nl) : m[2]).trim(), body: nl >= 0 ? m[2].slice(nl + 1) : '' };
      if (call.op === 'fs-edit'){ /* v0.3.0：局部替换，体内 --- old / --- new 两段 */
        var bd = String(call.body).replace(/\r/g, '');
        var kNew = bd.indexOf('\n--- new\n'), kOld = bd.indexOf('--- old\n');
      if (kNew >= 0 && kOld >= 0){ call.oldText = bd.slice(kOld + 8, kNew); call.newText = bd.slice(kNew + 9).replace(/\n$/, ''); } // v0.3.42：new 段末尾那一个换行是围栏前的，不该算进内容
      }
      out.push(call);
  /* v0.3.52：用户扩展工具（围栏名动态）——FS 侧此前完全不认，模型调用后空等 */
  try {
    var _cu = EXT.toolsFor(S.cfg.mode);
    if (_cu && _cu.length){
      var _re2 = /```([a-z][a-z0-9-]{1,24})(?:[ \t]*\r?\n|[ \t]+)([\s\S]*?)```/g, _m2;
      while ((_m2 = _re2.exec(content || ""))){
        var _hit = null;
        for (var _ci = 0; _ci < _cu.length; _ci++) if (_cu[_ci].name === _m2[1]) _hit = _cu[_ci];
        if (!_hit) continue;
        var _nl2 = _m2[2].indexOf('\n');
        out.push({ op: _m2[1], arg: (_nl2 >= 0 ? _m2[2].slice(0, _nl2) : _m2[2]).trim(), body: _nl2 >= 0 ? _m2[2].slice(_nl2 + 1) : '' });
      }
    }
  } catch (e) {}
    }
    return out;
  }
  function byId(id){ for (var i = 0; i < S.msgs.length; i++) if (S.msgs[i].id === id) return S.msgs[i]; return null; }
  function curWs(){ var s = curSession(); return (s && s.workspace) || ''; } // 本会话工作区根（fs 请求携带，宿主校验白名单）
  function findWrite(content, path){
    var calls = scan(content);
    for (var i = calls.length - 1; i >= 0; i--) if (calls[i].op === 'fs-write' && calls[i].path === path) return calls[i];
    return null;
  }
  function note(content, sid){ /* v2.2：可指定会话；后台会话只落库，不动当前视图 */
    sid = sid || S.sid;
    var um = { id: uuid(), sid: sid, role: 'user', content: content, status: 'ok', ts: Date.now(), attachments: [] };
    DB.putMessage(um);
    if (sid === S.sid){ S.msgs.push(um); UI.appendMsgNode(um); } // v2.4：追加而非整列表重建（滚动/图片抖动主因）
    return um;
  }
  /* 回合入口：assistant 落定后调用 */
  function handleTurn(msg){
    var s0 = stOf(msg && msg.sid);
    /* v0.4.1：Chat 里勾了工具就也跑工具循环（只跑白名单里的） */
    var chatTools = (S.cfg.mode === 'chat') && PICK.restrict();
    if ((S.cfg.mode !== 'agent' && !chatTools) || s0.cancel || !msg || msg.status !== 'ok') return;
    /* v0.9.5：本轮有提问卡 → 停下来等用户回答 */
    if (/```ask\b/.test(String(msg.content || ''))) return;
    var calls = scan(msg.content), reads = [], writes = [], i;
    for (i = 0; i < calls.length; i++) (calls[i].op === 'fs-write' ? writes : reads).push(calls[i]);
    if (!reads.length && !writes.length) return;
    hydrateAll(); // 写卡片已渲染，立即填差异；工作区内写入随后自动应用，工作区外等用户逐次确认
    /* v1.4 权限模型：默认工作区（授权文件夹）内写入免确认自动应用；工作区外一律逐次确认 */
    var auto = [];
    /* v3.0 #13：按扩展名/目录分级——危险扩展名与白名单外的路径改成逐次确认 */
    function riskyWrite(p){
      var ext = String(p || '').split('.').pop().toLowerCase();
      var bad = String(S.cfg.dangerExt == null ? 'exe,bat,cmd,ps1,dll,msi,scr' : S.cfg.dangerExt)
        .split(',').map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean);
      if (bad.indexOf(ext) >= 0) return '扩展名 .' + ext + ' 属于高风险类型';
      var dirs = String(S.cfg.writeDirs || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean);
      if (dirs.length){
        var hitDir = false;
        for (var d = 0; d < dirs.length; d++) if (String(p).toLowerCase().indexOf(dirs[d].toLowerCase()) === 0){ hitDir = true; break; }
        if (!hitDir) return '不在写入白名单目录内';
      }
      return '';
    }
    S._riskyWrites = {};
    /* v1.29.0：计划门禁 —— 本会话还没确认过写入时，先把这一批留在卡上等用户点一次「应用写入」 */
    var permMode = S.cfg.permMode || (S.cfg.planGate === false ? 'auto' : 'ask');
  if (permMode === 'readonly'){
    /* v0.3.6：只读模式 —— 不写文件、不执行 cmd/git，只保留读类工具 */
    reads = reads.filter(function(c){ return c.op !== 'cmd' && c.op !== 'git' && c.op !== 'fs-write' && c.op !== 'fs-edit'; }); // v0.3.42：fs-edit 也是写
    if (writes.length){
      try {
        msg.content = String(msg.content || '') + '\n\n> 🔒 只读模式：本轮 ' + writes.length + ' 处写入未执行（设置 → 通用设置 → 权限）';
        DB.putMessage(msg); UI.repaintMsg(msg.id);
      } catch (e) {}
      UI.toast('只读模式：' + writes.length + ' 处写入已跳过', true);
      writes = [];
    }
  }
  /* v0.3.47：fs-edit 也在计划门禁之内（它同样是写盘） */
  if (permMode === 'ask' && !s0.planOk){
    var _edits = reads.filter(function(c){ return c.op === 'fs-edit'; });
    if (_edits.length){
      reads = reads.filter(function(c){ return c.op !== 'fs-edit'; });
      try { msg.content = String(msg.content || '') + '\n\n> ⏸ 计划门禁：本轮 ' + _edits.length + ' 处编辑未执行（先确认一次写入解锁本会话）'; DB.putMessage(msg); UI.repaintMsg(msg.id); } catch (e) {}
      UI.toast('计划门禁：' + _edits.length + ' 处编辑已跳过，先确认一次写入', true);
    }
  }
  var gated = (permMode === 'ask') && (S.cfg.fsAutoWrite !== false) && !s0.planOk && writes.length > 0;
    if (S.cfg.fsAutoWrite !== false && !gated)
      for (i = 0; i < writes.length; i++){
        if (isOutside(writes[i].path)) continue;
        var why = riskyWrite(writes[i].path);
        if (why){ S._riskyWrites[writes[i].path] = why; continue; }
        auto.push(writes[i]);
      }
    if (Object.keys(S._riskyWrites).length)
      UI.toast('有 ' + Object.keys(S._riskyWrites).length + ' 个写入需要确认（' + Object.keys(S._riskyWrites).map(function(k){ return S._riskyWrites[k]; })[0] + '）');
      if (gated){
        try { D('gated'); } catch (e) {}
      UI.toast('计划门禁：本轮 ' + writes.length + ' 处写入先确认一次（点卡片上的「应用写入」），之后本会话自动写入', true);
        try {
          if (String(msg.content || '').indexOf('⏸ 计划门禁') < 0){
            msg.content = String(msg.content || '') + '\n\n> ⏸ 计划门禁：本轮 ' + writes.length + ' 处写入要你先确认（点卡片「应用写入」）。确认一次后，本会话的写入自动应用。';
            DB.putMessage(msg); UI.repaintMsg(msg.id);
          }
        } catch (e) {}
      }
    for (i = 0; i < auto.length; i++) apply(msg, auto[i].path, null); // v0.3.3：传消息对象，后台会话不在 S.msgs 里
    if (!reads.length) return;
    if (LIMITS.FS_MAX_TURNS > 0 && s0.turns >= LIMITS.FS_MAX_TURNS){ UI.toast('已达工具轮次上限（' + LIMITS.FS_MAX_TURNS + '）', true); return; }
    runReads(reads, msg.sid);
  }
  /* 路径是否落在授权工作区之外（绝对路径/UNC/含 ..） */
  function isOutside(path){
    var p = String(path || '').trim();
    return /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{1,2}/.test(p) || p.split(/[\\/]/).indexOf('..') >= 0;
  }
  function runReads(reads, sid0){
    UI.holdBusy(1, sid0);
    var parts = [], done = 0, s0 = stOf(sid0);
    /* v0.3.3：后台会话用自己的工作区，不读当前显示会话的 */
    var ws0 = (function(sid){ try { var ss = sessionById(sid); return (ss && ss.workspace) || curWs(); } catch (e) { return curWs(); } })(sid0);
  /* v1.28.3：一条回复里的多个 agent/sub 先聚成一批并行跑，剩下的工具照原样串行 */
  (function hoistSubs(){
    var subs = [], rest = [];
    for (var i = 0; i < reads.length; i++){
      var c0 = reads[i];
      if (c0.op === 'agent' || c0.op === 'sub'){
        var nm = String(c0.path || '').trim().split(/\s+/)[0];
        var tk = (String(c0.path || '').replace(nm, '') + (c0.body ? '\n' + c0.body : '')).trim();
        if (nm) subs.push({ name: nm, task: tk });
      } else rest.push(c0);
    }
    if (subs.length > 1){ rest.unshift({ op: 'suball', items: subs }); reads = rest; }
  })();
    (function next(){
      if (s0.cancel){ UI.holdBusy(-1, sid0); return; } // v0.3.0：取消也要归还 busy，否则 S.pend 永久 >0
      if (done >= reads.length){
        s0.turns++;
        /* v1.17：闭环自修 —— 有失败就把失败清单回注，让模型带着证据重试（每轮最多两次） */
        var fails = [];
        for (var fi = 0; fi < parts.length; fi++)
          if (/^^(工具失败|失败|错误)|exit code [1-9]|Error:|Exception/.test(String(parts[fi])) && !/成功/.test(String(parts[fi]).slice(0, 40))) fails.push(String(parts[fi]).slice(0, 240));
        var txt0 = parts.join('\n\n');
        S._fixN = S._fixN || {};
        if (fails.length && S.cfg.autoFix !== false && (S._fixN[sid0] || 0) < 2){
          S._fixN[sid0] = (S._fixN[sid0] || 0) + 1;
          txt0 += '\n\n【自动校验】上一步有 ' + fails.length + ' 个失败：\n' + fails.join('\n---\n') +
            '\n先修好再交付；修不了就直接说卡在哪一步、缺什么，不要假装成功。';
        }
        var _res0 = txt0.slice(0, LIMITS.FS_RESULT_CHARS);
        if (_res0.indexOf('[fs-result]') !== 0) _res0 = '[fs-result]\n' + _res0; // v1.1.11：parts 已带前缀时不要再叠一层
        note(_res0, sid0);
        UI.holdBusy(-1, sid0);
        UI.startStreamFor(sid0); // 结果回灌后自动续跑一轮（目标会话，v2.2）
        return;
      }
      var c = reads[done++];
      if (c.op === 'skill'){
        var skn = String(c.path || '').trim().split(/\s+/)[0];
        var skb = EXT.skillText(skn);
        parts.push(skb ? '[skill] ' + skn + '\n```\n' + skb.slice(0, 6000) + '\n```'
                       : '[skill] 没有这个技能：' + skn + '（已有：' + (EXT.skillNames('agent').join(', ') || '无') + '）');
        next(); return;
      }
      if (EXT.isKnownBuiltin(c.op) && !EXT.isOn(c.op)){ parts.push('[fs-result] ' + c.op + ' 已在扩展里关闭'); next(); return; }
      var _pd = PICK.deny(c.op); if (_pd){ parts.push('[拦截] ' + _pd); next(); return; }
      if (EXT.hasSmall(c.op)){                 /* v0.4.1：time/calc/json/http 纯本地小工具 */
        var _ts0 = Date.now();
        EXT.runSmall(c.op, c.path, c.body).then(function(txt){
          parts.push('[' + c.op + '] ' + txt + '（' + (Date.now() - _ts0) + 'ms）');
        }, function(e){ parts.push('[' + c.op + '] 失败：' + ((e && e.message) || e)); }).then(next);
        return;
      }
      if (MODE.denied(c.op)){ /* v1.2：Plan 子模式只读锁 */
        parts.push('[拦截] 当前是 Plan（规划）子模式：只读，不允许 ' + c.op + '。先把方案写清楚，等用户确认后再切到 Build 落地。');
        next(); return;
      }
      if (c.op === 'python'){
        var pyCode = String(c.body || '');
        if (!pyCode.trim()){ parts.push('[python] 代码为空'); next(); return; }
        var pyWs = ws0;
        if (!pyWs){ parts.push('[python] 需要先绑定 Agent 工作区'); next(); return; }
        UI.confirmBox({ title: '运行 Python 脚本？', text: '工作目录：' + pyWs + '\n\n' + pyCode.slice(0, 600) + (pyCode.length > 600 ? '\n…' : ''), okText: '运行', danger: true })
          .then(function(ok){
            if (!ok){ parts.push('[python] 用户拒绝了本次执行'); next(); return; }
            var pt0 = Date.now();
            /* B1-3：显式给 run 设 120s 上限，防止死循环脚本永久占住工具链 */
            NET.bridge.runtime('run', { runtimeId: 'python-3.11', code: pyCode, cwd: pyWs, timeoutMs: 120000 }).then(function(r){
              var out = String(r && r.stdout || ''), err = String(r && r.stderr || '');
              if (out.length > LIMITS.FS_RESULT_CHARS) out = out.slice(0, LIMITS.FS_RESULT_CHARS) + '\n…（截断）';
              if (err.length > LIMITS.FS_RESULT_CHARS) err = err.slice(0, LIMITS.FS_RESULT_CHARS) + '\n…（截断）';
              parts.push('[python] 退出码 ' + ((r && r.code) == null ? '?' : r.code) + '（' + (Date.now() - pt0) + 'ms）' +
                (r && r.timeout ? ' · 超时（>120s）' : '') +
                (out ? '\nSTDOUT:\n' + out : '') + (err ? '\nSTDERR:\n' + err : ''));
              next();
            }, function(e){ parts.push('[python] 执行失败：' + (e && e.message || e)); next(); });
          });
        return;
      }
      if (c.op === 'grep' || c.op === 'glob'){
        var gws = ws0;
        if (!gws){ parts.push('[' + c.op + '] 需要先绑定 Agent 工作区'); next(); return; }
        var garg = String(c.path || '').trim(), gbody = String(c.body || '').trim();
        if (c.op === 'glob'){
          var gdir = '', gpat = garg;
          var gm = /--path\s+(?:"([^"]*)"|(\S+))/.exec(gbody);
          if (gm) gdir = gm[1] != null ? gm[1] : gm[2];
          if (!gpat){ parts.push('[glob] 需要模式，如 ```glob **/*.cs'); next(); return; }
          NET.fs('glob', gdir, gpat, gws).then(function(r){
            var fs2 = (r && r.files) || [];
            parts.push('[glob] ' + fs2.length + ' 个文件' + (r && r.truncated ? '（已截断）' : '') + '\n' + fs2.slice(0, 200).join('\n'));
            next();
          }, function(e){ parts.push('[glob] 失败：' + ((e && e.message) || e)); next(); });
          return;
        }
        var gdir2 = '', gglob = '', gmax = 100;
        var pm = /--path\s+(?:"([^"]*)"|(\S+))/.exec(gbody); if (pm) gdir2 = pm[1] != null ? pm[1] : pm[2];
        var fm = /--glob\s+(?:"([^"]*)"|(\S+))/.exec(gbody); if (fm) gglob = fm[1] != null ? fm[1] : fm[2];
        var mm = /--max\s+(\d+)/.exec(gbody); if (mm) gmax = parseInt(mm[1], 10) || 100;
        if (!garg){ parts.push('[grep] 需要正则，如 ```grep TODO'); next(); return; }
        NET.fs('grep', gdir2, JSON.stringify({ pattern: garg, glob: gglob, max: gmax }), gws).then(function(r){
          var hits = (r && r.matches) || [];
          var L = ['[grep] ' + hits.length + ' 处' + (r && r.truncated ? '（已截断）' : '') + '（扫描 ' + ((r && r.scanned) || 0) + ' 文件）'];
          hits.forEach(function(h){ L.push(h.path + ':' + h.line + ': ' + h.text); });
          parts.push(L.join('\n'));
          next();
        }, function(e){ parts.push('[grep] 失败：' + ((e && e.message) || e)); next(); });
        return;
      }
      if (c.op === 'cmd' || c.op === 'git'){
        var raw = String(c.path || '').trim();
        if (!raw){ parts.push('[cmd] 命令为空'); next(); return; }
        if (c.op === 'git') raw = 'git ' + raw;
        var ws = ws0; /* v0.3.5：后台会话的命令要在自己的工作区跑 */
        UI.confirmBox({ title: '执行命令？', text: raw + (ws ? '\n工作目录：' + ws : '\n（未绑定工作区，将无法执行）'), okText: '执行', danger: true })
          .then(function(ok){
            if (!ok){ parts.push('[cmd] 用户拒绝了：' + raw); next(); return; }
            var sp = raw.match(/^("[^"]+"|\S+)([\s\S]*)$/);
            var exe = sp ? sp[1].replace(/^"/, '').replace(/"$/, '') : raw;
            var rest = sp ? sp[2].trim() : '';
            var arr = [];
            var qre = /"([^"]*)"|(\S+)/g, qm;
            while ((qm = qre.exec(rest))) arr.push(qm[1] != null ? qm[1] : qm[2]);
            NET.bridge.cmd(exe, arr, ws, 0).then(function(r){
              var out = String(r.stdout || ''), err = String(r.stderr || '');
              if (out.length > 4000) out = out.slice(0, 4000) + '\n…（截断）';
              if (err.length > 1500) err = err.slice(0, 1500) + '\n…（截断）';
              parts.push('[cmd] ' + raw + '\n退出码 ' + (r.code == null ? '?' : r.code) + (r.timeout ? '（超时）' : '') +
                (out ? '\nSTDOUT:\n' + out : '') + (err ? '\nSTDERR:\n' + err : ''));
              next();
            }, function(e){ parts.push('[cmd] 执行失败：' + (e && e.message || e)); next(); });
          });
        return;
      }
      if (c.op === 'browser'){
      var bu2 = NET.safeUrl(String(c.path || '').trim() || String(c.body || '').trim());
      if (!bu2){ parts.push('[browser] 地址无效（需 http/https 绝对地址）'); next(); return; }
      var bo2 = false; try { bo2 = (typeof RUNNER !== 'undefined' && RUNNER.openWeb && RUNNER.openWeb(bu2)); } catch (e) { bo2 = false; }
      if (!bo2) bo2 = NET.openExternal(bu2, 'window'); // v0.3.88：优先侧栏，失败再开窗口
      parts.push('[browser] ' + (bo2 ? '已在应用内窗口打开：' : '打开失败：') + bu2);
      next(); return;
    }
    /* v1.29（P4）：Agent 模式也能读/操作应用内浏览器（逻辑复用 09-pick.js 的 BROWSER_TOOL） */
    if (c.op === 'browser-read' || c.op === 'browser-act'){
      if (typeof BROWSER_TOOL === 'undefined'){
        parts.push('[' + c.op + '] 浏览器工具组件未加载（请重启应用）'); next(); return;
      }
      var _bArg = String(c.path || '').trim();
      if (c.op === 'browser-read'){
        if (_bArg){
          var _bU2 = NET.safeUrl(_bArg);
          if (!_bU2){ parts.push('[browser-read] 地址无效（需 http/https 绝对地址）：' + _bArg); next(); return; }
          _bArg = _bU2;
        }
        BROWSER_TOOL.read(_bArg).then(function(d){
          if (d.error) parts.push('[browser-read] 失败：' + d.error);
          else parts.push(BROWSER_TOOL.fmtRead(d));
        }, function(e){ parts.push('[browser-read] ' + ((e && e.message) || e)); }).then(next);
        return;
      }
      var _bAct = BROWSER_TOOL.parseAct(c.path, c.body);
      if (_bAct.err){ parts.push('[browser-act] 参数错误：' + _bAct.err); next(); return; }
      BROWSER_TOOL.call('act', _bAct).then(function(d){
        parts.push(BROWSER_TOOL.fmtAct(d));
      }, function(e){ parts.push('[browser-act] 失败：' + ((e && e.message) || e)); }).then(next);
      return;
    }
    if (c.op === 'time' || c.op === 'calc' || c.op === 'json' || c.op === 'http'){
      NET.simpleOp(c.op, c.arg, c.body).then(
        function(t){ parts.push('[' + c.op + ']\n' + t); },
        function(e){ parts.push('[' + c.op + '] 失败：' + ((e && e.message) || e)); }
      ).then(next);
      return;
    }
    /* v0.7.0：批量抓取（Agent 模式只回摘要，不落盘） */
    if (c.op === 'crawl'){
      var au = NET.safeUrl(String(c.path || '').trim() || String(c.body || '').trim());
      if (!au){ parts.push('[crawl] 地址无效'); next(); return; }
      var amax = 10, am = /max\s*=\s*(\d+)/i.exec(String(c.body || '') + ' ' + String(c.arg || ''));
      if (am) amax = Math.min(200, Math.max(1, parseInt(am[1], 10)));
      NET.crawl(au, { max: amax }).then(function(r){
        var head = r.pages.slice(0, 3).map(function(p){
          return '### ' + (p.title || p.url) + '\n' + String(p.text || '').slice(0, 2000);
        }).join('\n\n');
        var msg = '[crawl] ' + au + '（成功 ' + r.pages.length + ' 页，失败 ' + r.fails.length + ' 页）';
        if (r.fails.length) msg += '\n' + r.fails.slice(0, 3).map(function(f){ return '  - ' + f.url + '：' + f.err; }).join('\n');
        parts.push(msg + (head ? '\n\n' + head : ''));
      }, function(e){ parts.push('[crawl] 失败：' + (e && e.message || e)); }).then(next);
      return;
    }
    /* v1.28.1：Agent 里也真的执行 web / search / get（以前只写进提示词，围栏没人跑） */
    if (c.op === 'web'){
      var wu = NET.safeUrl(String(c.path || '').trim() || String(c.body || '').trim());
      if (!wu){ parts.push('[web] 地址无效（需 http/https 绝对地址）'); next(); return; }
      NET.fetchPageText(wu).then(function(txt){
        if (!txt) parts.push('[web] 抓取失败：' + wu + '（反爬/登录墙/断网；可改用 search）');
        else { var cut = txt.slice(0, LIMITS.WORK_WEB_CHARS); parts.push('[web] ' + wu + '（成功，' + txt.length + ' 字）\n\u0060\u0060\u0060\n' + cut + '\n\u0060\u0060\u0060'); }
      }, function(e){ parts.push('[web] 失败：' + (e && e.message || e)); }).then(next);
      return;
    }
    if (c.op === 'search'){
      var qq = String(c.path || '').trim();
      if (!qq){ parts.push('[search] 缺少查询词'); next(); return; }
      NET.searchWeb(qq, null, true).then(function(r){
        if (!r || !r.block) parts.push('[search] 未返回结果：' + qq + '（检查 设置 → 连接与模型 → 联网搜索）');
        else parts.push('[search] ' + qq + '（' + (r.n || 0) + ' 条）\n\n' + r.block);
      }, function(e){ parts.push('[search] 失败：' + (e && e.message || e)); }).then(next);
      return;
    }
    if (c.op === 'get'){
      var gu = NET.safeUrl(String(c.path || '').trim() || String(c.body || '').trim());
      if (!gu){ parts.push('[get] 地址无效'); next(); return; }
      NET.fileGet(gu, '', null).then(function(r){
        parts.push('[get] 已保存：' + ((r && (r.path || r.name)) || gu) + '（' + ((r && r.size) || 0) + ' 字节）');
      }, function(e){ parts.push('[get] 失败：' + (e && e.message || e)); }).then(next);
      return;
    }
    if (c.op === 'sub' || c.op === 'agent' || c.op === 'suball'){
        var sRole = String(c.path || '').trim().split(/\s+/)[0];
        if (!sRole && !(c.items && c.items.length)){ parts.push('[agent] 缺少角色名'); next(); return; }
        if (c.op === 'suball'){
          var lines2 = (String(c.path || '').replace(sRole, '') + '\n' + (c.body || '')).split(/\r?\n/), items2 = (c.items && c.items.length) ? c.items.slice() : [];
          if (!items2.length){
          for (var li = 0; li < lines2.length; li++){
            var ln2 = lines2[li].trim(); if (!ln2) continue;
            var pm = ln2.match(/^([a-z][a-z0-9-]{1,24})\s*[|:：]\s*(.+)$/) || ln2.match(/^([a-z][a-z0-9-]{1,24})\s+(.+)$/);
            if (pm) items2.push({ name: pm[1], task: pm[2] });
          }
          }
          if (!items2.length){ parts.push('[agent] 没解析出任务（每行：角色 | 任务）'); next(); return; }
          var t0p = Date.now();
          SUB.runAll(items2, 0).then(function(rs){
            var hintA2 = SUB.stageHint(rs.map(function(r){ return r.name; }));
            parts.push('[agent] ' + rs.length + ' 个并行完成（' + (Date.now() - t0p) + 'ms）\n' +
              rs.map(function(r){ return '【' + r.name + '】' + (r.ok ? '' : '（失败）') + '\n' + String(r.text).slice(0, 3000); }).join('\n\n') + (hintA2 ? '\n' + hintA2 : ''));
          }, function(e){ parts.push('[agent] 失败：' + (e && e.message || e)); }).then(next);
          return;
        }
        var sTask = (String(c.path || '').replace(sRole, '') + (c.body ? '\n' + c.body : '')).trim();
        var t0r = Date.now();
        SUB.run(sTask, sRole, 0, sid0).then(function(txt){
          var hintS2 = SUB.stageHint([sRole]);
          parts.push(String(txt).slice(0, 6000) + (hintS2 ? '\n' + hintS2 : '') + '\n（' + (Date.now() - t0r) + 'ms）');
        }, function(e){ parts.push('[agent] ' + sRole + ' 失败：' + (e && e.message || e)); }).then(next);
        return;
      }
    if (EXT.hasTool(c.op)){ /* v0.3.52：扩展工具在 Agent/FS 模式也要能跑，别再静默吞掉 */
      EXT.runTool(c.op, String(c.arg || '') + (c.body ? '\n' + c.body : '')).then(function(out){
        parts.push('[工具 ' + c.op + ']\n' + String(out || '').slice(0, 4000));
      }, function(e){ parts.push('[工具 ' + c.op + '] 失败：' + (e && e.message || e)); }).then(next);
      return;
    }
      NET.fs(c.op === 'fs-list' ? 'list' : 'read', c.path, null, ws0).then(
        function(r){
          if (c.op === 'fs-edit') return applyEdit(c, r, ws0).then(function(t){ parts.push(t); });
          parts.push(fmtResult(c, r, null));
        },
        function(err){ parts.push(fmtResult(c, null, err && err.message || '执行失败')); }
      ).then(next);
    })();
  }
  function applyEdit(c, r, wsIn){ /* v0.3.0：精确局部替换（唯一匹配才写）；v0.3.3：写入根由调用方指定 */
    var text = (r && r.text) || '', o = c.oldText, n = c.newText;
    if (!o) return Promise.resolve('[fs-result] edit ' + c.path + '（失败：缺少 --- old 段）');
    var at = text.indexOf(o), cnt = 0, i = 0;
    while ((i = text.indexOf(o, i)) >= 0){ cnt++; i += o.length || 1; if (cnt > 2) break; }
    if (!cnt) return Promise.resolve('[fs-result] edit ' + c.path + '（失败：没找到原文，请补更多上下文）');
    if (cnt > 1) return Promise.resolve('[fs-result] edit ' + c.path + '（失败：匹配到 ' + cnt + ' 处，请给更长的唯一片段）');
    var _ext = String(c.path || '').split('.').pop().toLowerCase();
    var _bad = String(S.cfg.dangerExt == null ? 'exe,bat,cmd,ps1,dll,msi,scr' : S.cfg.dangerExt).split(',').map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean);
    if (_bad.indexOf(_ext) >= 0) return Promise.resolve('[fs-result] edit ' + c.path + '（失败：.' + _ext + ' 属于高风险类型，请改用 fs-write 走人工确认）'); // v0.3.44：fs-edit 不能绕过危险扩展名检查
    var _dirs = String(S.cfg.writeDirs || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean);
    if (_dirs.length){
      var _p2 = String(c.path || ''), _hit = false;
      for (var _di = 0; _di < _dirs.length; _di++) if (_p2.toLowerCase().indexOf(_dirs[_di].toLowerCase()) >= 0) { _hit = true; break; }
      if (!_hit) return Promise.resolve('[fs-result] edit ' + c.path + '（失败：不在写入白名单目录内，请改用 fs-write 走人工确认）'); // v0.3.53：fs-edit 也要守白名单
    }
    if (isOutside(c.path)) return Promise.resolve('[fs-result] edit ' + c.path + '（失败：工作区外编辑需人工确认，请改用 fs-write）');
    var next = text.slice(0, at) + n + text.slice(at + o.length);
    return NET.fs('write', c.path, next, wsIn || curWs(), false).then(function(w){
      return '[fs-result] edit ' + c.path + '（已替换 1 处，写入 ' + ((w && w.bytes) || next.length) + ' 字节）';
    }, function(e){ return '[fs-result] edit ' + c.path + '（写入失败：' + (e && e.message || e) + '）'; });
  }
  function fmtResult(c, r, err){
    if (err) return '[fs-result] ' + c.op + ' ' + c.path + '（失败：' + err + '）';
    if (c.op === 'fs-read'){
      var text = r.text || '', cut = false;
      if (text.length > LIMITS.FS_READ_CHARS){ text = text.slice(0, LIMITS.FS_READ_CHARS); cut = true; }
      return '[fs-result] read ' + c.path + '（' + (r.lines || 0) + ' 行 / ' + sizeFmt(r.bytes || 0) + (cut ? '，已按上下文限额截断' : '') + '）\n```\n' + text + '\n```';
    }
    if (c.op === 'fs-list'){
      var es = (r.entries || []).map(function(e){ return (e.d ? '[目录] ' : '[文件] ') + e.n + (e.d ? '' : '（' + sizeFmt(e.s) + '）'); });
      return '[fs-result] list ' + (c.path || '.') + '（' + es.length + ' 项' + (r.truncated ? '，已截断' : '') + '）\n```\n' + es.join('\n') + '\n```';
    }
    return '[fs-result] ' + c.op + ' ' + c.path;
  }
  /* 写入确认：应用/拒绝（宿主侧另有校验）。
     v1.4：工作区内（相对路径）由 handleTurn 自动应用；工作区外（绝对路径/UNC/..）逐次弹确认，
     确认框须写明【位置】与【操作内容】，用户同意后带 out=1 交给宿主再校验。 */
  function apply(mid, path, btn){
    var msg = (mid && typeof mid === 'object') ? mid : byId(mid); /* v0.3.3：后台会话的消息不在 S.msgs 里 */
    if (btn && S.cfg.mode !== 'agent'){ UI.toast('文件 Agent 已关闭', true); return; }
    var block = msg && findWrite(msg.content, path);
    if (!block){ UI.toast('找不到对应的写入申请', true); return; }
    var outside = isOutside(path);
    var ws = (function(sid){ try { var ss = sessionById(sid); return (ss && ss.workspace) || curWs(); } catch (e) { return curWs(); } })(msg && msg.sid);
    if (btn){ btn.disabled = true; btn.textContent = '写入中…'; }
    var ask = Promise.resolve(true);
    if (outside){
      var lines = (String(block.body).match(/\n/g) || []).length + 1;
      ask = UI.confirmBox({
        title: '工作区外写入确认',
        text: '位置：' + path +
          '\n操作：覆盖写入文件（' + lines + ' 行，约 ' + sizeFmt(block.body.length) + '）' +
          '\n已授权工作区：' + (ws || '（未设置）') +
          '\n\n目标不在授权文件夹内。下方卡片为写入前后差异预览；确认前请核对路径与改动内容。',
        danger: true, okText: '确认写入此位置'
      });
    }
    ask.then(function(ok){
      if (!ok){
        if (btn){ btn.disabled = false; btn.textContent = '应用写入'; }
        UI.toast('已取消工作区外写入：' + path);
        return;
      }
      NET.fs('write', path, block.body, ws, outside).then(function(r){
if (r && r.snap){ var sk = snapKey(msg.sid, ws, path); var arr = SC_SNAPS[sk]; if (!Array.isArray(arr)) arr = arr ? [{ t: Date.now(), s: arr }] : []; arr.push({ t: Date.now(), s: r.snap, b: (r.bytes || 0) }); while (arr.length > 5) arr.shift(); SC_SNAPS[sk] = arr; saveSnaps(); } // v0.3.12：每个会话/路径留最近 5 次写入快照
        try { stOf(msg.sid).planOk = true; } catch (e) {}   /* v1.29.0：确认过一次就解锁本会话自动写入 */
        markDone(msg, path, 'fs-done'); UI.toast('已写入 ' + path + '（' + ((r && r.bytes) || 0) + ' 字节）');
      }, function(err){
        if (btn){ btn.disabled = false; btn.textContent = '应用写入'; }
        UI.toast('写入失败：' + (err && err.message || '未知错误'), true);
      });
    });
  }
  /* v1.28.4：撤销这次写入 —— 用写入前快照恢复，只覆盖 SoloChat 自己写过的那一份 */
  /* v0.3.23：一条回复里多处写入，一次应用完（对标 Cursor 的 Accept all） */
  function applyAll(mid){
    if (S.cfg.mode !== 'agent'){ UI.toast('文件 Agent 已关闭：切到 Agent 模式才能应用写入', true); return; } // v0.3.29
    var msg = byId(mid); if (!msg) return;
    var seen = {}, n = 0;
    var _outside = []; scan(msg.content).forEach(function(c){ if (c.op === 'fs-write' && isOutside(c.path) && _outside.indexOf(c.path) < 0) _outside.push(c.path); });
    if (_outside.length){ UI.toast('有 ' + _outside.length + ' 处写入在工作区外，确认框只能一次弹一个，请逐个点卡片上的「应用写入」', true); return; } // v0.3.43：避免多个 confirm 只落定最后一个
    scan(msg.content).forEach(function(c){
      if (c.op !== 'fs-write' || seen[c.path]) return;
      seen[c.path] = 1; n++;
      apply(msg, c.path, null);
    });
    if (!n) UI.toast('这条回复里没有可应用的写入', true);
  }
  function undo(mid, path, btn){
  var um = byId(mid);
  var uws = (function(sid){ try { var ss = sessionById(sid); return (ss && ss.workspace) || curWs(); } catch (e) { return curWs(); } })(um && um.sid); // v0.4.0a：按消息所属会话
  var uk = snapKey(um && um.sid, uws, path);
var _sv = SC_SNAPS[uk] || SC_SNAPS[path]; var snap = Array.isArray(_sv) ? ((_sv[_sv.length - 1] || {}).s || '') : _sv; // v0.3.12：取最近一条
    if (!snap){ UI.toast('没有可用的快照（可能已被清理）', true); return; }
    var msg = byId(mid);
    UI.confirmBox({
      title: '撤销这次写入',
      text: '将把 ' + path + ' 恢复成写入前的内容。' +
        '\n\n快照：' + snap +
        '\n\n只恢复 SoloChat 写入的这一份；如果你之后在别的编辑器里改过它，那些改动会被覆盖。',
      danger: true, okText: '撤销写入'
    }).then(function(ok){
      if (!ok) return;
      if (btn){ btn.disabled = true; btn.textContent = '撤销中…'; }
      NET.fs('restore', path, snap, uws, isOutside(path)).then(function(r){
        var _sk = SC_SNAPS[uk] ? uk : (SC_SNAPS[path] ? path : null);
        if (_sk){ var _v = SC_SNAPS[_sk]; if (Array.isArray(_v)){ _v.pop(); if (!_v.length) delete SC_SNAPS[_sk]; } else delete SC_SNAPS[_sk]; } saveSnaps(); // v0.3.17：一次退一步
        try { D('undos'); } catch (e) {}
        if (msg) markDone(msg, path, 'fs-back');
        UI.toast('已撤销：' + path + '（' + ((r && r.bytes) || 0) + ' 字节）');
      }, function(e){
        if (btn){ btn.disabled = false; btn.textContent = '撤销'; }
        UI.toast('撤销失败：' + (e && e.message || '未知错误'), true);
      });
    });
  }
  function reject(mid, path){
    var msg = byId(mid);
    if (msg) markDone(msg, path, 'fs-rej'); UI.toast('已拒绝写入 ' + path);
  }
  function markDone(msg, path, lang){
    /* 仅替换围栏语言标记，内容保留（§4.2）。
       Issue 16: 与 findWrite 一致取"最后一个"同路径 fs-write 块（findWrite 反向扫描返回末位），
       防同名块时读体/改头错位；正则容忍 \r\n 与路径行尾随空白。 */
    var esc = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('```(?:fs-write|fs-done|fs-rej|fs-back)(?:[ \\t]*\\r?\\n[ \\t]*|[ \\t]+)' + esc + '[ \\t]*\\r?\\n', 'g'); // v0.3.42：兼容围栏行直接写路径
    var m, last = null;
    while ((m = re.exec(msg.content || ''))) last = m;
    if (!last) return;
    msg.content = msg.content.slice(0, last.index) +
                  '```' + lang + '\n' + path + '\n' +
                  msg.content.slice(last.index + last[0].length);
    DB.putMessage(msg);
    if (msg.sid === S.sid) UI.repaintMsg(msg.id); // v2.4：只重建这一条（原来整列表重建）
    continueAfterWrites(msg);
  }
  function continueAfterWrites(msg){
    var s0 = stOf(msg.sid);
    var calls = scan(msg.content), open = 0, done = [], lines = [], i;
    for (i = 0; i < calls.length; i++){ if (calls[i].op === 'fs-write') open++; else if (calls[i].op === 'fs-done' || calls[i].op === 'fs-rej' || calls[i].op === 'fs-back') done.push(calls[i]); }
    if (open || !done.length) return; // 仍有未处理的写入申请
    if (LIMITS.FS_MAX_TURNS > 0 && s0.turns >= LIMITS.FS_MAX_TURNS){ UI.toast('已达工具轮次上限（' + LIMITS.FS_MAX_TURNS + '）', true); return; }
    for (i = 0; i < done.length; i++)
  lines.push('[fs-result] write ' + done[i].path + (done[i].op === 'fs-done' ? '（已写入工作区）' : (done[i].op === 'fs-back' ? '（用户撤销了这次写入，文件已恢复为写入前内容）' : '（用户已拒绝写入，文件未修改）'))); // v0.3.42：撤销≠拒绝
    s0.turns++;
    note(lines.join('\n'), msg.sid);
    UI.startStreamFor(msg.sid); // 把确认结果告知模型，收尾（v2.2：目标会话）
  }
  /* 卡片差异预览：读旧内容→MD.diff（带缓存） */
  function hydrateAll(){
    var nodes = document.querySelectorAll('.fs-diff[data-fspath]');
    for (var i = 0; i < nodes.length; i++) hydrateOne(nodes[i]);
  }
  function hydrateOne(node){
    if (node.firstChild || !(node.closest('.msg'))) return;
    var art = node.closest('.msg'), mid = art.getAttribute('data-id'), path = node.getAttribute('data-fspath');
    var msg = byId(mid), block = msg && findWrite(msg.content, path);
    if (!block) return;
    var key = mid + '|' + path, get;
    if (diffCache[key]) get = Promise.resolve(diffCache[key]);
    else get = NET.fs('read', path, null, curWs()).then(function(r){
      if (Object.keys(diffCache).length > 24) diffCache = {}; // 缓存封顶
      diffCache[key] = { old: r.text || '', nw: block.body }; return diffCache[key];
    }, function(){ diffCache[key] = { old: '', nw: block.body }; return diffCache[key]; }); // 读失败按新文件处理
    get.then(function(d){ if (!node.firstChild) node.innerHTML = MD.diff(d.old, d.nw); });
  }
  return {
    handleTurn: handleTurn, apply: apply, applyAll: applyAll, reject: reject, undo: undo, hydrateAll: hydrateAll,
    reset: function(sid){ stMap[sid || S.sid] = { turns: 0, cancel: false }; },        // v2.2：按会话
    stop: function(sid){ stOf(sid).cancel = true; },                                  // v2.2：按会话
    protocol: PROTOCOL
  };
})();

/* ==== Work 模式（v2.0）：虚拟沙箱短任务循环 ====
   与 FS 同构：assistant 落定 → 扫 ```run / ```vfs-write / ```vfs-list 围栏 →
   串行执行（RUNNER.runCapture / DB.workfsPut）→ [run-result] 回灌 → startStream 续跑。
   纯页内：无服务端、不写磁盘；VFS 仅存 IndexedDB workfs（按会话隔离）。 */

/* v0.4.0：扩展系统 —— 内置能力 + tools + skills + plugins
   设计：内置功能全部注册成条目、默认勾选；用户可关；用户可加自定义 tool（一段 JS）与 skill（一段说明），
   skill 默认懒加载：提示词里只放名字+一句话，模型用到时才 ```skill 名字 取全文。 */
var EXT = (function(){
  var BUILTIN = [
    { id: 'web',        kind: 'tool', title: '抓网页正文', brief: 'URL → 纯文本', modes: ['work','agent'] },
    { id: 'crawl',      kind: 'tool', title: '批量抓取',   brief: '起点 URL → 沿翻页抓 N 页 → 存工作区', modes: ['work','agent'] },
    { id: 'search',     kind: 'tool', title: '联网搜索',   brief: '关键词 → 标题/链接/摘要', modes: ['work','agent'] },
    { id: 'get',        kind: 'tool', title: '抓文件',     brief: 'URL → 落盘（图片/PDF/Office/音视频），文档抽正文', modes: ['work','agent'] },
  { id: 'browser',    kind: 'tool', title: '内置浏览器', brief: 'URL → 应用内窗口（带 cookie/登录态）', modes: ['work','agent'] },
    { id: 'browser-read', kind: 'tool', title: '读网页', brief: 'URL/当前页 → 标题+正文+链接', modes: ['work','agent'] },
    { id: 'browser-act',  kind:'tool', title:'操作网页', brief:'click/type/scroll/wait/back', modes:['work','agent'] },
    { id: 'extract',     kind:'tool', title:'结构化提取', brief:'页面 → 选择器抓字段 → CSV', modes:['work'] },
    { id: 'py',          kind:'tool', title:'Python 沙箱', brief:'临时目录跑脚本，文件自动进出', modes:['work'] },
    { id: 'download',   kind: 'tool', title: '下载视频',   brief: 'B 站/直链 → mp4，HLS 自动拼接', modes: ['work'] },
    { id: 'play',       kind: 'tool', title: '应用内播放', brief: 'URL → 悬浮播放窗口', modes: ['work'] },
    { id: 'run',        kind: 'tool', title: '沙箱运行',   brief: 'html/js/css → 控制台输出', modes: ['work'] },
    { id: 'preview',    kind: 'tool', title: '预览产物',   brief: '工作区文件 → 右侧面板', modes: ['work'] },
    { id: 'vfs-write',  kind: 'tool', title: '写虚拟工作区', brief: '路径 + 完整内容', modes: ['work'] },
    { id: 'vfs-list',   kind: 'tool', title: '列虚拟工作区', brief: '文件列表', modes: ['work'] },
    { id: 'vfs-read',   kind: 'tool', title: '读虚拟工作区', brief: '读取附件/产物原文', modes: ['work'] },
    { id: 'patch',      kind: 'tool', title: '打补丁',     brief: 'unified diff 局部修改', modes: ['work'] },
    { id: 'fs-read',    kind: 'tool', title: '读本地文件', brief: '工作区相对路径', modes: ['agent'] },
    { id: 'fs-write',   kind: 'tool', title: '写本地文件', brief: '新建 / 整文件替换', modes: ['agent'] },
    { id: 'fs-edit',    kind: 'tool', title: '局部修改',   brief: '唯一匹配替换', modes: ['agent'] },
    { id: 'fs-list',    kind: 'tool', title: '列目录',     brief: '工作区结构', modes: ['agent'] },
    { id: 'grep',       kind: 'tool', title: '全文检索',   brief: '正则搜索工作区，回 路径:行号', modes: ['agent'] },
    { id: 'glob',       kind: 'tool', title: '按名找文件', brief: '通配路径 → 文件列表', modes: ['agent'] },
    { id: 'skill',      kind: 'tool', title: '调用技能',   brief: '按名字取技能说明', modes: ['work','agent'] },
    { id: 'sub',        kind: 'tool', title: '派子智能体（单任务）', brief: '独立上下文跑子任务，只回结果', modes: ['work'] },
    { id: 'suball',     kind: 'tool', title: '并行派活',   brief: '多个子智能体同时跑', modes: ['work', 'agent'] },
    { id: 'agent',      kind: 'tool', title: '按角色派活', brief: '按角色派活（clarify/criteria/plan/build/verify/fix/deliver）', modes: ['work', 'agent'] },
    { id: 'cmd',        kind: 'tool', title: '执行命令',   brief: '工作区内跑 git/node/npm 等（需确认）', modes: ['agent'] },
    { id: 'python',     kind: 'tool', title: '运行 Python', brief: 'Python 3.11 运行时 → 脚本输出', modes: ['agent'] },
    { id: 'git',        kind: 'tool', title: 'Git 操作',   brief: 'git status/diff/log/commit（需确认）', modes: ['agent'] },
    /* v0.4.1：纯本地小工具，无副作用，Work/Agent/Chat 都能用 */
    { id: 'nav',       kind: 'tool', title: '航海图',     brief: '真方位/舷角/相遇局面，给角度自动出图', modes: ['work','agent'] },
    { id: 'chart',     kind: 'tool', title: '图表',       brief: '柱状/折线/饼图/时间线，给数据自动出图', modes: ['work','agent'] },
    { id: 'shot',      kind: 'tool', title: '网页截图',   brief: '截当前内置浏览器并贴进回复', modes: ['work','agent'] },
    { id: 'time',       kind: 'tool', title: '当前时间',   brief: '时区 → 日期/时间/时间戳', modes: ['work','agent'] },
    { id: 'calc',       kind: 'tool', title: '算式计算',   brief: '表达式 → 结果（自己解析，不用 eval）', modes: ['work','agent'] },
    { id: 'json',       kind: 'tool', title: 'JSON 处理',  brief: '格式化 / 按路径取值', modes: ['work','agent'] },
    { id: 'http',       kind: 'tool', title: 'HTTP 请求',  brief: 'GET/POST → 状态码 + 响应体', modes: ['work','agent'] }
  ];
  function userItems(){ return (S.cfg.ext || []); }
  function offList(){ var l = S.cfg.extOff; return Array.isArray(l) ? l : []; }
  function save(){ saveCfg(); }
  /* B1-1：find() 返回的是 BUILTIN 原始对象（kind='tool'，没有 'builtin'），
     所以不能用 it.kind 判断内置。内置项一律先按 isKnownBuiltin 分流，
     开关只落在 cfg.extOff（会持久化），刷新后才不会丢。 */
  function isOn(id){
    if (isKnownBuiltin(id)) return offList().indexOf(id) < 0;
    var it = find(id);
    if (it) return it.on !== false;
    return offList().indexOf(id) < 0;
  }
  function find(id){
    for (var i = 0; i < BUILTIN.length; i++) if (BUILTIN[i].id === id) return BUILTIN[i];
    var u = userItems();
    for (var j = 0; j < u.length; j++) if (u[j].id === id || u[j].name === id) return u[j];
    return null;
  }
  function setOn(id, on){
    if (isKnownBuiltin(id)){
      var l = offList().filter(function(x){ return x !== id; }); // 先剔重，再按开关 push/不 push
      if (!on) l.push(id);
      setCfg({ extOff: l }); save();
      return;
    }
    var it = find(id);
    if (!it) return;
    it.on = !!on; save();
  }
  function add(item){
    if (!item || !item.name) throw new Error('缺少 name');
    if (!/^[a-z][a-z0-9-]{1,24}$/.test(item.name)) throw new Error('name 只能用小写字母/数字/短横，2-25 字符');
    if (find(item.name) && item.kind !== 'builtin') throw new Error('名字已存在：' + item.name);
    var kk0 = ['skill', 'agent'].indexOf(item.kind) >= 0 ? item.kind : 'tool';
    /* v1.0.0：工具只能是声明式 HTTP（沙箱）——任意 JS 不再执行 */
    if (kk0 === 'tool' && !item.url){
      throw new Error('工具需要 url（声明式）：{"name":"查天气","type":"http","url":"https://…/{arg}"}' +
        (item.code ? '；旧式 JS 代码工具已停用' : ''));
    }
    var u = userItems().slice();
    var kk = ['skill', 'agent'].indexOf(item.kind) >= 0 ? item.kind : 'tool';
    u.push({ id: item.name, name: item.name, kind: kk,
      title: item.title || item.name, desc: item.desc || '', code: '', body: item.body || item.prompt || '',
      url: item.url || '', method: item.method || 'GET', headers: item.headers || null, bodyTpl: item.body || '',
      tools: Array.isArray(item.tools) ? item.tools : [],
      writes: !!item.writes,
      maxTurns: item.maxTurns || 3, maxTokens: item.maxTokens || 1200, timeout: item.timeout || 120000,
      modes: item.modes || ['work'], on: item.on !== false, pkg: item.pkg || '', pkgVer: item.pkgVer || '', model: item.model || '' });
    setCfg({ ext: u }); save();
    return item.name;
  }
  function delPkg(pkg){
    if (!pkg) return 0;
    var u = userItems().filter(function(x){ return x.pkg !== pkg; });
    var ps = (S.cfg.prompts || []).filter(function(x){ return x.pkg !== pkg; });
    var n = (userItems().length - u.length) + ((S.cfg.prompts || []).length - ps.length);
    setCfg({ ext: u, prompts: ps }); save();
    return n;
  }
  function del(id){
    var u = userItems().filter(function(x){ return x.id !== id && x.name !== id; });
    setCfg({ ext: u }); save();
  }
  /* 插件：{name, tools:[{name,desc,code}], skills:[{name,desc,body}]} 一次性展开成多条 */
  function importPlugin(pk){
    if (!pk || (!pk.tools && !pk.skills)) throw new Error('插件里没有 tools/skills');
    var n = 0, t = pk.tools || [], sk = pk.skills || [], i;
    for (i = 0; i < t.length; i++){ add({ kind: 'tool', name: t[i].name, desc: t[i].desc, url: t[i].url, method: t[i].method, headers: t[i].headers, body: t[i].body, modes: t[i].modes }); n++; }
    for (i = 0; i < sk.length; i++){ add({ kind: 'skill', name: sk[i].name, desc: sk[i].desc, body: sk[i].body, modes: sk[i].modes }); n++; }
    return n;
  }
  function toolsFor(mode){
    var out = [];
    var u = userItems();
    for (var i = 0; i < u.length; i++){
      var it = u[i];
      if (it.kind !== 'tool' || it.on === false) continue;
      if ((it.modes || ['work']).indexOf(mode) < 0) continue;
      out.push(it);
    }
    return out;
  }
  function skillsFor(mode){
    return userItems().filter(function(it){
      return it.kind === 'skill' && it.on !== false && (it.modes || ['work']).indexOf(mode) >= 0;
    });
  }
  function hasTool(name){
    var u = userItems();
    for (var i = 0; i < u.length; i++) if (u[i].kind === 'tool' && u[i].name === name && u[i].on !== false) return u[i];
    return null;
  }
  function isKnownBuiltin(name){
    for (var i = 0; i < BUILTIN.length; i++) if (BUILTIN[i].id === name) return true;
    return false;
  }
/* v1.0.0：插件沙箱 —— 自定义工具改为声明式（type:"http" 的 url/method/headers/body 模板），
     不再执行任意 JS；CSP 已收回 'unsafe-eval'，旧式 code 工具一律拒绝执行并给出迁移提示。 */
  function fillTpl(str, arg){
    return String(str == null ? '' : str).split('{arg}').join(encodeURIComponent(String(arg == null ? '' : arg)));
  }
/* ========== v1.22：扩展包导入（文件 / 文件夹） ========== */
function readText(f){
  return new Promise(function(res, rej){
    try{
      var r = new FileReader();
      r.onload = function(){ res(String(r.result == null ? '' : r.result)); };
      r.onerror = function(){ rej(r.error || new Error('读取失败')); };
      r.readAsText(f);
    } catch(e){ rej(e); }
  });
}
/* --- 前置元数据：---  key: value  ---  正文 --- */
function parseFront(txt){
  var o = { m: {}, body: String(txt == null ? '' : txt) };
  var t = o.body.replace(/^\uFEFF/, '');
  if (t.slice(0, 3) !== '---'){ o.body = t; return o; }
  var e = t.indexOf('\n---', 3);
  if (e < 0){ o.body = t; return o; }
  t.slice(3, e).split(/\r?\n/).forEach(function(l){
    var mm = l.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
    if (!mm) return;
    var k = mm[1].toLowerCase(), v = mm[2].trim().replace(/^['"]|['"]$/g, '');
    if (v === 'true') v = true; else if (v === 'false') v = false;
    else if (/^\[[\s\S]*\]$/.test(v)) v = v.slice(1, -1).split(',').map(function(s){ return s.trim().replace(/^['"]|['"]$/g, ''); }).filter(Boolean);
    o.m[k] = v;
  });
  o.body = t.slice(e + 4).replace(/^\r?\n/, '');
  return o;
}
function baseName(p){
  return String(p || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '');
}
function pkgName(base, fallback){
  var s = String(base || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 22);
  if (!/^[a-z][a-z0-9-]{1,23}$/.test(s)) s = '';
  return s || fallback;
}
function fileSafe(name, fallback){
  var x = String(name == null ? '' : name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').replace(/[. ]+$/, '').trim();
  if (!x) x = fallback || 'item';
  if (x.length > 60) x = x.slice(0, 60);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(x)) x = '_' + x;
  return x;
}
/* v1.27：内置工具的「真实契约」——调用写法 / 参数 / 返回 / 限制。
   内置工具不是一段可导出的 JSON，它们由扫描围栏 + 宿主桥实现，这里写清楚模型该怎么调。 */
var SPECS = {
  web: { form: 'web <url>', arg: '一个 http/https 绝对地址', ret: '[web] 地址（成功，N 字）+ 正文纯文本', note: '抓网页转纯文本，适合读文章/文档页。', limit: '只抓文本：图片、音视频等二进制会直接跳过（要存文件用 get，要看视频用 play）；反爬、登录墙、断网会失败，可退回 search 拿摘要。' },
  search: { form: 'search <关键词>', arg: '一句查询词', ret: '[search] 关键词（N 条）+ 标题/链接/摘要块', note: '走 设置 → 连接与模型 → 联网搜索 里配的服务商。', limit: '服务商或密钥没配好会返回「未返回结果」；结果条数与摘要长度由服务商决定。' },
  get: { form: 'get <url>', arg: '文件直链（http/https）', ret: '[get] 已保存：路径（大小，类型）', note: '图片/PDF/Office/压缩包/音视频都能落盘；文档顺手抽正文（前 4000 字）。', limit: '图片会以 data URL 附进结果供模型看图；网页版没有宿主桥时不可用。' },
  download: { form: 'download <视频页 URL 或 BV 号>', arg: 'B 站页面地址，或 BV 号（如 BV1xx411x7xx）', ret: '[download] 已保存：mp4 路径（大小，清晰度）', note: '宿主侧下载并自动拼 HLS 分片。', limit: '仅 Work 模式；需要宿主 exe，网页版没有这个能力。' },
  browser: { form: 'browser <url>', arg: '一个 http/https 绝对地址', ret: '[browser] 已在应用内窗口打开：url', note: '开一个应用内浏览器窗口（同一 WebView2，带 cookie 与登录态），用来看网页、榜单、需要登录的页面。', limit: '仅 Work / Agent；窗口由宿主 exe 打开，纯网页版退化为新标签页。地址必须是绝对 URL。' },
  'browser-read': { form: 'browser-read <url>' + '\n' + '（url 可空 = 读当前页面）', arg: '可空；空则读应用内浏览器当前页', ret: '[browser-read] 标题 / URL + 正文 + 链接列表', note: '读渲染后的真实页面（JS 页面、加载更多之后都能读）：正文截 12000 字，链接前 40 条。', limit: '仅 Work / Agent；需先用 browser 打开页面；只读主文档，跨域 iframe 跳过；导航/读取 15s 超时；纯网页版无此能力。' },
  'browser-act': { form: 'browser-act click <选择器>' + '\n' + 'browser-act type <选择器> | <文本>' + '\n' + 'browser-act scroll <像素>' + '\n' + 'browser-act wait <选择器|毫秒>' + '\n' + 'browser-act back|forward', arg: '动作名 + 选择器/文本/像素', ret: '[browser-act] ok / url / title（失败带原因）', note: '在应用内浏览器里点按钮、填输入框、滚动加载更多、等待元素出现或后退/前进。', limit: '仅 Work / Agent；选择器不存在返回 selector not found；wait 最多等 15s；type 会覆盖原有值并触发 input 事件。' },
  extract: { form: 'extract <url|->' + '\n' + '--items "<条目选择器>"' + '\n' + '--fields "name:.title,price:.price,url:a@href"' + '\n' + '[--next "<下一页选择器>"] [--pages N] [--dedupe name] [--out games.csv]', arg: 'URL（- 表示当前页）+ 条目/字段/分页参数', ret: '[extract] 已保存：路径（N 行，M 列）+ 前 3 行预览', note: '按 CSS 选择器从页面（含 JS 渲染）抓结构化字段，输出 CSV 到工作区；字段写 @属性 可取 href/title 等属性。', limit: '仅 Work；Item 选择器必须在主文档；分页需要宿主浏览器；纯网页版只能单页（同源 fetch）；单次最多 10 页。' },
  py: { form: 'py' + '\n' + '（紧跟 Python 源码）', arg: 'Python 源码；工作区文本文件自动带进临时目录', ret: '[py] 退出码 + STDOUT/STDERR + 写回的文件清单', note: '在临时目录跑 Python：读工作区文件、清洗/计算、写新文件，跑完把改动写回工作区，目录即删。', limit: '仅 Work；需要 exe 宿主并安装 Python 3.11 运行时；单文件 ≤200KB；默认 60s 超时；脚本可访问网络与本机。' },
  play: { form: 'play <url>', arg: 'http/https 地址', ret: '[play] 已在播放窗口打开：url', note: '在顶层播放窗口打开，带 Referer 与登录态。', limit: '仅 Work 模式；地址必须是绝对 URL。' },
  run: { form: 'run <html|svg|js|css|c>' + '\n' + '（紧跟代码体）', arg: '第一行写类型，剩下是源码', ret: '[run-result] 类型 成功/失败（Nms）+ 控制台输出', note: '在沙箱 iframe / 脚本引擎里真跑一遍，拿真实输出，别在正文里手算。', limit: '支持 html/svg/js/css/c；同型错误连续多次会先自愈重试一次，仍失败就停下。' },
  preview: { form: 'preview <工作区相对路径>', arg: '如 index.html（不许 ..）', ret: '[preview] 已在运行面板打开：路径', note: '右侧运行面板的内置浏览器直接看产物。', limit: '仅 Work 模式；文件必须已在会话工作区里（先 vfs-write）。' },
  'vfs-write': { form: 'vfs-write <相对路径>' + '\n' + '（紧跟完整内容）', arg: '第一行路径，剩下是全文', ret: '[vfs] 已写入 路径（大小）', note: '写进本会话的内存工作区（IndexedDB），不碰真实磁盘；可一次写多个文件。', limit: '同路径再写就是整文件覆盖；局部改请用 patch。' },
  'vfs-list': { form: 'vfs-list', arg: '无', ret: '[vfs] 工作区文件（N 项）+ 路径（大小）列表', note: '看当前会话工作区里都有什么。', limit: '只列本会话的工作区，不含真实磁盘。' },
  'vfs-read': { form: 'vfs-read <相对路径>', arg: '如 attachments/航迹绘算作业.pptx.md', ret: '[vfs] 路径（大小）+ 文件内容（超长截断）', note: '读本会话工作区里的附件提取文本或产物原文，避免凭记忆猜。', limit: '只读本会话 VFS；超过约 6KB 会截断；二进制原文件只回元数据。' },
  patch: { form: 'patch <相对路径>' + '\n' + '（紧跟 unified diff）', arg: '第一行路径，剩下是 @@ 开头的 diff', ret: '[vfs] 已打补丁 路径（大小）', note: '局部修改省 token。', limit: '目标文件必须已存在；diff 上下文匹配不上会失败。' },
  'fs-read': { form: 'fs-read <相对路径>', arg: '相对工作区根的路径', ret: '[fs-result] read 路径 + 文件内容', note: '读真实磁盘上的文件。', limit: '长文件会被截断：先定位再改；读不了 .env/密钥这类文件。' },
  'fs-list': { form: 'fs-list <相对路径>' , arg: '可空，空 = 工作区根', ret: '[fs-result] list 路径（N 项）+ 条目', note: '动手前先看结构。', limit: '只能在工作区内；出界要逐次确认。' },
  'fs-write': { form: 'fs-write <相对路径>' + '\n' + '（紧跟完整内容）', arg: '第一行路径，剩下是全文', ret: '[fs-result] write 路径 + 结果', note: '新建文件或整文件替换。', limit: '工作区内直接写；工作区外每次都要你确认（显示完整路径与内容）。大改用这个，小改别用。' },
  'fs-edit': { form: 'fs-edit <相对路径>' + '\n--- old（原文）' + '\n--- new（新文）', arg: '路径 + old/new 两段', ret: '[fs-result] edit 路径 + 结果', note: '唯一匹配替换，省 token 的首选。', limit: '匹配不到或匹配到多处会失败，需要补上下文重试，不要退回整文件重写。' },
  grep: { form: 'grep <正则>' + '\n' + '[--path 子目录] [--glob "*.js"] [--max 100]', arg: '正则 + 可选目录/文件名过滤/上限', ret: '[grep] N 处（扫描 M 文件）+ 路径:行号: 文本', note: '在工作区里按正则逐行搜索；默认跳过 .git/node_modules/bin/obj/dist 等目录，单文件 >1MB 跳过。', limit: '只看文本文件；最多 200 处；正则 2s 超时；结果路径相对工作区。' },
  glob: { form: 'glob <通配路径>' + '\n' + '[--path 子目录]', arg: '如 **/*.cs 或 src/*.js', ret: '[glob] N 个文件 + 路径列表', note: '按通配符找文件：** 跨目录、* 单段、? 单字符。', limit: '最多 300 个；只列文件不列目录；大小写不敏感。' },
  python: { form: 'python' + '\n（紧跟完整代码）', arg: 'Python 3.11 脚本正文', ret: '[python] 退出码 + STDOUT/STDERR', note: '在 Agent 工作区里执行 Python 脚本；运行时从插件市场安装。', limit: '仅 Agent 模式；需要已安装 Python 3.11 运行时；执行前确认。' },
  skill: { form: 'skill <技能名>', arg: '技能条目的 name', ret: '该技能的说明正文', note: '按名字把技能说明取进上下文，相当于临时加载一份手册。', limit: '技能不存在会回错误；只读，不改技能内容。' },
  sub: { form: 'sub <角色> <任务>', arg: '角色名 + 任务描述（可多行）', ret: '子智能体的最终答复（不回过程）', note: '开一个独立上下文的子智能体跑一段活，只把结果拿回来。', limit: '仅 Work；子智能体受各自的工具白名单限制。' },
  agent: { form: 'agent <角色> <任务>', arg: '角色名（clarify/criteria/plan/build/verify/fix/deliver）+ 任务', ret: '子智能体的最终答复（不回过程）', note: '按角色派活，角色决定工具白名单与是否可写盘。', limit: '仅 Work / Agent；角色各自带工具白名单，写盘一律先进 _sub/ 暂存。' },
  suball: { form: 'suball 多个（角色 + 任务）段', arg: '按行/段写多组角色与任务', ret: '各组结果汇总', note: '几个互不依赖的活同时跑。', limit: '并行度与超时受宿主限制；结果按组回灌。' }
};
/* v1.26：条目详情 —— 文本 / 结构 / 声明式代码，只读 */
  /* v0.4.4：内置工具的实现就在 index.html 里 —— 读回自身文件，按调用点定位 + 括号配对，原样截出那段代码。
     只读展示、不执行；首次读入后缓存，之后点开不再请求。 */
  var SELF_SRC = null;
  function selfText(){
    if (SELF_SRC) return Promise.resolve(SELF_SRC);
    if (typeof fetch !== 'function') return Promise.reject(new Error('当前环境没有 fetch'));
    return fetch('index.html', { cache: 'no-store' }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function(t){ SELF_SRC = t; return t; });
  }
  function skipStr(s, i){
    var q = s.charAt(i), j = i + 1;
    for (; j < s.length; j++){
      var c = s.charAt(j);
      if (c === '\\') { j++; continue; }
      if (c === q) return j;
      if (q !== '`' && c === '\n') return j;
    }
    return j;
  }
  function matchBrace(s, i){
    var depth = 0;
    for (var j = i; j < s.length; j++){
      var c = s.charAt(j);
      if (c === '"' || c === "'" || c === '`'){ j = skipStr(s, j); continue; }
      if (c === '/' && s.charAt(j + 1) === '/'){ j = s.indexOf('\n', j); if (j < 0) return s.length - 1; continue; }
      if (c === '/' && s.charAt(j + 1) === '*'){ j = s.indexOf('*/', j); if (j < 0) return s.length - 1; j++; continue; }
      if (c === '{') depth++;
      else if (c === '}'){ depth--; if (depth === 0) return j; }
    }
    return s.length - 1;
  }
  function cutAt(s, key){
    var out = [], idx = 0;
    while (idx >= 0 && idx < s.length){
      idx = s.indexOf(key, idx);
      if (idx < 0) break;
      var b = s.indexOf('{', idx);
      if (b < 0) break;
      var e = matchBrace(s, b);
      var l0 = s.lastIndexOf('\n', idx) + 1;
      var l1 = s.indexOf('\n', e); if (l1 < 0) l1 = s.length;
      out.push(s.slice(l0, l1).replace(/^ {6}/gm, ''));
      idx = e + 1;
    }
    return out;
  }
  function codeOf(id){
    return selfText().then(function(s){
      var got = cutAt(s, "c.op === '" + id + "'");
      if (got.length) return got;
      /* time / calc / json / http 这类小工具写在 SMALL 对象里，单独定位 */
      var a = s.indexOf('var SMALL = {');
      if (a >= 0){
        var b = s.indexOf('\n  };', a);
        var seg = s.slice(a, b > a ? b : a + 6000);
        var g2 = cutAt(seg, id + ': function(');
        if (g2.length) return g2;
      }
      return [];
    });
  }
  function describe(id){
  var it = null, isBuiltin = false, i;
  for (i = 0; i < BUILTIN.length; i++) if (BUILTIN[i].id === id){ it = BUILTIN[i]; isBuiltin = true; break; }
  if (!it) userItems().forEach(function(x){ if (x.id === id || x.name === id) it = x; });
  if (!it) throw new Error('没有这个条目');
  var B = [];
  if (isBuiltin){
    var sp = SPECS[it.id] || null;
    B.push({ k: '用途', v: (it.title || it.id) + ' — ' + (it.brief || '') });
    if (sp){
      B.push({ k: '调用写法', v: '```' + sp.form.replace(/\n/g, '\n') + '```' });
      B.push({ k: '参数', v: sp.arg });
      B.push({ k: '返回', v: sp.ret });
      B.push({ k: '说明', v: sp.note });
      B.push({ k: '限制 / 实现', v: sp.limit });
    }
    B.push({ k: '可用模式', v: (it.modes || []).join(' / ') || '全部' });
    B.push({ k: '条目元数据', v: JSON.stringify(it, null, 2) + '\n\n（上面这段只是扩展页里的登记信息）' });
    var d0 = { title: it.title || it.id, kind: 'builtin', blocks: B };
    return codeOf(it.id).then(function(segs){
      if (segs && segs.length)
        d0.blocks.push({ k: '实现源码（index.html 原样截取 · ' + segs.length + ' 处）', v: segs.join('\n\n/* ──────────── */\n\n') });
      else
        d0.blocks.push({ k: '实现源码', v: '没有找到独立分支：这类工具的执行在宿主桥（NET.* / RUNNER.*）里，页面只留调用点。' });
      return d0;
    }, function(e){
      d0.blocks.push({ k: '实现源码', v: '读取自身文件失败：' + ((e && e.message) || e) + '\n（浏览器 file:// 直开时读不到自身；桌面版可以）' });
      return d0;
    });
  }
  var src = it.pkg ? (it.pkg + (it.pkgVer ? '（' + it.pkgVer + '）' : '')) : '（手工添加，无包）';
  B.push({ k: '类型', v: (it.kind === 'skill' ? '技能' : it.kind === 'agent' ? '智能体' : '工具') });
  B.push({ k: '说明', v: it.desc || '（无）' });
  B.push({ k: '可用模式', v: (it.modes || []).join(' / ') || '全部' });
  B.push({ k: '启用', v: it.on === false ? '已关闭（本轮不注入/不可调）' : '已开启' });
  B.push({ k: '来源包', v: src });
  if (it.kind === 'tool'){
    B.push({ k: '请求', v: (it.method || 'GET') + ' ' + (it.url || '') });
    B.push({ k: '请求头', v: it.headers ? JSON.stringify(it.headers, null, 2) : '（无）' });
    B.push({ k: '正文模板', v: it.bodyTpl || '（无，用 GET 参数）' });
    B.push({ k: '调用方式', v: '```' + it.name + ' 参数```，{arg} 会被 URL 编码后填进 url/body' });
    B.push({ k: '导出结构', v: 'tools/' + it.name + '.json' });
    B.push({ k: '声明式 JSON', v: JSON.stringify({ name: it.name, title: it.title, desc: it.desc, type: 'http', method: it.method || 'GET', url: it.url, headers: it.headers || undefined, body: it.bodyTpl || undefined, modes: it.modes || ['work'] }, null, 2) });
  } else if (it.kind === 'agent'){
    B.push({ k: '可用工具', v: (it.tools || []).length ? it.tools.join(' / ') : '（无）' });
    B.push({ k: '轮次 / token', v: '≤ ' + (it.maxTurns || 3) + ' 轮，≤ ' + (it.maxTokens || 1200) + ' token' });
    B.push({ k: '导出结构', v: 'agents/' + it.name + '.md' });
    B.push({ k: '提示词正文', v: it.body || '' });
  } else {
    B.push({ k: '导出结构', v: 'skills/' + it.name + '.md' });
    B.push({ k: '正文', v: it.body || '' });
  }
  return { title: it.title || it.name, kind: it.kind, blocks: B };
}
function freeName(base){
  if (!find(base)) return base;
  for (var i = 2; i < 60; i++){
    var n = base.slice(0, 18) + '-' + i;
    if (!find(n)) return n;
  }
  return base.slice(0, 14) + '-' + Date.now().toString(36).slice(-4);
}
function addPromptItem(name, text, pkg, ver){
  var ps = (S.cfg.prompts || []).slice();
  var nm = String(name || '提示词').trim().slice(0, 40) || '提示词';
  var base = nm, i = 2;
  while (ps.some(function(x){ return x.name === nm; })){ nm = base + ' ' + i; i++; }
  ps.push({ name: nm, text: String(text || ''), pkg: pkg || '', pkgVer: ver || '' });
  setCfg({ prompts: ps });
  return nm;
}
/* 单个条目：按 kind 落到 cfg.ext 或 cfg.prompts；失败只记录、不中断整包 */
function importOne(j, pkg, ver, rep){
  return readText(j.file).then(function(txt){
    var fm = parseFront(txt), m = fm.m || {}, meta = j.meta || {};
    var kind = m.kind || j.kind || 'tool';
    var base = baseName(j.path);
    if (kind === 'tool'){
      var obj;
      try { obj = JSON.parse(txt); } catch(e){ throw new Error('不是合法 JSON'); }
      var url = obj.url || meta.url;
      if (!url) throw new Error('工具缺少 url（只支持声明式 HTTP，不能带代码）');
      var nm = freeName(pkgName(obj.name || base, 'tool-' + Date.now().toString(36)));
      add({ kind: 'tool', name: nm, title: obj.title || obj.name || base, desc: obj.desc || '',
        url: url, method: obj.method || 'GET', headers: obj.headers || null, body: obj.body || null,
        modes: obj.modes || ['work'], pkg: pkg, pkgVer: ver });
      rep.added++;
      return;
    }
    if (kind === 'skill'){
      var body = String(fm.body || '').trim();
      if (!body) throw new Error('技能正文为空');
      var nm2 = freeName(pkgName(m.name || base, 'skill-' + Date.now().toString(36)));
      add({ kind: 'skill', name: nm2, title: m.title || m.name || base,
        desc: m.desc || m.description || '', body: body,
        modes: m.modes || ['work', 'agent'], pkg: pkg, pkgVer: ver });
      rep.added++;
      return;
    }
    if (kind === 'agent'){
      var bod = String(fm.body || '').trim();
      if (!bod) throw new Error('智能体提示词为空');
      var tls = Array.isArray(m.tools) ? m.tools : [];
      var nm3 = freeName(pkgName(m.name || base, 'agent-' + Date.now().toString(36)));
      add({ kind: 'agent', name: nm3, title: m.title || m.name || base,
        desc: m.desc || m.description || ('来自 ' + pkg), body: bod, tools: tls,
        writes: tls.indexOf('fs-write') >= 0 || tls.indexOf('patch') >= 0,
        modes: m.modes || ['work', 'agent'], model: m.model || '',
        maxTurns: m.maxturns || m.maxTurns || 4, maxTokens: m.maxtokens || m.maxTokens || 1600,
        pkg: pkg, pkgVer: ver });
      rep.added++;
      return;
    }
    if (kind === 'prompt'){
      var pb = String(fm.body || '').trim() || String(m.text || '').trim();
      if (!pb) throw new Error('提示词为空');
      addPromptItem(m.name || base, pb, pkg, ver);
      rep.prompts++;
      return;
    }
    throw new Error('不认识的 kind：' + kind);
  }).then(null, function(e){
    rep.skipped.push(j.path + '：' + (e && e.message || e));
  });
}
/* 一个文件夹（或一组散文件）→ 一个扩展包 */
function importGroup(root, entries, rep){
  var byPath = {};
  entries.forEach(function(e){ byPath[e.path] = e.file; });
  var manF = byPath['manifest.json'] || byPath['package.json'] || byPath['ext.json'];
  var manP = manF ? readText(manF).then(function(t){
    try { return JSON.parse(t); }
    catch(e){ throw new Error('manifest.json 不是合法 JSON：' + e.message); }
  }) : Promise.resolve(null);
  return manP.then(function(man){
    var pkg = String((man && (man.name || man.title)) || root || '未命名扩展包').slice(0, 40);
    var ver = String((man && man.version) || '');
    var jobs = [];
    if (man){
      var kinds = { skills: 'skill', tools: 'tool', agents: 'agent', prompts: 'prompt' };
      Object.keys(kinds).forEach(function(k){
        (man[k] || []).forEach(function(it){
          var f = typeof it === 'string' ? it : (it && (it.file || it.path));
          if (!f) return;
          if (!byPath[f]){ rep.skipped.push(pkg + '：清单里的 ' + f + ' 不存在'); return; }
          jobs.push({ kind: kinds[k], path: f, file: byPath[f], meta: (typeof it === 'object' ? it : {}) });
        });
      });
      (man.items || []).forEach(function(it){
        if (!it || !it.file) return;
        if (!byPath[it.file]){ rep.skipped.push(pkg + '：清单里的 ' + it.file + ' 不存在'); return; }
        jobs.push({ kind: it.kind || 'skill', path: it.file, file: byPath[it.file], meta: it });
      });
    }
    /* 清单只写了部分文件（或只写名字/版本）时，剩下的按目录结构补齐 */
    var explicitItems = !!(man && man.items && man.items.length);
    if (!explicitItems){
      var seenP = {};
      jobs.forEach(function(x){ seenP[x.path] = 1; });
      entries.forEach(function(e){
        if (seenP[e.path]) return;
        var low = e.path.toLowerCase();
        var kind = /(^|\/)skills?\//.test(low) ? 'skill'
          : /(^|\/)tools?\//.test(low) ? 'tool'
          : /(^|\/)agents?\//.test(low) ? 'agent'
          : /(^|\/)prompts?\//.test(low) ? 'prompt' : '';
        if (!kind || !/\.(md|markdown|txt|json)$/.test(low)) return;
        if (/(^|\/)(readme|license|changelog)\./.test(low)) return;
        jobs.push({ kind: kind, path: e.path, file: e.file, meta: {} });
      });
    }
    if (!jobs.length){
      /* 平铺的一组散文件（没有 skills/ tools/ 目录）：每个文件各自算一个条目 */
      entries.forEach(function(e){
        if (e.path.indexOf('/') >= 0) return;
        var low = e.path.toLowerCase();
        if (!/\.(md|markdown|txt|json)$/.test(low)) return;
        if (/(^|\/)(readme|license|changelog|manifest|package)\./.test(low)) return;
        jobs.push({ kind: /\.json$/.test(low) ? '' : 'skill', path: e.path, file: e.file, meta: {} });
      });
    }
    if (!jobs.length){ rep.skipped.push((pkg || '扩展包') + '：没找到 skills/ tools/ agents/ prompts/ 里的文件'); return; }
    var ch = Promise.resolve(), n0 = rep.added;
    jobs.forEach(function(j){ ch = ch.then(function(){ return importOne(j, pkg, ver, rep); }); });
    return ch.then(function(){
      rep.pkgs.push({ name: pkg, version: ver, count: rep.added - n0, total: jobs.length });
    });
  });
}
/* 一件扩展 → 一个包：技能/工具/智能体/提示词共用 */
function itemEntry(it){
  if (it.kind === 'skill')
    return { kindKey: 'skills', rel: 'skills/' + it.name + '.md',
      text: '---\nname: ' + it.name + '\ntitle: ' + (it.title || it.name) + '\ndesc: ' + (it.desc || '') +
        '\nmodes: [' + (it.modes || []).join(', ') + ']\n---\n\n' + (it.body || '') + '\n' };
  if (it.kind === 'tool'){
    var obj = { name: it.name, title: it.title, desc: it.desc, type: 'http', method: it.method || 'GET', url: it.url };
    if (it.headers) obj.headers = it.headers;
    if (it.bodyTpl) obj.body = it.bodyTpl;
    obj.modes = it.modes || ['work'];
    return { kindKey: 'tools', rel: 'tools/' + it.name + '.json', text: JSON.stringify(obj, null, 2) + '\n' };
  }
  if (it.kind === 'agent')
    return { kindKey: 'agents', rel: 'agents/' + it.name + '.md',
      text: '---\nname: ' + it.name + '\ntitle: ' + (it.title || it.name) + '\ndesc: ' + (it.desc || '') +
        '\ntools: [' + (it.tools || []).join(', ') + ']\nmaxTurns: ' + (it.maxTurns || 4) + '\nmaxTokens: ' + (it.maxTokens || 1600) +
        '\nmodes: [' + (it.modes || []).join(', ') + ']\n---\n\n' + (it.body || '') + '\n' };
  return null;
}
function promptEntry(pr, idx){
  var slug = fileSafe(pr.name, 'prompt-' + (idx + 1));
  return { kindKey: 'prompts', rel: 'prompts/' + slug + '.md',
    text: '---\nname: ' + pr.name + '\n---\n\n' + (pr.text || '') + '\n' };
}
function packBuild(pkg, list, prlist){
  var man = { name: pkg, version: '1.0.0', desc: '由 SoloChat 导出' }, out = [], buckets = {};
  list.forEach(function(it){
    var e = itemEntry(it); if (!e) return;
    (buckets[e.kindKey] = buckets[e.kindKey] || []).push(e.rel);
    out.push({ rel: e.rel, text: e.text });
  });
  (prlist || []).forEach(function(pr, i){
    var e = promptEntry(pr, i);
    (buckets.prompts = buckets.prompts || []).push(e.rel);
    out.push({ rel: e.rel, text: e.text });
  });
  ['skills', 'tools', 'agents', 'prompts'].forEach(function(k){ if (buckets[k] && buckets[k].length) man[k] = buckets[k]; });
  out.unshift({ rel: 'manifest.json', text: JSON.stringify(man, null, 2) + '\n' });
  return { name: pkg, files: out };
}
/* 整包导出（插件页） */
function exportFiles(pkg){
  var items = userItems().filter(function(x){ return x.pkg === pkg; });
  var prs = (S.cfg.prompts || []).filter(function(x){ return x.pkg === pkg; });
  if (!items.length && !prs.length) throw new Error('这个包没有条目');
  return packBuild(pkg, items, prs);
}
/* 按类导出（「导入导出」面板 → 导出本类…）：filter 为当前页签 agents/skills/tools/prompt/plugins */
function exportKind(kind){
  var label = { agents:'智能体', skills:'技能', tools:'工具', prompt:'提示词', plugins:'插件' }[kind] || '扩展';
  var items = userItems(), prs = [];
  if (kind === 'prompt'){ items = []; prs = (S.cfg.prompts || []).slice(); }
  else if (kind === 'plugins'){ prs = (S.cfg.prompts || []).slice(); }
  else {
    var k = kind === 'agents' ? 'agent' : (kind === 'skills' ? 'skill' : 'tool');
    items = items.filter(function(x){ return x.kind === k; });
  }
  if (!items.length && !prs.length) throw new Error('本类还没有可导出的内容');
  return packBuild('SoloChat-' + label, items, prs);
}
/* 单项导出（技能/工具/智能体页） */
function exportOne(id){
  var it = null;
  userItems().forEach(function(x){ if (x.id === id || x.name === id) it = x; });
  if (!it) throw new Error('没有这个条目');
  return packBuild(String(it.title || it.name), [it], []);
}
/* 任意文本 → 一个提示词包（系统提示词页导出用） */
function packText(title, text){
  return packBuild(fileSafe(title, '提示词'), [], [{ name: String(title || '提示词'), text: String(text || '') }]);
}
/* 提示词单项导出（提示词页） */
function exportPrompt(name){
  var pr = null;
  (S.cfg.prompts || []).forEach(function(x){ if (x.name === name) pr = x; });
  if (!pr) throw new Error('没有这条提示词');
  return packBuild(name, [], [pr]);
}
function importFiles(list){
  var files = Array.prototype.slice.call(list || []).filter(function(f){ return f && f.size > 0; });
  if (!files.length) return Promise.reject(new Error('没有选到文件'));
  var groups = {}, order = [];
  files.forEach(function(f){
    var rel = String(f.webkitRelativePath || f._rel || f.name || '').replace(/\\/g, '/');
    var seg = rel.split('/');
    var root = seg.length > 1 ? seg[0] : '';
    var p = seg.length > 1 ? seg.slice(1).join('/') : rel;
    if (!groups[root]){ groups[root] = []; order.push(root); }
    groups[root].push({ path: p, file: f });
  });
  var rep = { pkgs: [], added: 0, prompts: 0, skipped: [] };
  var chain = Promise.resolve();
  order.forEach(function(root){
    chain = chain.then(function(){ return importGroup(root, groups[root], rep); });
  });
  return chain.then(function(){ return rep; });
}
  /* 市场整包安装：只取文本、绝不执行市场代码；rawBase 可注入（本地 HTTP 自测用） */
  function installMarket(pkg, rawBase){
    if (!pkg || !pkg.path) return Promise.reject(new Error('包缺少 path'));
    var pname = String(pkg.name || pkg.id || '未命名包');
    function E(msg){ return new Error('「' + pname + '」' + msg); }
    /* 逐段编码 + 路径安全：拒绝空 / 绝对 / .. 段 / 协议 / 反斜杠；中文与空格逐段 encodeURIComponent */
    function segPath(p){
      var s = String(p == null ? '' : p);
      if (!s) throw E('路径为空');
      if (s.charAt(0) === '/') throw E('不允许绝对路径：' + s);
      if (s.indexOf('\\') >= 0) throw E('路径含反斜杠：' + s);
      if (s.indexOf(':') >= 0) throw E('路径含协议/冒号：' + s);
      var segs = s.split('/');
      for (var i = 0; i < segs.length; i++)
        if (!segs[i] || segs[i] === '..' || segs[i] === '.') throw E('路径含空段或 .. / .：' + s);
      return segs.map(function(x){ return encodeURIComponent(x); }).join('/');
    }
    var root = String(pkg.id || pkg.name || 'pkg').replace(/[\\/]/g, '-');
    var pathPart, base;
    try { pathPart = segPath(pkg.path); } catch (e){ return Promise.reject(e); }
    var raw = String(rawBase || '');
    if (raw.charAt(raw.length - 1) !== '/') raw += '/';
    base = raw + pathPart + '/';
    function get(rel){
      var enc;
      try { enc = segPath(rel); } catch (e){ return Promise.reject(e); }
      return NET.raw({ url: base + enc, method: 'GET', timeout: 15000 }).then(function(r){
        if (!r || r.status < 200 || r.status >= 300) throw E('HTTP ' + (r && r.status) + '：' + rel);
        var t = String(r.text || '');
        if (t.length > 512000) throw E('文件过大：' + rel);
        return t;
      });
    }
    function mk(rel, txt){
      var b = new Blob([txt], { type: 'text/plain' });
      b._rel = root + '/' + rel;
      b.name = rel.split('/').pop();
      return b;
    }
    return get('manifest.json').then(function(mtxt){
      var man;
      try { man = JSON.parse(mtxt); } catch(e){ throw E('manifest.json 不是合法 JSON：' + e.message); }
      /* 用 manifest.name 重算包根：让 importGroup 的 pkg 与 isInstalled(pkg.name) 一致 */
      root = String((man && (man.name || man.title)) || pkg.name || pkg.id || 'pkg').replace(/[\\/]/g, '-').slice(0, 40);
      var rels = [];
      ['skills', 'tools', 'agents', 'prompts'].forEach(function(k){
        (man[k] || []).forEach(function(it){
          var f = typeof it === 'string' ? it : (it && (it.file || it.path));
          if (f && rels.indexOf(f) < 0) rels.push(f);
        });
      });
      if (rels.length > 40) throw E('清单条目过多（' + rels.length + '）');
      var files = [mk('manifest.json', mtxt)];
      var chain = Promise.resolve();
      rels.forEach(function(rel){
        chain = chain.then(function(){
          return get(rel).then(function(txt){ files.push(mk(rel, txt)); });
        });
      });
      return chain.then(function(){
        if (files.length === 1) throw E('清单里没有可导入的条目');
        return importFiles(files);
      });
    });
  }
  function runTool(name, arg){
    var it = hasTool(name);
    if (!it) return Promise.reject(new Error('没有这个扩展工具：' + name));
    if (it.url){
      var method = String(it.method || 'GET').toUpperCase();
      var headers = {}, hs = it.headers || {};
      for (var k in hs) if (Object.prototype.hasOwnProperty.call(hs, k)) headers[k] = fillTpl(hs[k], arg);
      var body = null;
      if (method !== 'GET' && method !== 'HEAD' && it.body != null) body = fillTpl(it.body, arg);
      return NET.raw({ url: fillTpl(it.url, arg), method: method, headers: headers, body: body, timeout: 25000 })
        .then(function(r){
          var txt = String((r && r.text) || '');
          if (txt.length > 4000) txt = txt.slice(0, 4000) + '\n…（截断）';
          return '[' + name + '] HTTP ' + ((r && r.status) || '?') + '\n' + txt;
        });
    }
    if (it.code) return Promise.reject(new Error('「' + name + '」是旧式 JS 工具，已按安全策略停用（不再执行任意代码）。'
      + '请改成声明式：{"kind":"tool","name":"' + name + '","desc":"…","type":"http","url":"https://…/{arg}"}'));
    return Promise.reject(new Error('「' + name + '」缺少可执行定义：声明式工具需要 url'));
  }
  function skillText(name){
    var u = userItems(), i;
    for (i = 0; i < u.length; i++)
      if (u[i].kind === 'skill' && (u[i].name === name || u[i].id === name) && u[i].on !== false)
        return '【技能 ' + name + '】' + (u[i].desc ? '（' + u[i].desc + '）' : '') + '\n' + (u[i].body || '（空技能）');
    return '';
  }
  function skillNames(mode){ return skillsFor(mode).map(function(x){ return x.name; }); }
  /* v0.4.1：内置小工具（纯本地，无副作用）—— 自己解析算式，不依赖 eval（CSP 也不允许） */
  function evalExpr(src){
    var s = String(src || '').replace(/\s+/g, '')
      .replace(/[×✕]/g, '*').replace(/÷/g, '/').replace(/，/g, ',')
      .replace(/（/g, '(').replace(/）/g, ')');
    if (!s || !/^[0-9a-z+\-*/%^().,]+$/i.test(s)) return null;
    var i = 0;
    function callFn(name, a){
      switch (name.toLowerCase()){
        case 'sqrt': return Math.sqrt(a[0]);
        case 'abs': return Math.abs(a[0]);
        case 'round': return Math.round(a[0]);
        case 'floor': return Math.floor(a[0]);
        case 'ceil': return Math.ceil(a[0]);
        case 'log': return Math.log(a[0]);
        case 'pow': return Math.pow(a[0], a[1]);
        case 'min': return Math.min.apply(null, a);
        case 'max': return Math.max.apply(null, a);
        default: return null;
      }
    }
    function primary(){
      var c = s[i];
      if (c === '('){ i++; var v = expr(); if (s[i] === ')') i++; return v; }
      if (c === '-'){ i++; var n = primary(); return n == null ? null : -n; }
      if (c === '+'){ i++; return primary(); }
      var m = /^[a-z]+/i.exec(s.slice(i));
      if (m){
        var nm = m[0]; i += nm.length;
        if (s[i] !== '(') return null;
        i++;
        var args = [expr()];
        while (s[i] === ','){ i++; args.push(expr()); }
        if (s[i] === ')') i++;
        return callFn(nm, args);
      }
      var mm = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(s.slice(i));
      if (!mm) return null;
      i += mm[0].length;
      return parseFloat(mm[0]);
    }
    function power(){ var b = primary(); if (b == null) return null; if (s[i] === '^'){ i++; var e = power(); return Math.pow(b, e); } return b; }
    function term(){
      var v = power();
      while (v != null && '*/%'.indexOf(s[i]) >= 0){ var op = s[i++]; var r = power(); if (r == null) return null; v = op === '*' ? v * r : op === '/' ? v / r : v % r; }
      return v;
    }
    function expr(){
      var v = term();
      while (v != null && (s[i] === '+' || s[i] === '-')){ var op = s[i++]; var r = term(); if (r == null) return null; v = op === '+' ? v + r : v - r; }
      return v;
    }
    var out = expr();
    if (out == null || i !== s.length) return null;
    if (!isFinite(out)) return '∞（除以 0？）';
    return Math.round(out * 1e10) / 1e10;
  }
  var SMALL = {
    time: function(arg){
      var d = new Date(), tz = String(arg || '').trim();
      var opt = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'long' };
      if (tz && !/^(local|本地)$/i.test(tz)){
        try { opt.timeZone = tz; new Intl.DateTimeFormat('zh-CN', opt).format(d); }
        catch (e) { return '时区无效：' + tz + '（例：Asia/Shanghai、UTC、America/New_York）'; }
      }
      var s;
      try { s = new Intl.DateTimeFormat('zh-CN', opt).format(d); } catch (e) { s = d.toString(); }
      return '现在：' + s + '\n时区：' + (opt.timeZone || '本地') + '\nISO：' + d.toISOString() + '\n时间戳(ms)：' + d.getTime();
    },
    calc: function(arg){
      var v = evalExpr(arg);
      if (v === null) return '算式看不懂：' + String(arg || '').trim() + '\n支持 + - * / % ^ ( ) 与 sqrt/abs/round/floor/ceil/log/min/max/pow';
      return String(arg || '').trim() + ' = ' + v;
    },
    json: function(arg, body){
      var raw = String(body || '').trim(), path = raw ? String(arg || '').trim() : '';
      if (!raw) raw = String(arg || '').trim();
      var o;
      try { o = JSON.parse(raw); } catch (e) { return 'JSON 解析失败：' + ((e && e.message) || e); }
      var v = o;
      if (path){
        var segs = path.replace(/^\$?\.?/, '').split(/[.\[\]]+/).filter(Boolean);
        for (var i = 0; i < segs.length; i++){
          if (v == null) break;
          v = (Array.isArray(v) && /^\d+$/.test(segs[i])) ? v[+segs[i]] : v[segs[i]];
        }
        if (v === undefined) return '路径不存在：' + path;
      }
      var out = (typeof v === 'string') ? v : JSON.stringify(v, null, 2);
      if (out == null) out = String(v);
      if (out.length > 6000) out = out.slice(0, 6000) + '\n…（截断）';
      return (path ? path + ' =\n' : '') + out;
    },
    http: function(arg, body){
      var a = String(arg || '').trim();
      var m = /^(?:(GET|POST|PUT|PATCH|DELETE|HEAD)\s+)?(\S+)$/i.exec(a);
      if (!m) return Promise.reject(new Error('用法：```http GET https://…（第二行起是请求体）'));
      var method = (m[1] || 'GET').toUpperCase();
      var url = NET.safeUrl(m[2]);
      if (!url) return Promise.reject(new Error('地址无效（需 http/https 绝对地址）'));
      var payload = String(body || '').trim();
      var headers = { 'Accept': 'application/json, text/plain, */*' };
      if (payload) headers['Content-Type'] = 'application/json';
      return NET.raw({ url: url, method: method, headers: headers, body: payload || null, timeout: 20000 })
        .then(function(r){
          var t = String((r && r.text) || '');
          if (t.length > 6000) t = t.slice(0, 6000) + '\n…（截断）';
          return 'HTTP ' + (r && r.status) + ' · ' + method + ' ' + url + '\n```\n' + t + '\n```';
        });
    }
  };
  function hasSmall(op){ return Object.prototype.hasOwnProperty.call(SMALL, op); }
  function runSmall(op, arg, body){
    try { var r = SMALL[op](arg, body); return (r && r.then) ? r : Promise.resolve(String(r)); }
    catch (e) { return Promise.reject(e); }
  }
  /* 提示词：只放「名字 + 一句话」，正文按需加载 */
  /* v0.4.0c：扩展总目录 —— 六类内容（智能体/插件/技能/工具/提示词/MCP）都从这里出，
     UI 只按 kind 分类展示；id 带类型前缀，避免跨类重名 */
  function registry(){
    var out = [], i, u = userItems(), seen = {};
    for (i = 0; i < BUILTIN.length; i++){
      var b = BUILTIN[i];
      out.push({ id: 'builtin:' + b.id, kind: 'tool', name: b.id, title: b.title, desc: b.brief || '',
        modes: b.modes.slice(), builtin: true, on: isOn(b.id) });
    }
    /* 内置子智能体角色（clarify/criteria/plan/build/verify/fix/deliver）也算扩展内容 */
    try {
      if (typeof SUB !== 'undefined' && SUB && SUB.ROLES){
        for (i = 0; i < SUB.ROLES.length; i++){
          var ro = SUB.ROLES[i];
          out.push({ id: 'agent:' + ro.name, kind: 'agent', name: ro.name, title: ro.title || ro.name,
            desc: ro.desc || '', modes: ['work', 'agent'], builtin: true, on: true });
        }
      }
    } catch (e) {}
    for (i = 0; i < u.length; i++){
      var x = u[i], nm = x.name || x.id;
      var k = x.kind === 'skill' ? 'skill' : (x.kind === 'agent' ? 'agent' : 'tool');
      out.push({ id: k + ':' + nm, kind: k, name: nm, title: x.title || nm, desc: x.desc || '',
        modes: (x.modes || ['work']).slice(), builtin: false, on: x.on !== false, pkg: x.pkg || '' });
      if (x.pkg && !seen[x.pkg]){
        seen[x.pkg] = 1;
        out.push({ id: 'plugin:' + x.pkg, kind: 'plugin', name: x.pkg, title: x.pkg, desc: '扩展包',
          modes: ['work', 'agent'], builtin: false, on: true, pkg: x.pkg });
      }
    }
    var ps = S.cfg.prompts || [];
    for (i = 0; i < ps.length; i++){
      var pn = ps[i].name || ('prompt-' + (i + 1));
      out.push({ id: 'prompt:' + pn, kind: 'prompt', name: pn, title: pn, body: ps[i].text || '',
        desc: String(ps[i].text || '').replace(/\s+/g, ' ').slice(0, 50),
        modes: ['chat', 'work', 'agent'], builtin: false, on: true });
    }
    var ms = S.cfg.mcp || [];
    for (i = 0; i < ms.length; i++){
      var mn = ms[i].name || ms[i].url || ('mcp-' + i);
      out.push({ id: 'mcp:' + mn, kind: 'mcp', name: mn, title: mn, desc: ms[i].url || '',
        url: ms[i].url || '', modes: ['work', 'agent'], builtin: false, on: true });
    }
    /* 唯一 id：内置工具已用 builtin: 前缀，与用户 tool: 不冲突；这里兜底去重，避免重复条目 */
    var dedup = {}, res = [];
    for (i = 0; i < out.length; i++){ if (dedup[out[i].id]) continue; dedup[out[i].id] = 1; res.push(out[i]); }
    return res;
  }
  function prompt(mode){
    var lines = [], t = toolsFor(mode), s2 = skillsFor(mode), i, off = [];
    for (i = 0; i < BUILTIN.length; i++)
      if (BUILTIN[i].modes.indexOf(mode) >= 0 && !isOn(BUILTIN[i].id)) off.push(BUILTIN[i].id);
    /* v0.4.0c：本轮勾选了工具/技能时，只把选中的列给模型 */
    try {
      if (typeof PICK !== 'undefined' && PICK){
        var r = PICK.resolve();
        if (r.on){
          if (PICK.restrict()) t = t.filter(function(x){ return r.tools.indexOf(x.name) >= 0; });
          if (r.skills.length){
            var sk = {};
            for (i = 0; i < r.skills.length; i++) sk[r.skills[i].name] = 1;
            s2 = s2.filter(function(x){ return sk[x.name]; });
          }
        }
      }
    } catch (e) {}
    if (t.length){
      lines.push('扩展工具（用户启用，围栏名就是名字，首行参数）：');
      for (i = 0; i < t.length; i++) lines.push('```' + t[i].name + ' —— ' + (t[i].desc || t[i].title || ''));
    }
    if (s2.length){
      lines.push('技能（需要时用 ```skill 名字 取全文，先取后用）：');
      for (i = 0; i < s2.length; i++) lines.push('- ' + s2[i].name + '：' + (s2[i].desc || s2[i].title || ''));
    }
    if (off.length) lines.push('本轮已关闭的内置工具（调用会被拒绝）：' + off.join(' / '));
    return lines.join('\n');
  }
  return { BUILTIN: BUILTIN, all: function(){ return BUILTIN.map(function(b){ var o = {}; for (var k in b) o[k] = b[k]; o.kind = 'builtin'; o.on = isOn(b.id); return o; }).concat(userItems().map(function(x){ var o = {}; for (var k in x) o[k] = x[k]; o.on = x.on !== false; return o; })); },
    isOn: isOn, setOn: setOn, add: add, del: del, importPlugin: importPlugin, find: find,
    toolsFor: toolsFor, skillsFor: skillsFor, hasTool: hasTool, isKnownBuiltin: isKnownBuiltin,
    runTool: runTool, skillText: skillText, skillNames: skillNames, prompt: prompt, registry: registry,
    hasSmall: hasSmall, runSmall: runSmall,
    importFiles: importFiles, installMarket: installMarket, exportFiles: exportFiles, exportKind: exportKind, exportOne: exportOne, exportPrompt: exportPrompt, packText: packText, describe: describe, addPromptItem: addPromptItem, delPkg: delPkg };
})();

/* v0.4.0c：本轮勾选（「/」面板）—— 把选中的扩展真正接进请求：
   工具白名单、技能清单、子智能体白名单、提示词全文、MCP 登记，全部经 EXT.registry() 出，
   勾了就生效，没勾就是默认行为。 */
