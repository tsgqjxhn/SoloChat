function holdBusy(d, sid){
  if (sid){ S.pendBy = S.pendBy || {}; S.pendBy[sid] = Math.max(0, (S.pendBy[sid] || 0) + d); } // v0.3.18：按会话记 busy
    S.pend = Math.max(0, (S.pend || 0) + d);
    if (S.pend > 0){ if (!S.sending) setSending(true); }
    else if (!Object.keys(S.streams || {}).length) setSending(false);
  }
  function renderChips(){
    $chips.textContent = '';
    for (var i = 0; i < S.pendAtts.length; i++){
      (function(a){
        var chip;
        if (a.isText || a.isDoc){
          chip = el('div', { class: 'chip txt', title: a.name }, [
            el('span', { class: 't', text: a.name + ' · ' + sizeFmt(a.size) }),
            el('button', { 'data-act': 'rmchip', 'data-id': a.id, title: '移除' }, [icon('close')])
          ]);
        } else {
          /* v1.1.5：图片附件缩略图必须用 .chip（52×52，object-fit:cover）。
             之前误用了 .sc-chip（状态小标签的样式），没有任何尺寸约束，
             一张 1690×2250 的手机照片会按原图撑开，把输入框顶出屏幕、看起来像被遮罩锁死。 */
          chip = el('div', { class: 'chip', title: a.name }, [
            el('img', { src: a.url, alt: a.name }),
            el('button', { 'data-act': 'rmchip', 'data-id': a.id, title: '移除' }, [icon('close')])
          ]);
        }
        $chips.appendChild(chip);
      })(S.pendAtts[i]);
    }
    if (typeof notifyQuickState === 'function') notifyQuickState(); // 小窗附件计数回显
    renderCtxRing(); // v2.9：附件变化实时更新上下文估算
  }
      /* 空态：问好+logo+建议（v2.8：未开始会话前，模式选择与「临时会话」开关都在主页） */
  /* v2.9：主页提问建议池——每次新草稿随机挑 4 条，不再固定「写信」 */
  var CHAT_SUGS = [
    '把这段中文润色成更专业的邮件',
    '用 Python 写个批量重命名文件的脚本',
    'WebSocket 和 SSE 到底有什么区别？',
    '帮我排一份三天的杭州行程',
    '这个报错怎么修：Cannot read properties of undefined',
    '用大白话讲讲向量数据库是干什么的',
    '把这段会议记录整理成待办清单',
    '写条 SQL：最近 7 天各渠道的订单量和金额',
    '帮我读一下这份 PDF，提炼 5 条要点',
    '给这段代码补上单元测试',
    '解释一下 TCP 三次握手为什么不是两次',
    '帮我把这句话改成面向非技术同事的说法'
  ];
  function pickSugs(n){
    if (!S.sugSeed) S.sugSeed = (Math.random() * 2147483647) | 0;
    var seed = S.sugSeed, pool = CHAT_SUGS.slice(), out = [];
    for (var k = 0; k < n && pool.length; k++){
      seed = (seed * 1103515245 + 12345) % 2147483648;
      out.push(pool.splice(seed % pool.length, 1)[0]);
    }
    return out;
  }
  function updateEmpty(){
    var draft = !S.msgs.length;
    $empty.classList.toggle('show', draft);
    document.body.classList.toggle('empty-open', draft);
    if (!draft) return;
    /* v2.9.2：草稿态可能带着上一轮滚动位置进来（Chat 首次渲染时 scrollTop=84），
       会让空态与固定模式条错位；渲染空态前先把滚动位置归零。非空会话不受影响 */
    try { if ($scroll) $scroll.scrollTop = 0; } catch(e){}
    setTimeout(function(){ try { if (!S.msgs.length && $scroll) $scroll.scrollTop = 0; } catch(e){} }, 0);
    var cs = curSession();
    var ws = (cs && cs.workspace) || (!cs ? S.pendWs : '');
    $empty.textContent = '';
    /* 右上角：临时会话开关（不写历史、退出即清空） */
    $empty.appendChild(el('button', {
      class: 'e-temp' + (S.tempMode ? ' on' : ''), id: 'btn-temp', type: 'button',
      title: S.tempMode ? '临时会话已开启：不写入历史，关闭/新建即清空。点击关闭' : '临时会话：本次对话不写入历史，关闭或新建即清空',
      'aria-pressed': S.tempMode ? 'true' : 'false'
    }, [icon('temp'), S.tempMode ? '临时会话 · 开' : '临时会话']));
    /* v2.9.1：图标 + 标题 + 模式选择放进 .e-core（唯一参与居中的部分）；
       各模式下侧内容放进绝对定位的 .e-extra —— 切模式时模式选择组件坐标不变 */
    var wrap = el('div', { class: 'e-wrap' });
    var core = el('div', { class: 'e-core' });
    var extra = el('div', { class: 'e-extra' });
    wrap.appendChild(core); wrap.appendChild(extra);
    $empty.appendChild(wrap);
    /* v0.4.10：模式切换恢复空态原位置（Plan/Write/Free 在输入框内部） */
    var modes = el('div', { class: 'e-modes e-modes-fixed' });
    var seg = el('div', { class: 'seg seg-sm', id: 'seg-mode',
      title: '模式：Chat 常规对话 / Work 沙箱任务（产物进工作区，长任务也可连续执行）/ Agent 真实文件工具 / Soul 长期记忆与人格' });
    [['chat', 'Chat', 'i-logo', 1], ['work', 'Work', 'i-work', 0], ['agent', 'Agent', 'i-agent', 1], ['soul', 'Soul', 'i-user', 1]].forEach(function(t){
      var b = el('button', { type: 'button', 'data-mode': t[0] });
      b.appendChild(icon(t[2], 'seg-ic' + (t[3] ? ' fill' : '')));
      b.appendChild(document.createTextNode(t[1]));
      if ((S.cfg.mode || 'chat') === t[0] && !S.cfg.persona) b.classList.add('on');
      seg.appendChild(b);
    });
    modes.appendChild(seg);
    $empty.appendChild(modes);
    if (MODE && MODE.mountUI) MODE.mountUI();
    function bigIcon(name, fill){
      var ic = icon(name, fill ? 'fill' : '');
      ic.setAttribute('style', 'width:76px;height:76px;color:var(--primary)');
      return ic;
    }
    if (S.cfg.mode === 'soul'){ // Soul：以「人」为中心 —— 脸 + 名字 + 自主记忆
      var _sp = (window.SOUL && SOUL.profile) ? SOUL.profile() : null;
      var _name = (_sp && _sp.name) || 'Soul';
      var _face = (window.SOUL && SOUL.avatar) ? SOUL.avatar() : ((_sp && _sp.avatarEmoji) || '🌙');
      var av = el('div', { class: 'e-avatar', title: 'Soul 的脸（人格设置里可改）' });
      if (/^data:image\//i.test(String(_face))) av.appendChild(el('img', { src: _face, alt: _name }));
      else av.appendChild(el('span', { text: String(_face || '🌙') }));
      core.appendChild(av);
      core.appendChild(el('h1', { text: _name + '：自主 · 长期记忆 · 持续进化' }));
      core.appendChild(el('div', { class: 'soul-heart', text: '无需勾选扩展：Soul 会自动使用全部技能、工具和智能体' }));
      core.appendChild(el('div', { class: 'e-mode-desc', text: '把每次对话沉淀为长期记忆，用技能持续改进自己；所有扩展都由它自己判断调用。' }));
      extra.appendChild(el('button', {
        id: 'btn-ws', class: 'e-ws' + (ws ? ' on' : ''), type: 'button',
        title: '关联工作区文件夹（可选）：Soul 需要读文件时只能访问这里'
      }, [icon('ws'), el('span', { id: 'ws-label', text: ws ? (ws.split(/[\\/]/).filter(Boolean).pop() || ws) : '选择文件夹（可选）' })]));
      renderWsBtn();
      var spro = el('button', { class: 'btn btn-sec', type: 'button', 'data-act': 'soul-profile', text: '人格设置' });
      spro.addEventListener('click', function(){ if (window.SOUL && SOUL.openProfile) SOUL.openProfile(); else UI.toast('人格组件未加载', true); });
      var smem = el('button', { class: 'btn btn-sec', type: 'button', 'data-act': 'soul-mem', text: '编辑长期记忆（/memory）' });
      smem.addEventListener('click', function(){ if (window.SOUL) window.SOUL.open(); });
      var sevo = el('button', { class: 'btn btn-sec', type: 'button', 'data-act': 'soul-evo', text: '进化日志（/evolve log）' });
      sevo.addEventListener('click', function(){ if (window.SOUL && SOUL.openEvo) SOUL.openEvo(); else UI.toast('记忆组件未加载', true); });
      extra.appendChild(el('div', { class: 'row e-soul-row' }, [spro, smem, sevo]));
      try {
        var _hb = (window.SOUL && SOUL.heartbeat) ? SOUL.heartbeat() : null;
        if (_hb) extra.appendChild(el('div', { class: 'soul-heart', text: _name + ' · 上次聊到「' + (_hb.last || '—') + '」 · 今天 ' + _hb.turns + ' 轮 · 记忆 ' + _hb.mem + ' 条' }));
      } catch (e) {}
      return;
    }
    if (S.cfg.mode === 'agent'){ // v2.9.1：工作区选择在模式选择「下侧」
      core.appendChild(bigIcon('agent', true));
      core.appendChild(el('h1', { text: 'Agent：真实文件工具' }));
      core.appendChild(el('div', { class: 'e-mode-desc', text: '在授权文件夹里读写代码、运行命令 / Python / Git；按 Plan / Write / Free 控制执行权限。' }));
      extra.appendChild(el('button', {
        id: 'btn-ws', class: 'e-ws' + (ws ? ' on' : ''), type: 'button',
        title: '选择工作区文件夹：本次会话中 AI 只能读写该文件夹内的文件（开始后不可更改）'
      }, [icon('ws'), el('span', { id: 'ws-label', text: ws ? (ws.split(/[\\/]/).filter(Boolean).pop() || ws) : '选择文件夹' })]));
      renderWsBtn();
      return;
    }
    if (S.cfg.mode === 'work'){ // Work 空态（v2.0，v2.7 换新图标，v2.9 去掉小字；v0.4.2 支持长任务）
      core.appendChild(bigIcon('work', false));
      core.appendChild(el('h1', { text: 'Work：虚拟沙箱' }));
      core.appendChild(el('div', { class: 'e-mode-desc', text: '在内存工作区生成文件、网页、图表和脚本；长任务可连续执行，不碰真实磁盘。' }));
      /* v3.0 #17：一键脚手架，省掉让模型重造骨架的 token */
      extra.appendChild(el('div', { class: 'tpl-row' }, [
        ['static', '静态页模板'], ['spa', '单页应用模板'], ['chart', '图表页模板']
      ].map(function(t){
        var b = el('button', { type: 'button', 'data-tpl': t[0], text: t[1] });
        b.addEventListener('click', function(){ newFromTemplate(t[0]); });
        return b;
      })));
      return;
    }
    core.appendChild(bigIcon('logo', true));
    core.appendChild(el('h1', { text: 'Chat：通用推理与写作' }));
    core.appendChild(el('div', { class: 'e-mode-desc', text: '推理、解释、代码阅读与文本创作；不读写文件、不执行命令。需要工具时切到 Work / Agent。' }));
    var sugs = pickSugs(4); /* v2.9：每次新草稿随机 4 条，不再固定「写信」 */
    var srow = el('div', { class: 'e-sugs' });
    for (var i = 0; i < sugs.length; i++)
      srow.appendChild(el('button', { class: 'e-sug', 'data-act': 'sug', 'data-v': sugs[i], text: sugs[i] }));
    extra.appendChild(srow);
    var rec = recentRow(4);            /* v3.0 #22：最近会话直达 */
    if (rec) extra.appendChild(rec);
    if (!NET.isMock() && !S.cfg.baseURL)
      extra.appendChild(el('div', { class: 'row' }, [
        el('button', { class: 'btn btn-primary', 'data-act': 'cfg' }, [icon('gear'), '配置 API']),
        el('button', { class: 'btn btn-sec', 'data-act': 'mock', text: '试用演示模式' })
      ]));
  }
  /* v2.8：临时会话开关 */
  function toggleTemp(){
    S.tempMode = !S.tempMode;
    updateEmpty();
  }
  /* v2.8：清掉内存里的临时会话（离开即不留痕） */
  function dropTempSessions(exceptSid){
    for (var i = S.sessions.length - 1; i >= 0; i--){
      var s = S.sessions[i];
      if (!s.temp || s.id === exceptSid) continue;
      killStreams([s.id]);
      DB.dropTemp(s.id);
      delete S.drafts[s.id];
      S.sessions.splice(i, 1);
    }
  }

  /* 滚动（§5.1.4：距底 ≤40px 才跟随） */
  function maybeScroll(force){
    if (force || S.follow) $scroll.scrollTop = $scroll.scrollHeight;
  }
  var onScroll = throttle(function(){
    var d = $scroll.scrollHeight - $scroll.scrollTop - $scroll.clientHeight;
    S.follow = d <= 40;
    $('#btn-bottom').classList.toggle('show', !S.follow && S.msgs.length > 0);
  }, 120);

  /* 发送 / 停止 / 重试 / 编辑 */
  /* v1.4：Chat 双开 —— 同一问题同时发给两个模型，左右并排对照 */
var DUAL = (function(){
  function on(){ return !!S.cfg.dual && (S.cfg.mode || 'chat') === 'chat'; }
  function hist(){
    var k = S.sid || 'draft';
    S.dualHist = S.dualHist || {};
    if (!S.dualHist[k]) S.dualHist[k] = { a: [], b: [] };
    return S.dualHist[k];
  }
  function presets(){ return S.cfg.presets || []; }
  function presetById(id){ var ps = presets(); for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i]; return null; }
  function opts(sel){
    var out = [];
    presets().forEach(function(p){
      var ms = (p.models && p.models.length) ? p.models : (p.currentModel ? [p.currentModel] : []);
      ms.forEach(function(m){ out.push({ v: p.id + '\x01' + m, t: p.name + ' · ' + m }); });
    });
    return out;
  }
  function pick(side){
    var cur = side === 'a' ? S.cfg.dualA : S.cfg.dualB;
    var all = opts();
    if (!all.length) return '';
    for (var i = 0; i < all.length; i++) if (all[i].v === cur) return cur;
    if (all.length > 1) return all[side === 'a' ? 0 : 1].v;
    return all[0].v;
  }
  function urlOf(p){
    var u = String(p.baseURL || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    if (!/\/v\d+$/.test(u) && !/\/v\d+\//.test(u)) u += '/v1';
    return u + '/chat/completions';
  }
  function ask(ref, msgs){
    var parts = String(ref || '').split('\x01'), p = presetById(parts[0]), model = parts[1] || (p && p.currentModel);
    if (!p || !model) return Promise.reject(new Error('模型未配置'));
    var hdr = { 'Content-Type': 'application/json' };
    if (p.apiKey) hdr['Authorization'] = 'Bearer ' + p.apiKey;
    var body = { model: model, messages: msgs, stream: false, temperature: 0.7, max_tokens: 1600 };
    return NET.raw({ url: urlOf(p), method: 'POST', headers: hdr, body: JSON.stringify(body), timeout: 0 })
      .then(function(r){
        if (!r) throw new Error('无响应');
        if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status + ' ' + String(r.text || '').slice(0, 120));
        var j = JSON.parse(r.text);
        var m = j && j.choices && j.choices[0] && j.choices[0].message;
        return (m && m.content) || '(空回复)';
      });
  }
  function sysPrompt(){
    var sys = '你是 AI 助手，直接回答问题。';
    var sp = MODE.subPrompt(); if (sp) sys += '\n\n' + sp;
    return sys;
  }
  function paneNode(side){
    var box = el('div', { class: 'dl-pane' });
    var head = el('div', { class: 'dl-head' });
    head.appendChild(el('span', { class: 'dot' + (S.dualBusy ? ' on' : '') }));
    if (S.cfg.research) head.appendChild(el('span', { class: 'dl-tag', text: '深度研究' }));
    var sel = el('select', { class: 'dl-model' });
    var cur = pick(side);
    opts().forEach(function(o){ sel.appendChild(el('option', { value: o.v, text: o.t, selected: o.v === cur ? '' : null })); });
    if (!cur) sel.appendChild(el('option', { value: '', text: '（先在设置里配置模型）' }));
    sel.addEventListener('change', function(){
      var patch = side === 'a' ? { dualA: sel.value } : { dualB: sel.value };
      setCfg(patch);
      var h = hist(); h[side] = [];
      render();
    });
    head.appendChild(sel);
    box.appendChild(head);
    var body = el('div', { class: 'dl-body' });
    var list = hist()[side];
    if (!list.length) body.appendChild(el('div', { class: 'dl-empty', text: '输入一个问题，两边同时回答' }));
    list.forEach(function(m){
      if (m.role === 'user') body.appendChild(el('div', { class: 'dl-msg' }, [el('div', { class: 'dl-u', text: m.content })]));
      else {
        var a = el('div', { class: 'dl-msg dl-a' });
        a.appendChild(el('div', { class: 'who', text: '回答' }));
        var md = el('div', { class: 'md' });
        md.innerHTML = MD.render(m.content || '');
        a.appendChild(md);
        body.appendChild(a);
      }
    });
    if (S.dualBusy && S.dualPending && S.dualPending[side]){
      body.appendChild(el('div', { class: 'dl-empty', text: '生成中…' }));
    }
    box.appendChild(body);
    return box;
  }
  function render(){
    var v = $('#dual-view'); if (!v) return;
    v.textContent = '';
    v.appendChild(paneNode('a'));
    v.appendChild(paneNode('b'));
  }
  function apply(){
    document.body.classList.toggle('dual-on', !!S.cfg.dual);
    if (S.cfg.dual) render();
    var b = $('#btn-dual'); if (b) b.classList.toggle('on', !!S.cfg.dual);
  }
  function toggle(){
    if ((S.cfg.mode || 'chat') !== 'chat'){ toast('双开只用于 Chat 模式', true); return; }
    setCfg({ dual: !S.cfg.dual });
    apply();
    if (S.cfg.dual) toast('双开：同一问题同时问两个模型');
  }
  function send(text){
    var h = hist();
    h.a.push({ role: 'user', content: text });
    h.b.push({ role: 'user', content: text });
    var ra = pick('a'), rb = pick('b');
    if (!ra || !rb){ toast('双开需要两个模型，请先在设置里配置', true); return; }
    S.dualBusy = true; S.dualPending = { a: true, b: true };
    render();
    var sys = sysPrompt();
    function msgsOf(side){ return [{ role: 'system', content: sys }].concat(hist()[side]); }
    function run(side, ref){
      return ask(ref, msgsOf(side)).then(function(txt){
        hist()[side].push({ role: 'assistant', content: txt });
      }, function(err){
        hist()[side].push({ role: 'assistant', content: '⚠️ ' + (err && err.message || err) });
      }).then(function(){ S.dualPending[side] = false; render(); });
    }
    Promise.all([run('a', ra), run('b', rb)]).then(function(){
      S.dualBusy = false; S.dualPending = null; render();
    });
  }
  function init(){
    var b = $('#btn-dual');
    if (b) b.addEventListener('click', toggle);
    apply();
  }
  return { on: on, apply: apply, render: render, send: send, init: init, toggle: toggle };
})();

function sendMessage(){
    /* v1.4：双开走独立通道（非流式，两栏各自请求） */
    if (DUAL.on()){
      if (S.dualBusy) return;
      var dt = $input.value.trim();
      if (!dt) return;
      $input.value = ''; $input.style.height = '';
      DUAL.send(dt);
      return;
    }
  if (S.sending){
    if (/^\/[a-z]/i.test(String($input.value || '').trim())){ /* v0.3.38：只读命令不该被当成「再按一次=停止」 */ } else {
    var _mine = isSending(S.sid) || ((S.pendBy || {})[S.sid] > 0);
    if (!_mine){ S.pend = 0; setSending(false); } // v0.3.18：别的会话把状态卡住了，这里自愈
    else { quickPending = false; stopGeneration(); return; }
    }
  }
    var text = $input.value.trim();
    if (!text && !S.pendAtts.length){ quickPending = false; return; }
    /* S2 显式记忆：用户说「记住…」→ 直接写 MEMORY.md（仍照常发消息） */
    try {
      var _mk = /^(?:请)?(?:记住|记下|帮我记住)[:：,，\s]+([\s\S]+)$/.exec(text);
      if (_mk && window.SOUL){
        var _r = window.SOUL.remember(_mk[1]);
        UI.toast(_r && _r.ok ? _r.msg : ('未写入：' + ((_r && _r.msg) || '未知原因')), !(_r && _r.ok));
      }
    } catch (e) {}
  /* v0.3.30：斜杠命令（对标 Claude Code 的 /clear、/compact） */
  if (text.charAt(0) === '/'){
    var cmd = text.split(/\s+/)[0].toLowerCase();
    if (cmd === '/clear'){ $input.value = ''; $input.style.height = ''; UI.newDraft(); UI.toast('已新建对话'); return; }
    if (cmd === '/compact'){
      $input.value = ''; $input.style.height = '';
      var cs0 = curSession();
      if (!cs0 || !S.msgs.length){ UI.toast('当前会话没有可压缩的内容', true); return; }
      if ((S.msgs || []).length < 4){ $input.value = ''; $input.style.height = ''; UI.autosize(); UI.toast('会话太短，不需要压缩'); return; } // v0.3.70：别为两条消息白花一次模型调用
      if (S.compacting){ UI.toast('已有压缩在进行中，等它结束', true); return; } // v0.3.38
      S.compacting = true; S.compactTried = Date.now(); // v0.3.34：避免同时再触发一次自动压缩
      UI.toast('正在压缩上下文…');
      compactCtx(cs0, S.msgs.slice(), function(ok){ S.compacting = false; UI.toast(ok ? '已压缩（不再发送历史全文）' : '压缩失败，保持原样', !ok); });
      return;
    }
    if (cmd === '/help'){ $input.value = ''; $input.style.height = ''; UI.autosize(); UI.toast('/clear 新建对话 · /compact 压缩当前上下文 · /model <id> 切换模型 · /rewind 撤销编辑重发'); return; }
    if (cmd === '/limits'){ /* v0.3.87：看自主执行的边界（对标 AutoGPT 的运行上限） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _l7 = [];
      try { _l7.push('工具轮次 ' + (LIMITS.FS_MAX_TURNS > 0 ? LIMITS.FS_MAX_TURNS : '不限')); } catch (e) {}
      try { _l7.push('Work 轮次 ' + (LIMITS.WORK_MAX_TURNS > 0 ? LIMITS.WORK_MAX_TURNS : '不限')); } catch (e) {}
      try { _l7.push('同型错误 ' + (LIMITS.WORK_SAME_ERR > 0 ? LIMITS.WORK_SAME_ERR : '不限')); } catch (e) {}
      try { _l7.push('子智能体层级 ' + SUB.MAX_DEPTH); } catch (e) {}
      if (!_l7.length){ UI.toast('读不到限制常量', true); return; }
      UI.toast('自主执行边界：' + _l7.join(' · '));
      return;
    }
    if (cmd === '/cron'){ /* S6：定时任务 */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _cr = text.slice(5).trim();
      if (!window.SOUL){ UI.toast('记忆组件未加载', true); return; }
      if (!_cr || _cr === 'list'){
        var _cl = window.SOUL.cronList();
        UI.toast(_cl.length ? ('定时任务 ' + _cl.length + ' 条：' + _cl.map(function(t){ return t.at + ' ' + t.prompt.slice(0, 20) + '（' + t.id + '）'; }).join('；'))
          : '没有定时任务。用法：/cron add 09:00 每日简报');
        return;
      }
      if (_cr.indexOf('add ') === 0){
        var _m = /^add\s+(\S+)\s+([\s\S]+)$/.exec(_cr);
        if (!_m){ UI.toast('用法：/cron add 09:00 每日简报', true); return; }
        var _r = window.SOUL.cronAdd(_m[1], _m[2]);
        UI.toast(_r.ok ? ('已添加：每天 ' + _m[1] + '（' + _r.id + '）') : _r.msg, !_r.ok);
        return;
      }
      if (_cr.indexOf('del ') === 0){
        var _n = window.SOUL.cronDel(_cr.slice(4).trim());
        UI.toast(_n ? '已删除' : '没有这个任务号', !_n);
        return;
      }
      UI.toast('用法：/cron add 09:00 内容 / /cron list / /cron del 任务号', true);
      return;
    }
    if (cmd === '/learn'){ /* S5：把这次会话沉淀成技能草稿 */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _nm = text.slice(6).trim();
      var _ms = (S.msgs || []).filter(function(m){ return m.role === 'user' || m.role === 'assistant'; });
      if (_ms.length < 2){ UI.toast('先聊一轮再 /learn', true); return; }
      var _first = ''; for (var _i = 0; _i < _ms.length; _i++){ if (_ms[_i].role === 'user'){ _first = String(_ms[_i].content || ''); break; } }
      var _steps = [], _pits = [], _vers = [];
      _ms.forEach(function(m){
        if (m.role !== 'assistant') return;
        String(m.content || '').split('\n').forEach(function(l){
          var s = l.trim();
          if (!s) return;
          if (/^(\d+[.、)]|[-*])\s+/.test(s) && _steps.length < 14) _steps.push(s.replace(/^(\d+[.、)]|[-*])\s+/, ''));
          if (/(注意|坑|失败|错误|不要|否则|谨慎)/.test(s) && _pits.length < 6) _pits.push(s.slice(0, 160));
          if (/(验证|检查|确认|测试)/.test(s) && _vers.length < 4) _vers.push(s.slice(0, 160));
        });
      });
      if (!_steps.length) _steps = ['按本次对话的步骤复现（模型未给出编号步骤）'];
      var _slug = (_nm || ('skill-' + new Date().toISOString().slice(0, 10))).replace(/\s+/g, '-').slice(0, 40);
      var _md = '# ' + _slug + '\n\n## 何时用\n' + _first.slice(0, 200) + '\n\n## 步骤\n' + _steps.map(function(s, i){ return (i + 1) + '. ' + s; }).join('\n')
        + '\n\n## 坑\n' + (_pits.length ? _pits.map(function(s){ return '- ' + s; }).join('\n') : '- （本次未记录）')
        + '\n\n## 验证\n' + (_vers.length ? _vers.map(function(s){ return '- ' + s; }).join('\n') : '- 复跑一次，确认步骤可重复');
      try {
        EXT.add({ kind: 'skill', name: _slug, title: _slug, desc: '由 /learn 从本次会话生成（草稿）', body: _md });
        UI.toast('已生成技能草稿：' + _slug + '（/skills 可查看）');
      } catch (e) { UI.toast('生成失败：' + (e && e.message || e), true); }
      return;
    }
    if (cmd === '/skills'){ /* S5：列出技能 */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _skl = [];
      try { _skl = EXT.registry().filter(function(x){ return x.kind === 'skill'; }).map(function(x){ return x.name; }); } catch (e) {}
      UI.toast(_skl.length ? ('技能 ' + _skl.length + ' 个：' + _skl.join('、')) : '还没有技能，完成任务后 /learn 生成');
      return;
    }
    if (cmd === '/skill-drop'){ /* S5：删除技能 */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _dn = text.slice(11).trim();
      if (!_dn){ UI.toast('用法：/skill-drop 技能名', true); return; }
      try { EXT.del(_dn); UI.toast('已删除技能：' + _dn); } catch (e) { UI.toast('删除失败：' + (e && e.message || e), true); }
      return;
    }
    if (cmd === '/dream'){ /* S4：巩固记忆 */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      if (!window.SOUL){ UI.toast('记忆组件未加载', true); return; }
      var _da = text.slice(6).trim();
      if (_da.indexOf('auto') === 0){
        var _off = /off|关/.test(_da);
        try { localStorage.setItem('sc.soul.autoDream', _off ? '0' : '1'); } catch (e) {}
        UI.toast(_off ? '已关闭每日自动巩固' : '已开启每日自动巩固（每天首次启动最多一次）');
        return;
      }
      UI.toast('正在巩固最近 7 天对话…');
      window.SOUL.dream().then(function(r){ UI.toast('巩固完成：新增/更新 ' + r.added + ' 条'); })
        .catch(function(e){ UI.toast('巩固失败：' + (e && e.message || e), true); });
      return;
    }
    if (cmd === '/dreams'){ /* S4：查看巩固记录 */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      if (window.SOUL && window.SOUL.openDreams) window.SOUL.openDreams(); else UI.toast('记忆组件未加载', true);
      return;
    }
    if (cmd === '/evolve'){ /* v0.4.1：持续进化（手动/开关/日志） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      if (!window.SOUL || !SOUL.evolve){ UI.toast('记忆组件未加载', true); return; }
      var _ea = text.slice(7).trim().toLowerCase();
      if (_ea === 'on' || _ea === 'off'){
        SOUL.evoOn(_ea === 'on');
        UI.toast(_ea === 'on' ? '已开启自动进化（每 6 轮一次）' : '已关闭自动进化（仍可 /evolve 手动执行）');
        return;
      }
      if (_ea === 'log'){
        if (SOUL.openEvo) SOUL.openEvo(); else UI.toast('进化日志组件未加载', true);
        return;
      }
      UI.toast('正在进化…');
      SOUL.evolve(true).then(function(r){
        if (r && r.ok){
          UI.toast('进化完成：记忆 +' + r.mem + (r.skill ? ' · 技能 ' + r.skill : '') + (r.note ? ' · ' + r.note : ''));
        } else {
          UI.toast('未执行：' + ((r && r.reason) || '未知原因'), true);
        }
      });
      return;
    }
    if (cmd === '/rollback'){ /* S4：回滚上一次巩固 */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _rb = window.SOUL ? window.SOUL.rollback() : false;
      UI.toast(_rb ? '已回滚到上一次巩固前的 MEMORY' : '没有可回滚的快照', !_rb);
      return;
    }
    if (cmd === '/forget'){ /* Soul S2：按关键词删记忆 */
      var _fk = text.slice(7).trim();
      $input.value = ''; $input.style.height = ''; UI.autosize();
      if (!_fk){ UI.toast('用法：/forget 关键词', true); return; }
      var _n = window.SOUL ? window.SOUL.forget(_fk) : 0;
      UI.toast(_n ? ('已删除 ' + _n + ' 条相关记忆') : '没有匹配的记忆', !_n);
      return;
    }
    if (cmd === '/memory'){ /* Soul S1：编辑长期记忆 */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      if (window.SOUL) window.SOUL.open(); else UI.toast('记忆组件未加载', true);
      return;
    }
    if (cmd === '/canvas'){ /* C5：把最后一条回答放进画布 */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      if (window.CANVAS) window.CANVAS.openLast(); return;
    }
    if (cmd === '/rewind'){ /* C6：撤销编辑重发造成的截断（2 分钟内） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      doRewind(); return;
    }
    if (cmd === '/undo'){ /* v0.3.86：撤销最近一次写入（对标 Aider 的 /undo） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _nb = null, _ns = document.querySelectorAll('#msg-list .msg');
      for (var _i6 = _ns.length - 1; _i6 >= 0 && !_nb; _i6--){
        var _bs3 = _ns[_i6].querySelectorAll('button');
        for (var _j6 = 0; _j6 < _bs3.length; _j6++){ if (/撤销/.test(_bs3[_j6].textContent || '')){ _nb = _bs3[_j6]; break; } }
      }
      if (!_nb){ UI.toast('没有可撤销的写入', true); return; }
      _nb.click(); UI.toast('已撤销最近一次写入');
      return;
    }
    if (cmd === '/perm'){ /* v0.4.7：Plan 只读 / Write 命令确认 / Free 免确认 */
      var _pv = text.slice(5).trim().toLowerCase();
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _okv = ['plan', 'write', 'free', 'ask', 'auto', 'readonly'];
      if (_okv.indexOf(_pv) < 0){ UI.toast('用法：/perm plan|write|free（当前 ' + permNow() + '）', true); return; }
      setPerm(_pv); renderComposerCtl();
      UI.toast('执行权限已设为 ' + ({ plan: 'Plan 只读', write: 'Write 命令确认', free: 'Free 免确认' })[normPerm(_pv)]);
      return;
    }
    if (cmd === '/status'){ /* v0.3.84：当前会话/工作区/权限状态（对标 Devin 的会话状态栏） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _cs9 = curSession();
      var _ws9 = (_cs9 && _cs9.workspace) || '未绑定';
      UI.toast('模式 ' + (S.cfg.mode || 'chat') + ' · 权限 ' + permNow() + ' · 工作区 ' + _ws9 + ' · ' + ((S.msgs || []).length) + ' 条消息 · ' + (S.cfg.currentModel || '未选模型'));
      return;
    }
    if (cmd === '/tree'){ /* v0.3.83：产物清单带体积（对标 Airtable 的文件视图） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      if (!S.sid){ UI.toast('先开始一个会话', true); return; }
      DB.workfsBySid(S.sid).then(function(fs8){
        if (!fs8 || !fs8.length){ UI.toast('沙箱里还没有文件', true); return; }
        var rows8 = fs8.slice().sort(function(a, b){ return String(a.path) < String(b.path) ? -1 : 1; });
        var txt8 = rows8.slice(0, 5).map(function(f){ return f.path + '(' + sizeFmt(String(f.content || '').length) + ')'; }).join(', ');
        UI.toast('沙箱 ' + fs8.length + ' 个文件：' + txt8 + (fs8.length > 5 ? ' …' : ''));
      });
      return;
    }
    if (cmd === '/find'){ /* v0.3.82：在沙箱产物里全文搜索（对标 Webflow 的全站搜索） */
      var _q7 = text.slice(5).trim();
      $input.value = ''; $input.style.height = ''; UI.autosize();
      if (!_q7){ UI.toast('用法：/find 关键词', true); return; }
      if (!S.sid){ UI.toast('先开始一个会话', true); return; }
      DB.workfsBySid(S.sid).then(function(fs7){
        if (!fs7 || !fs7.length){ UI.toast('沙箱里还没有文件', true); return; }
        var hits = [];
        fs7.forEach(function(f){
          var c7 = String(f.content || ''), low = c7.toLowerCase(), q7 = _q7.toLowerCase(), n7 = 0, at7 = low.indexOf(q7);
          while (at7 >= 0 && n7 < 99){ n7++; at7 = low.indexOf(q7, at7 + q7.length); }
          if (n7) hits.push(f.path + '×' + n7);
        });
        if (!hits.length){ UI.toast('没找到「' + _q7 + '」'); return; }
        UI.toast('命中 ' + hits.length + ' 个文件：' + hits.slice(0, 4).join(', ') + (hits.length > 4 ? ' …' : ''));
      });
      return;
    }
    if (cmd === '/check'){ /* v0.3.81：产物自检——index.html 引用的本地文件是否存在（对标 Figma AI 的交付前检查） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      if (!S.sid){ UI.toast('先开始一个会话', true); return; }
      DB.workfsBySid(S.sid).then(function(fs6){
        if (!fs6 || !fs6.length){ UI.toast('沙箱里还没有文件', true); return; }
        var names = {}; fs6.forEach(function(f){ names[f.path.replace(/^\.\//, '')] = 1; });
        var miss = [];
        fs6.forEach(function(f){
          var c6 = String(f.content || '');
          var re6 = /(?:src|href)=["'](?!#|https?:|data:)([^"']+)["']/g, m6;
          while ((m6 = re6.exec(c6))){
            var p6 = String(m6[1]).replace(/^\.\//, '');
            if (!names[p6] && miss.indexOf(p6) < 0) miss.push(p6);
          }
        });
        if (!miss.length){ UI.toast('自检通过：' + fs6.length + ' 个文件，没有缺失引用'); return; }
        UI.toast('缺 ' + miss.length + ' 个引用：' + miss.slice(0, 4).join(', ') + (miss.length > 4 ? ' …' : ''), true);
      });
      return;
    }
    if (cmd === '/presets'){ /* v0.3.80：看预设与当前用的是哪个（对标 Le Chat 的自定义助手） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _pl = (S.cfg.presets || []).slice();
      if (!_pl.length){ UI.toast('还没有预设，去设置里添加', true); return; }
      var _cur = null; for (var _i5 = 0; _i5 < _pl.length; _i5++) if (_pl[_i5].id === S.cfg.activePreset) _cur = _pl[_i5];
      var _nm5 = _pl.slice(0, 5).map(function(p){ return p.name || p.id; }).join(', ');
      UI.toast('预设 ' + _pl.length + ' 个：' + _nm5 + (_pl.length > 5 ? ' …' : '') + ' · 当前 ' + (_cur ? (_cur.name || _cur.id) : '未选'));
      return;
    }
    if (cmd === '/retry'){ /* v0.3.79：重试最后一条回答（对标 Kimi/Le Chat 的重答） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _nodes = document.querySelectorAll('#msg-list .msg');
      var _btn4 = null;
      for (var _i4 = _nodes.length - 1; _i4 >= 0; _i4--){
        var _bs2 = _nodes[_i4].querySelectorAll('button');
        for (var _j4 = 0; _j4 < _bs2.length; _j4++){ if (/重新生成/.test(_bs2[_j4].textContent || '')){ _btn4 = _bs2[_j4]; break; } }
        if (_btn4) break;
      }
      if (!_btn4){ UI.toast('没有可重试的回答', true); return; }
      if (S.sending){ UI.toast('正在生成，稍后再试', true); return; }
      _btn4.click(); UI.toast('已重试最后一条回答');
      return;
    }
    if (cmd === '/models'){ /* v0.3.78：看模型池与当前模型（对标 Copilot 的模型选择） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _mp = (S.cfg.models || []).slice();
      if (!_mp.length){ UI.toast('模型池是空的，去设置里添加', true); return; }
      UI.toast('模型池 ' + _mp.length + ' 个：' + _mp.slice(0, 5).join(', ') + (_mp.length > 5 ? ' …' : '') + ' · 当前 ' + (S.cfg.currentModel || '未选'));
      return;
    }
    if (cmd === '/skills'){ /* v0.3.77：看当前模式可用的技能（对标 OpenHands 的技能清单） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _sk = []; try { _sk = EXT.skillNames(S.cfg.mode) || []; } catch (e) { _sk = []; }
      var _sk = ({ chat: ['ask', 'web', 'search'], work: ['vfs-write', 'vfs-list', 'vfs-read', 'vfs-grep', 'vfs-stat', 'run', 'preview', 'web', 'crawl', 'search', 'browser-read', 'browser-act', 'ask'], agent: ['fs-read', 'fs-list', 'fs-write', 'fs-edit', 'cmd', 'git', 'python', 'browser', 'browser-read', 'browser-act', 'web', 'search', 'sub', 'agent'], soul: ['fs-read', 'fs-list', 'fs-write', 'fs-edit', 'grep', 'glob', 'vfs-read', 'vfs-grep', 'vfs-stat', 'cmd', 'git', 'python', 'browser', 'browser-read', 'browser-act', 'web', 'search'] })[S.cfg.mode || 'chat'] || []; // v0.3.77：技能库可能为空，改成列「本模式可用的内置工具围栏」
      if (!_sk.length){ UI.toast('当前模式没有可用工具', true); return; }
      UI.toast('本模式可用工具 ' + _sk.length + ' 个：' + _sk.join(', ') + '（用三反引号 + 工具名调用）');
    }
    if (cmd === '/templates'){ /* v0.3.76：看 Work 模板（对标 Canva 的模板库） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _tk = []; try { _tk = Object.keys(TPL || {}); } catch (e) { _tk = []; }
      if (!_tk.length){ UI.toast('没有可用模板', true); return; }
      UI.toast('Work 模板 ' + _tk.length + ' 个：' + _tk.join(', ') + '（在主页模板区点选）');
      return;
    }
    if (cmd === '/agents'){ /* v0.3.75：看当前模式有哪些子智能体可派（对标 Manus/OpenHands 的 agent 名册） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _ps = [];
      try { _ps = SUB.profiles(S.cfg.mode) || []; } catch (e) { _ps = []; }
      if (!_ps.length){ UI.toast('当前模式没有可用的子智能体', true); return; }
      var _nm = _ps.slice(0, 6).map(function(p){ return p.name; }).join(', ');
      UI.toast('可用子智能体 ' + _ps.length + ' 个：' + _nm + (_ps.length > 6 ? ' …' : '') + '（用 ```agent 名字 派活）');
      return;
    }
    if (cmd === '/doc'){ /* v0.3.74：会话 + 产物清单导出成一份文档（对标 Notion AI） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _cs3 = curSession();
      if (!_cs3 || !(S.msgs || []).length){ UI.toast('当前会话没有内容', true); return; }
      var _md3 = chatToMarkdown(S.msgs, _cs3);
      DB.workfsBySid(S.sid).then(function(fsx){
        if (fsx && fsx.length){
          _md3 += '\n## 附件（沙箱工作区）\n\n';
          fsx.forEach(function(f){ _md3 += '- `' + f.path + '`（' + String(f.content || '').length + ' B）\n'; });
        }
        UI.download('solochat-doc-' + new Date().toISOString().slice(0, 10) + '.md', _md3, 'text/markdown');
        UI.toast('已导出文档（' + S.msgs.length + ' 条消息' + (fsx && fsx.length ? ' + ' + fsx.length + ' 个附件' : '') + '）');
      });
      return;
    }
    if (cmd === '/stats'){ /* v0.3.73：会话用量概览（对标 Gemini 的上下文用量） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _ms2 = S.msgs || [], _tok2 = 0, _u2 = 0, _ch2 = 0;
      for (var _i3 = 0; _i3 < _ms2.length; _i3++){ _tok2 += (_ms2[_i3].tokens || 0); if (_ms2[_i3].role === 'user') _u2++; else if (_ms2[_i3].role === 'assistant') _ch2++; }
      UI.toast('本条会话：' + _ms2.length + ' 条消息（你 ' + _u2 + ' / 助手 ' + _ch2 + '）· 累计 ' + (_tok2 || '?') + ' tokens · ' + (S.cfg.currentModel || '未选模型'));
      return;
    }
    if (cmd === '/zip'){ /* v0.3.72：一键把沙箱产物打包下载（对标 v0.dev 的下载产物） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      try { UI.zipVfs(); } catch (e) { UI.toast('打包失败：' + (e && e.message || e), true); }
      return;
    }
    if (cmd === '/changes'){ /* v0.3.71：本次会话改过哪些文件（对标 Windsurf 的变更清单） */
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var _src = (typeof SC_SNAPS !== 'undefined' && SC_SNAPS) ? SC_SNAPS : null;
      var _keys = _src ? Object.keys(_src) : [];
      var _mine2 = [];
      for (var _k2 = 0; _k2 < _keys.length; _k2++){
        var _p3 = _keys[_k2].split('|');
        if (_p3[0] === S.sid && _p3.length >= 3){ var _pp = _p3.slice(2).join('|'); if (_mine2.indexOf(_pp) < 0) _mine2.push(_pp); }
      }
      if (!_mine2.length){ UI.toast('本次会话还没有改过文件（改了才会出现在这里）'); return; }
      UI.toast('本次改过 ' + _mine2.length + ' 个文件：' + _mine2.slice(0, 4).join(', ') + (_mine2.length > 4 ? ' …' : ''));
      return;
    }
    if (cmd === '/files'){
      $input.value = ''; $input.style.height = ''; UI.autosize();
      if (!S.sid){ UI.toast('先开始一个会话', true); return; }
      if (String(S.cfg.mode) === 'agent'){ UI.toast('Agent 模式用的是真实文件夹，请用右侧「工作区」面板查看', true); return; } // v0.3.69：/files 只管沙箱，别让 Agent 用户以为坏了
      DB.workfsBySid(S.sid).then(function(fs){
        if (!fs.length){ UI.toast('沙箱工作区还没有文件'); return; }
        var t = 0; fs.forEach(function(f){ t += String(f.content || '').length; });
        UI.toast('沙箱：' + fs.length + ' 个文件 · ' + sizeFmt(t) + ' · ' + fs.slice(0, 3).map(function(f){ return f.path; }).join(', ') + (fs.length > 3 ? ' …' : ''));
      });
      return;
    } // v0.3.51：/files 看沙箱产物（对标 Replit 的文件概览）
    if (cmd === '/title'){
      var nt = text.slice(6).trim();
      var csy = curSession();
      if (!nt){ UI.toast('用法：/title 新名字'); return; }
      if (!csy){ UI.toast('当前没有会话', true); return; }
      $input.value = ''; $input.style.height = ''; UI.autosize();
      csy.title = nt.slice(0, 80); csy.updatedAt = Date.now();
      try { DB.putSession(csy); } catch (e) {}
      try { UI.renderSessions(); } catch (e) {}
      UI.toast('已重命名：' + csy.title);
      return;
    }
    if (cmd === '/export'){
      $input.value = ''; $input.style.height = ''; UI.autosize();
      var csx = curSession(); var allm = csx && csx.id === S.sid ? S.msgs : [];
      if (!allm.length){ UI.toast('当前会话没有可导出的消息', true); return; }
      var md = chatToMarkdown(allm, csx);
      UI.download('solochat-' + new Date().toISOString().slice(0, 10) + '.md', md, 'text/markdown');
      UI.toast('已导出 Markdown（' + allm.length + ' 条）');
      return;
    }
    if (cmd === '/model'){
      var want = text.split(/\s+/).slice(1).join(' ').trim();
      var pool = (S.cfg.models || []).slice();
      if (!want){ UI.toast('当前模型：' + (S.cfg.currentModel || '未选择') + (pool.length ? ' · 可选：' + pool.slice(0, 6).join(', ') : '')); return; }
      $input.value = ''; $input.style.height = ''; UI.autosize();
      /* v0.4.x：setCfg 已统一把连接字段同步进当前预置（P0），删掉原先手改预置的重复补丁 */
      var isNew = pool.indexOf(want) < 0;
      if (isNew) pool.push(want);
      setCfg({ models: pool, currentModel: want });
      try { UI.applyCtx(); } catch (e) {}
      try { UI.renderPool(); UI.renderComposerCtl(); } catch (e) {}
      UI.toast((isNew ? '已加入模型池并切换：' : '已切换模型：') + want);
      return;
      return;
    }
    if (/^\/[a-z][a-z0-9-]*$/i.test(text)){ $input.value = ''; $input.style.height = ''; UI.autosize(); UI.toast('未知命令：' + text + '（可用 /clear /compact /model /export /help）', true); return; } // v0.3.37：认不出的斜杠命令给出提示，而不是当成消息发出去
  }
    if (!NET.isMock() && !S.cfg.baseURL){ quickPending = false; openSettings(); toast('请先配置 Base URL，或填入 mock 试用', true); return; }
    if (!NET.isMock() && !S.cfg.currentModel){ quickPending = false; toast('请先在「设置 → 连接与模型」中选择模型', true); return; }
    var sendAt = nowMs(); // v2.9：从点击发送开始计时（含附件导入/联网搜索等准备）

    /* Chat 不执行工具：本轮勾了工具/插件就显式切到 Work，让扩展围栏真正运行 */
    if ((S.cfg.mode || 'chat') === 'chat' && typeof PICK !== 'undefined' && PICK.restrict()) {
      setCfg({ mode: 'work' });
      try { renderComposerCtl(); } catch (e) {}
      UI.toast('Chat 不执行工具，已切到 Work 来运行本轮勾选的工具');
    }
    var s = curSession() || createSession();
    if (quickPending){ quickPending = false; qa = { sid: s.id, last: 0 }; } // 快速条：建会话后补齐同步标记，小窗直接收流式回复
    FS.reset(); // 新一轮用户输入：工具轮次与取消标志复位（v1.1）
  S._fixN = S._fixN || {}; S._fixN[S.sid] = 0; // v1.17：自修计数复位
    WORK.reset(); // Work 循环同款复位（v2.0）
    /* 附件先落 IDB，拿到 aid 列表 */
    var atts = S.pendAtts;
    var aids = [], attsData = {}, attsText = {};
    /* v1.1.20：把本轮文本附件的内容一起写进消息，后续追问仍能随历史发回模型 */
    var fileTexts = atts.filter(function(a){ return a.isText && a.text; }).map(function(a){
      return { id: a.id, name: a.name, text: a.text + (a.truncated ? '\n\n…（超长已截断）' : '') };
    });
    /* v1.1.21：附件引用（不含 blob），导入工作区/系统提示清单用 */
    var fileRefs = atts.map(function(a){
      var ext = extOf(a.name);
      var mime = a.origMime || (a.blob && a.blob.type) || '';
      var kind = (a.doc || DOC_EXT[ext]) ? '文档提取文本'
        : (a.isText ? '文本'
        : (/^image\//.test(mime) ? '图片' : '文件'));
      /* 文本附件标记为 external：工作区只存外部引用，不复制全文；旧 refs 无此字段时触发迁移 */
      return { id: a.id, name: a.name, mime: mime, size: a.origSize || (a.blob && a.blob.size) || a.size || 0, kind: kind, external: !!a.isText };
    });
    var userMsg = {
      id: uuid(), sid: s.id, role: 'user', content: text.slice(0, LIMITS.MSG_TEXT),
      status: 'ok', ts: Date.now(), attachments: [], fileTexts: fileTexts, fileRefs: fileRefs
    };
    if (S._hideNext){ userMsg.hidden = true; S._hideNext = 0; } // v0.4.1：提问卡的回答不单独占一条气泡
    var chain = Promise.resolve();
    atts.forEach(function(a){
      aids.push(a.id);
      chain = chain.then(function(){
        return DB.putAttachment({
          id: a.id, sid: s.id, name: a.name,
          mime: a.isDoc ? 'application/pdf' : (a.isText ? 'text/plain' : 'image/jpeg'),
          size: a.blob.size, w: a.w || null, h: a.h || null, blob: a.blob,
          /* v1.1.22：图片原图另存，工作区下载原文件；blob 仍是压缩图，用于发送 */
          rawBlob: a.rawBlob || null, origSize: a.origSize || 0, origMime: a.origMime || '',
          /* v1.1.20：解析文本随附件落库；老记录没有 text 时由 textsForMsg 重新解析 */
          text: a.text || '', doc: !!a.doc
        });
      });
    });
    userMsg.attachments = aids;
    chain = chain.then(function(){
      /* base64 仅发送瞬间存在（§5.2.6） */
      var imgAtts = atts.filter(function(a){ return !a.isText && !a.isDoc; });
      var txtAtts = atts.filter(function(a){ return a.isText && !a.isDoc; });
      var docAtts = atts.filter(function(a){ return a.isDoc; });
      var p1 = (imgAtts.length || docAtts.length)
        ? Promise.all([
            imgAtts.length ? Promise.all(imgAtts.map(function(a){ return blobToDataURL(a.blob); })) : Promise.resolve([]),
            docAtts.length ? Promise.all(docAtts.map(function(a){
              return blobToDataURL(a.blob).then(function(u){ return { kind: 'doc', name: a.name, url: u }; });
            })) : Promise.resolve([])
          ]).then(function(r){
            var all = (r[0] || []).concat(r[1] || []);
            if (all.length) attsData[userMsg.id] = all;
          })
        : null;
      if (txtAtts.length)
        attsText[userMsg.id] = txtAtts.map(function(a){
          return { name: a.name, text: a.text + (a.truncated ? '\n\n…（超长已截断）' : '') };
        });
      /* v1.1.21：先把附件写进工作区（Work=VFS / Agent=真实目录），再发请求；
         这样模型第一轮就能用 vfs-list / fs-list 看到附件，而不是只靠附件文本注入。 */
      return (p1 || Promise.resolve()).then(function(){
        return importAttachmentsToWorkspace(s.id, fileRefs, fileTexts);
      });
    }).then(function(){
      atts.forEach(function(a){ if (a.url) URL.revokeObjectURL(a.url); });
      S.pendAtts = [];
      renderChips();
      S.msgs.push(userMsg);
      DB.putMessage(userMsg);
      if (!userMsg.hidden) $('#msg-list').appendChild(msgNode(userMsg));
      updateEmpty(); // v2.8：首条消息 → 收起主页，并把模式选择挪回顶栏
      S.follow = true; // v2.1：用户主动发送 → 恢复跟随（此前若上翻过则不再自动跟随）
      /* 清空输入（原稿另存草稿）——发送成功后草稿即清空 */
      $input.value = ''; delete S.drafts[S.sid]; autosize();
      touchSession(text);
      maybeScroll(true);
      var go = function(block, meta){ startStream(attsData, attsText, block, meta, sendAt); attsData = null; attsText = null; };
      if (S.cfg.webSearch && !NET.isMock()){
        /* 开关开着但提供商/Key/地址没配好：不假装联网，明确提示后按普通回答发送 */
        if (!NET.searchReady()){
          toast('联网搜索未配置：设置 → 连接与模型 → 在线搜索，选择提供商并填 Key；自定义/SearXNG 填地址后才能用', true);
          go(null, { fail: true });
          return;
        }
        var live = el('div', { class: 'srch', text: '正在联网搜索：' + text });
        $('#msg-list').appendChild(live); maybeScroll(false);
        var stage = function(s){ if (s){ live.textContent = s; maybeScroll(false); } };
        NET.searchWeb(text, stage).then(function(r){
          live.remove();
          if (r && r.skip){ go(null); return; } // 模型判定无需联网 → 直接作答，不提示
          if (r && r.err) toast('搜索失败：' + String(r.err).slice(0, 180), true);
          else if (!r || !r.block) toast('搜索未返回结果，仅按原问题回答');
          go(r && r.block, r || { fail: true });
        });
      } else go(null);
    });
  }

  function startStream(attsData, attsText, searchBlock, searchMeta, sentAt){
    var s = curSession();
    if (!s) return;
    if (sentAt == null) sentAt = nowMs(); // 重试/编辑等入口没有发送时间 → 从本次调用起算
    hydrateAttachments(S.msgs, function(){
      runStream(s, S.msgs, attsData, attsText, searchBlock, searchMeta, false, sentAt);
    });
  }
  /* v2.2：为指定会话发起请求（工具循环在后台会话里续跑时用；显示中的会话走内存 S.msgs） */
  function startStreamFor(sid, attsData, attsText, searchBlock, searchMeta, sentAt){
    if (!sid || isSending(sid)) return;
    if (sid === S.sid){ startStream(attsData, attsText, searchBlock, searchMeta, sentAt); return; }
    if (sentAt == null) sentAt = nowMs(); // 工具续跑等后台入口独立计时
    DB.msgsBySid(sid).then(function(list){
      var s = sessionById(sid);
      if (!s || isSending(sid)) return;
      list.sort(function(a, b){ return a.ts - b.ts; });
      hydrateAttachments(list, function(){
        runStream(s, list, attsData, attsText, searchBlock, searchMeta, true, sentAt);
      });
    });
  }
  /* bg=true：为后台会话跑流（不动当前内存/DOM）；bg=false：当前显示会话 */
  function runStream(s, msgs, attsData, attsText, searchBlock, searchMeta, bg, sentAt){
    if (!s || isSending(s.id)) return;
    if (sentAt == null) sentAt = nowMs(); // 每次流独立计时，不复用上一条消息的 t0
    var lim = ctxLimitFor(sessModel(s)) || 131072; /* v2.9 / session groups v0.4.2：按会话生效模型的上限判断 */
    var lu = lastUsage(msgs);
    if (lu && lu.p >= lim * 0.8 && msgs.length >= 9 && !S.compacting && (!S.compactTried || Date.now() - S.compactTried > 120000)){
      S.compacting = true; S.compactTried = Date.now();
      if (!bg) toast('上下文 80%+，自动压缩中…');
      compactCtx(s, msgs, function(ok){
        S.compacting = false;
    /* v0.3.19：压缩是异步的（数秒到数十秒），期间用户可能切走会话；此时不能再按前台续跑，否则气泡会插进当前显示的会话 */
    var nowBg = (s.id !== S.sid); // v0.3.29：回调发生时是否在前台，与原来是否后台无关
    if (ok && !nowBg) toast('摘要完成，继续发送');
    runStream(s, msgs, attsData, attsText, searchBlock, searchMeta, nowBg, sentAt);
      });
      return;
    }
    var asst = {
      id: uuid(), sid: s.id, role: 'assistant', content: '',
      status: 'streaming', ts: Date.now(), attachments: [],
      model: sessModel(s) /* session groups v0.4.2：记录实际应答模型 */
    };
  try { if (searchMeta && searchMeta.items && searchMeta.items.length) asst.srcs = searchMeta.items.slice(0, 6).map(function(x){ return { t: x.t || x.title || '', u: x.u || x.url || '' }; }); } catch (e) {} // v0.3.32：本轮来源挂到消息上
  try { if (searchMeta && searchMeta.fail) asst.searchFail = true; } catch (e) {}
    var st = bg ? beginStreamBG(asst, msgs, sentAt) : beginStream(asst, sentAt);
    notifyBusy(); // v2.2：告知宿主有生成在跑（隐藏/最小化时不要压内存挂起）
    if (!bg){
      if (searchMeta && searchMeta.block){ // 展示联网搜索过程：条数/时长/可展开来源
        var sd = el('details', { class: 'srch' },
          [el('summary', { text: '已联网搜索 ' + searchMeta.n + ' 条结果 · ' + (searchMeta.ms / 1000).toFixed(1) + ' 秒' })]);
        for (var si = 0; si < searchMeta.items.length; si++){
          (function(it){
            // Issue 17: 仅 http/https 渲染为可点链接，其余（javascript:/data: 等）降级为纯文本，防链接注入
            var ok = /^https?:\/\//i.test(it.u || '');
            sd.appendChild(el('div', { class: 'srch-i' },
              [ok ? el('a', { href: it.u, target: '_blank', rel: 'noopener', text: it.t || it.u })
                  : el('span', { text: it.t || it.u })]));
          })(searchMeta.items[si]);
        }
        st.node.insertBefore(sd, st.body);
      } else if (searchMeta && searchMeta.fail){
        /* 搜索失败/未配置：只加一行轻提示，不阻塞回答；模型侧另有系统提示说明未拿到结果 */
        var sfTxt = '本轮联网搜索未返回结果，以下回答未使用联网结果';
        if (searchMeta.err){
          var se = String(searchMeta.err).replace(/\s+/g, ' ').trim();
          if (se.length > 100) se = se.slice(0, 100) + '…';
          sfTxt = '搜索失败：' + se + '（以下回答未使用联网结果）';
        }
        st.node.insertBefore(el('div', { class: 'srch', text: sfTxt }), st.body);
      }
      setSending(true);
    }
    var body = NET.buildBody(s, msgs, attsData || null, attsText || null, searchBlock || null);
    var ac = new AbortController();
    st.aborter = ac;
    if (!bg) S.aborter = ac;
    var tmoErr = null, readerRef = null;
    var handle = NET.send({
      body: body,
      signal: ac.signal,
      abort: function(e){ tmoErr = e; ac.abort(); },
      onReader: function(r){ readerRef = r; },
      onDelta: function(t2, isR){ streamDelta(st, t2, isR); },
      onUsage: function(u){ usageSink(st, u); },
      onDone: function(_err, _calls){ finish(null, _calls); },
      onError: function(e){ finish(e); }
    });
    st.handle = handle;
    if (!bg) S.streamHandle = handle;
    function finish(err, calls){
      try { NET._lastCalls = calls || []; } catch (e) {}
      if (readerRef && readerRef.cancel) try { readerRef.cancel(); } catch (e) {}
      /* v0.8.4：原生 function calling → 转成围栏文本，交给现有 WORK/FS 回合循环执行。
         这样工具执行、结果回灌、续跑全部复用既有链路，不再新开一套。 */
      if (!err && calls && calls.length && (S.cfg.nativeTools || S.cfg.mode === 'soul')){
        try {
          var _ft = NET.toolCallsToFences(calls);   // 跨模块：必须走 NET
          try { NET._lastFences = _ft; NET._ntFlag = !!(S.cfg.nativeTools || S.cfg.mode === 'soul'); } catch (e) {}
          if (_ft){
            st.acc = (st.acc ? st.acc + '\n\n' : '') + _ft;
            if (st.msg) st.msg.content = st.acc;
            if (typeof st.flush === 'function') try { st.flush(); } catch (e) {}
          }
        } catch (e) {}
      }
      /* v1.29.0：本地计数 —— 成功 / 失败 / 用户中止 + 按模型记最近结果 */
      (function(){
        try {
          if (err){ var _i = NET.classify(tmoErr && tmoErr.tmo ? tmoErr : err);
            if (_i.code === 'abort') D('stop'); else { D('fail'); Dprov(false, _i.msg); } }
          else { D('ok'); Dprov(true); }
        } catch (e) {}
      })();
      if (!err){
        try {
          if (S.cfg.mode === 'soul' && window.SOUL && window.SOUL.logTurn){
            var _lu = '';
            for (var _ui = msgs.length - 1; _ui >= 0; _ui--){ if (msgs[_ui].role === 'user'){ _lu = String(msgs[_ui].content || ''); break; } }
            window.SOUL.logTurn(_lu, st.msg.content || '');
            if (window.SOUL.candidate) window.SOUL.candidate(_lu, true);
          }
        } catch (e) {}
        endStream(st, 'ok', null, st.msg.tokens ? { total_tokens: st.msg.tokens } : null);
        FS.handleTurn(asst); // 文件 Agent 回合循环入口（v1.1）：扫 fs-* 标记并续跑
        WORK.handleTurn(asst); // Work 回合循环入口（v2.0）：扫 run/vfs-* 标记并续跑
        return;
      }
      /* 中止优先真实 AbortError；超时用 tmoErr */
      var info = NET.classify(tmoErr && tmoErr.tmo ? tmoErr : err);
      if (info.code === 'abort') endStream(st, 'aborted', { msg: ERR.EABORT });
      else {
        if (info.code === 'net' && !bg && !st.msg._netRetried){
          st.msg._netRetried = 1;
          endStream(st, 'error', info);
          UI.toast('网络异常，1 秒后自动重试一次');
          setTimeout(function(){
            try { if (s.id === S.sid && !S.sending) retryMsg(st.msg.id); } catch (e) {}
          }, 1200);
          return;
        }
        endStream(st, 'error', info);
      }
    }
  }
  /* 后台会话流：登记到 S.streams，但不进 S.msgs / 不建 DOM 节点；消息推入该会话的本地 msgs 供下一轮构造上下文 */
  function beginStreamBG(msg, msgs, sentAt){
    var st = { sid: msg.sid, msg: msg, node: null, body: null, acc: msg.content || '', rAcc: msg.reasoning || '',
      rNode: null, rBody: null, aborter: null, handle: null, skel: null, lastLen: -1, lastMD: 0,
      t0: (sentAt == null ? nowMs() : sentAt),
      firstAt: null, lastAt: null, firstContentAt: null, lastContentAt: null };
    st.flush = function(){}; // 后台无需渲染
    S.streams[msg.sid] = st;
    msgs.push(msg);
    return st;
  }
  function stopGeneration(sid){
    sid = sid || S.sid;
    FS.stop(sid); // 文件 Agent 循环中止（v1.1/v2.2 按会话）
    WORK.stop(sid); // Work 循环中止（v2.0/v2.2 按会话）
    if (S.compactHandle && S.compactHandle.abort){ S.compactHandle.abort(); S.compactHandle = null; } // Issue 18
    var st = S.streams[sid];
    if (st){
      if (st.handle && st.handle.abort) st.handle.abort();
      else if (st.aborter) st.aborter.abort();
    }
  }
  /* v2.2：删除会话/清空全部前，终止其后台流并打上 dead 标记（结果不再落库，防复活） */
  function killStreams(sids){
    sids = sids || Object.keys(S.streams);
    for (var i = 0; i < sids.length; i++){
      var st = S.streams[sids[i]];
      if (!st) continue;
      st.dead = true;
      try { if (st.handle && st.handle.abort) st.handle.abort(); else if (st.aborter) st.aborter.abort(); } catch (e) {}
      delete S.streams[sids[i]];
      FS.stop(sids[i]); WORK.stop(sids[i]);
    }
  }
  function findMsg(id){
    for (var i = 0; i < S.msgs.length; i++) if (S.msgs[i].id === id) return i;
    return -1;
  }
  /* 回读文本附件（重试/重发）——v1.1.20：解析后的文档文本直接从附件记录取，
     老记录没有 text 的再按扩展名重解析；不能把 pptx 的二进制当 text/plain 读。 */
  function textsForMsg(m){
    return new Promise(function(res){
      if (!m) return res(null);
      if (m.fileTexts && m.fileTexts.length) return res(m.fileTexts);
      if (!m.attachments || !m.attachments.length) return res(null);
      var out = [], pending = m.attachments.length;
      function done(){ if (--pending === 0) res(out.length ? out : null); }
      m.attachments.forEach(function(aid){
        DB.getAttachment(aid).then(function(a){
          if (!a) return done();
          if (a.text){ out.push({ id: a.id, name: a.name, text: a.text }); return done(); }
          var ext = extOf(a.name);
          if (a.doc || DOC_EXT[ext]){
            DOC.parse(a.blob).then(function(t){
              var _t = String(t || '').slice(0, TEXT_SLICE);
              a.text = _t; try { DB.putAttachment(a); } catch (e) {}
              out.push({ id: a.id, name: a.name, text: _t });
              done();
            }).catch(done);
            return;
          }
          if ((a.mime || '').indexOf('text/') === 0 && a.blob && a.blob.text){
            a.blob.text().then(function(t){
              var _t = t.slice(0, TEXT_SLICE);
              a.text = _t; try { DB.putAttachment(a); } catch (e) {}
              out.push({ id: a.id, name: a.name, text: _t });
              done();
            }).catch(done);
          } else done();
        }).catch(done);
      });
    });
  }
  /* v1.1.21：附件自动进入工作区（Work=VFS，Agent=真实工作区），并生成可读文本/清单 */
  function wsSafeName(name){
    var n = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    if (!n || n === '.' || n === '..') n = 'file';
    return n.slice(0, 120);
  }
  function wsKindOf(r){
    var ext = extOf(r && r.name);
    if (r && r.doc) return 'doc';
    if (ext && DOC_EXT[ext]) return 'doc';
    if (r && /^image\//.test(r.mime || '')) return 'image';
    if (r && (r.text != null || /^text\//.test(r.mime || '') || (ext && TEXT_EXT[ext]))) return 'text';
    return 'file';
  }
  function wsSidecar(r, text){
    var ext = extOf(r.name), base = wsSafeName(r.name), kind = wsKindOf(r);
    text = String(text == null ? '' : text);
    if (kind === 'text') return { path: 'attachments/' + base, body: text };
    var body = '# 附件：' + r.name + '\n- 类型：' + (r.mime || ext || '文件') + '\n- 大小：' + sizeFmt(r.size || 0) + '\n';
    if (kind === 'doc' && text) body += '- 说明：以下为应用自动提取的文本；原始版式/图片未包含。原文件也保存在工作区（同名文件）。\n\n---\n\n' + text;
    else if (kind === 'image') body += '- 说明：原图已同时保存在工作区（同名文件）；文本工具不能读取像素，请在右侧预览或下载。\n';
    else if (kind === 'doc') body += '- 说明：文档未提取到文本；原文件已保存在工作区（同名文件）。\n';
    else body += '- 说明：原文件已保存在工作区（同名文件）。\n';
    return { path: 'attachments/' + base + '.md', body: body };
  }
  function truncBytes(body, max){
    if (new Blob([body]).size <= max) return body;
    var s = body.slice(0, Math.floor(max / 3));
    while (s.length && new Blob([s]).size > max) s = s.slice(0, Math.floor(s.length * 0.9));
    return s + '\n\n…（超长已截断）';
  }
  function workspaceWrite(sid, path, body){
    body = String(body == null ? '' : body);
    var cs = (typeof sessionById === 'function') ? sessionById(sid) : null;
    var mode = (cs && cs.mode) || S.cfg.mode || 'chat';
    /* Agent 有真实工作区时落真实目录；Work / Chat / 未选目录的 Agent 用 VFS */
    if ((mode === 'agent' || mode === 'soul') && cs && cs.workspace && NET.fs){
      return NET.fs('write', path, truncBytes(body, 240 * 1024), cs.workspace).then(function(){}, function(){});
    }
    if (typeof WORK !== 'undefined' && WORK.vfsWrite){
      return WORK.vfsWrite(sid, path, truncBytes(body, LIMITS.VFS_FILE_MAX - 1024)).then(function(){}, function(){});
    }
    return Promise.resolve();
  }
  function wsRawPath(r){ return 'attachments/' + wsSafeName(r.name); }
  /* v1.1.22：原文件写入工作区。Work 用 attachmentId 记录（不复制 blob），Agent 用 writeb64 落真实磁盘。 */
  function writeAttachmentBinary(sid, path, r){
    var cs = (typeof sessionById === 'function') ? sessionById(sid) : null;
    var mode = (cs && cs.mode) || S.cfg.mode || 'chat';
    if ((mode === 'agent' || mode === 'soul') && cs && cs.workspace && NET.fs){
      return DB.getAttachment(r.id).then(function(a){
        var src = a && (a.rawBlob || a.blob);
        if (!src) return false;
        return blobToDataURL(src).then(function(dataUrl){
          return NET.fs('writeb64', path, dataUrl, cs.workspace);
        }).then(function(){ return true; }, function(){ return false; });
      }).catch(function(){ return false; });
    }
    return DB.workfsBySid(sid).then(function(fs){
      var old = null;
      for (var i = 0; i < fs.length; i++) if (fs[i].path === path) old = fs[i];
      if (!old && fs.length >= LIMITS.VFS_FILES_MAX) throw new Error('文件数已达上限 ' + LIMITS.VFS_FILES_MAX);
      /* 二进制原文件只在 VFS 存 attachmentId 引用，字节仍在 attachments 表，不占 VFS 配额 */
      return DB.workfsPut({
        id: sid + '|' + path, sid: sid, path: path, content: '', size: r.size || 0, ts: Date.now(),
        vers: (old && old.vers ? old.vers.slice() : []),
        attachmentId: r.id, mime: r.mime || '', binary: true
      });
    }).then(function(){ return true; }, function(){ return false; });
  }
  /* v3.0：文本附件不再把正文复制进 VFS（会被 1MB 上限截断）。
     只写一条引用记录：attachmentId + 原始字节数 + 4KB 预览；
     全文由 vfs-read / vfs-grep 按需从 attachments 表读取。 */
  var VFS_PREVIEW_CHARS = 4 * 1024;
  function writeTextAttachmentRef(sid, path, r, text){
    var cs = (typeof sessionById === 'function') ? sessionById(sid) : null;
    var mode = (cs && cs.mode) || S.cfg.mode || 'chat';
    var full = String(text == null ? '' : text);
    /* Agent / 有真实工作区的 Soul 仍落真实磁盘（保持原行为，不受 VFS 1MB 限制） */
    if ((mode === 'agent' || mode === 'soul') && cs && cs.workspace && NET.fs){
      return NET.fs('write', path, truncBytes(full, 240 * 1024), cs.workspace)
        .then(function(){ return true; }, function(){ return false; });
    }
    var size = (r && r.size) || 0;
    var preview = full.slice(0, VFS_PREVIEW_CHARS);
    return DB.workfsBySid(sid).then(function(fs){
      var total = 0, old = null, i;
      for (i = 0; i < fs.length; i++){
        /* 二进制原文件不计入文本配额；引用记录按原始 size 计入（任务要求） */
        total += (fs[i].binary ? 0 : (fs[i].size || 0));
        if (fs[i].path === path) old = fs[i];
      }
      if (!old && fs.length >= LIMITS.VFS_FILES_MAX) throw new Error('文件数已达上限 ' + LIMITS.VFS_FILES_MAX);
      var oldSize = (old && !old.binary) ? (old.size || 0) : 0;
      if (total - oldSize + size > LIMITS.VFS_TOTAL_MAX)
        throw new Error('会话工作区总量超过 ' + Math.round(LIMITS.VFS_TOTAL_MAX / 1024 / 1024) + 'MB');
      return DB.workfsPut({
        id: sid + '|' + path, sid: sid, path: path, content: '', size: size, ts: Date.now(),
        vers: (old && old.vers ? old.vers.slice() : []),
        attachmentId: (r && r.id) || '', mime: (r && r.mime) || '',
        external: true, preview: preview
      });
    }).then(function(){ return true; }, function(){ return false; });
  }
  function importAttachmentsToWorkspace(sid, refs, fileTexts, allMsgs){
    if (!sid || !refs || !refs.length) return Promise.resolve();
    var byId = {}, byName = {};
    (fileTexts || []).forEach(function(t){
      if (!t) return;
      if (t.id) byId[t.id] = t;
      if (t.name) byName[t.name] = t;
    });
    var used = {};
    function uniq(p, id){
      if (!used[p]){ used[p] = 1; return p; }
      var dot = p.lastIndexOf('.');
      var suffix = '-' + String(id || '').slice(0, 4);
      var np = dot > 0 ? (p.slice(0, dot) + suffix + p.slice(dot)) : (p + suffix);
      used[np] = 1;
      return np;
    }
    var writes = [];
    refs.forEach(function(r){
      var ft = (r.id && byId[r.id]) || (r.name && byName[r.name]) || null;
      var text = ft ? ft.text : (r.text || '');
      var kind = wsKindOf(r);
      if (kind === 'text'){
        var tp = uniq('attachments/' + wsSafeName(r.name), r.id);
        r.path = tp; r.rawPath = '';
        if (ft) ft.path = tp;
        /* 只写引用记录（content 为空 + attachmentId + 预览），不复制全文进 VFS */
        writes.push({ path: tp, textRef: true, ref: r, preview: text });
        return;
      }
      /* 二进制原文件（图片/PDF/PPT/DOCX/XLSX/未知格式）原样入工作区 */
      var raw = uniq(wsRawPath(r), r.id);
      var sc = wsSidecar(r, text);
      sc.path = uniq(sc.path, r.id);
      r.rawPath = raw; r.path = sc.path;
      if (ft) ft.path = sc.path;
      writes.push(sc);
      writes.push({ path: raw, binary: true, ref: r });
    });
    /* 全量清单：把当前会话已有附件也带上，避免后一次上传覆盖前一次 */
    var all = [], seen = {};
    try {
      (allMsgs || S.msgs || []).forEach(function(m){
        if (m && m.role === 'user' && m.fileRefs) m.fileRefs.forEach(function(x){ all.push(x); });
      });
    } catch (e) {}
    refs.forEach(function(x){ all.push(x); });
    var lines = [];
    all.forEach(function(r){
      if (!r) return;
      if (r.rawPath && !seen[r.rawPath]){
        seen[r.rawPath] = 1;
        lines.push('- ' + r.rawPath + '（原文件 ' + r.name + '，' + (r.kind === '图片' ? '图片' : '二进制原文件') + '，原样保存）');
      }
      if (r.path && !seen[r.path]){
        seen[r.path] = 1;
        lines.push('- ' + r.path + '（' + (r.rawPath ? '可读文本 / 说明' : (r.kind === '文本' ? '文本全文（可用 vfs-grep / vfs-read 检索）' : (r.kind || '文本'))) + '，' + r.name + '）');
      }
    });
    if (lines.length){
      writes.push({ path: 'attachments/00-附件清单.md',
        body: '# 工作区附件清单\n\n本会话上传的附件已自动导入工作区（原文件原样保存）。文本内容读 .md/.txt；大文本先用 vfs-stat 看大小，再 vfs-grep 定位或 vfs-read 按 offset 分段读；要在整份附件上跑脚本时用 ```py（完整正文会带进临时目录）。图片/原文件用右侧预览/下载。\n\n' + lines.join('\n') + '\n' });
    }
    var chain = Promise.resolve();
    writes.forEach(function(w){
      chain = chain.then(function(){
        if (w.textRef) return writeTextAttachmentRef(sid, w.path, w.ref, w.preview);
        return w.binary ? writeAttachmentBinary(sid, w.path, w.ref) : workspaceWrite(sid, w.path, w.body);
      });
    });
    return chain.then(function(){ try { RUNNER.renderWs(); } catch (e) {} });
  }
  /* 附件引用（不含 blob）：导入工作区 / 写清单用 */
  function attachmentRefsOf(m){
    return Promise.all((m.attachments || []).map(function(id){ return DB.getAttachment(id); })).then(function(arr){
      return arr.filter(Boolean).map(function(a){
        var ext = extOf(a.name);
        var kind = (a.doc || DOC_EXT[ext]) ? '文档提取文本'
          : (/^image\//.test(a.mime || '') ? '图片'
          : ((a.text != null || /^text\//.test(a.mime || '') || TEXT_EXT[ext]) ? '文本' : '文件'));
        return { id: a.id, name: a.name, mime: a.origMime || a.mime || '', size: a.origSize || a.size || 0, kind: kind, text: a.text || '', external: kind === '文本' };
      });
    });
  }
  var _attJobs = {};
  /* v1.1.21：旧消息补齐 fileTexts/fileRefs，并把附件导入工作区（发送前 / 打开会话时） */
  function hydrateOneAttachment(m, msgs){
    if (_attJobs[m.id]) return _attJobs[m.id];
    var p = textsForMsg(m).then(function(t){
      if (t && t.length) m.fileTexts = t;
      return attachmentRefsOf(m);
    }).then(function(refs){
      var byId = {}, byName = {};
      (m.fileTexts || []).forEach(function(x){ if (x){ if (x.id) byId[x.id] = x; if (x.name) byName[x.name] = x; } });
      refs.forEach(function(r){
        var ft = (r.id && byId[r.id]) || (r.name && byName[r.name]);
        if (ft && ft.text) r.text = ft.text;
      });
      m.fileRefs = refs;
      return importAttachmentsToWorkspace(m.sid, refs, m.fileTexts, msgs);
    }).then(function(){
      try { DB.putMessage(m); } catch (e) {}
    }).catch(function(){
      try { DB.putMessage(m); } catch (e) {}
    });
    _attJobs[m.id] = p;
    p.then(function(){ delete _attJobs[m.id]; }, function(){ delete _attJobs[m.id]; });
    return p;
  }
  function hydrateAttachments(msgs, cb){
    var jobs = [];
    (msgs || []).forEach(function(m){
      if (!(m && m.role === 'user' && m.attachments && m.attachments.length)) return;
      var needTexts = !(m.fileTexts && m.fileTexts.length);
      var needRefs = !(m.fileRefs && m.fileRefs.length) || m.fileRefs.some(function(r){
        if (!r) return false;
        if (!r.path) return true;
        var k = r.kind || '';
        /* 0.4.14 之前的文本附件只有旧的 content 截断副本：即使 path 存在也重新 hydrate，
           用 external 引用覆盖旧 VFS 记录，旧会话才能读到全文 */
        if (k === '文本' && r.external !== true) return true;
        return (k === '图片' || k === '文件' || k === '文档提取文本') && !r.rawPath;
      });
      if (needTexts || needRefs) jobs.push(hydrateOneAttachment(m, msgs));
    });
    if (!jobs.length) return cb();
    Promise.all(jobs).then(function(){ cb(); }, function(){ cb(); });
  }
  /* 重试：失败的助手消息 → 移除后以相同上下文重发 */
  function retryMsg(id){
    if (S.sending) return;
    var i = findMsg(id);
    if (i < 0) return;
    var m = S.msgs[i];
    if (m.role === 'assistant'){
      DB.delMessage(id);
      S.msgs.splice(i, 1);
      var node = $listNode(id); if (node) node.remove();
      textsForMsg(S.msgs[i - 1]).then(function(t){ startStream(null, t); });
    }
  }
  /* 原地流式：regen/continue 共用 */
  function inPlaceStream(m, i, acc0, ctxMsgs){
    m.status = 'streaming'; m.errMsg = null;
    delete m.firstMs; delete m.ms; // v2.9：重新生成/继续生成重新计时，先清旧值
    setSending(true);
    /* v2.4：节点可能不在渲染窗口（超出 DOM 窗口/刚被重建）——原来直接 node.querySelector 会抛错 */
    var node = $listNode(m.id), body = node ? node.querySelector('.msg-body') : null;
    if (!node || !body){ renderMsgs(); node = $listNode(m.id); body = node && node.querySelector('.msg-body'); }
    if (!node || !body) return;
    var q = ['.msg-err', '.msg-acts', '.msg-fold', '.reason', '.msg-srcs', '.msg-dur'];
    for (var qi = 0; qi < q.length; qi++){ var qe = node.querySelector(q[qi]); if (qe) qe.remove(); }
    node.classList.remove('collapsed');
    body.textContent = '';
    var st = { sid: m.sid, msg: m, node: node, body: body, acc: acc0 || '', rAcc: '', rNode: null, rBody: null, aborter: null, handle: null,
      t0: nowMs(), firstAt: null, lastAt: null, firstContentAt: null, lastContentAt: null };
    st.flush = rafOnce(function(){ streamFrame(st); });
    S.streams[m.sid] = st;
    stream = st; S.streamMsg = m;
    maybeScroll(false); // v2.1：重新生成/继续生成也尊重用户当前滚动位置
    var s = curSession(), ac = new AbortController();
    st.aborter = ac; S.aborter = ac;
    var tmoErr = null, readerRef = null;
    var handle = NET.send({
      body: NET.buildBody(s, ctxMsgs, null, null), signal: ac.signal,
      abort: function(e){ tmoErr = e; ac.abort(); },
      onReader: function(r){ readerRef = r; },
      onDelta: function(t2, isR){ streamDelta(st, t2, isR); },
      onUsage: function(u){ usageSink(st, u); },
      onDone: function(){ fin(null); }, onError: function(e){ fin(e); }
    });
    st.handle = handle; S.streamHandle = handle;
    function fin(err){
      if (readerRef && readerRef.cancel) try { readerRef.cancel(); } catch (e) {}
      if (!err){ endStream(st, 'ok', null, st.msg.tokens ? { total_tokens: st.msg.tokens } : null); FS.handleTurn(m); WORK.handleTurn(m); return; }
      var info = NET.classify(tmoErr && tmoErr.tmo ? tmoErr : err);
      endStream(st, info.code === 'abort' ? 'aborted' : 'error', info.code === 'abort' ? { msg: ERR.EABORT } : info);
    }
  }
  /* 重新生成：原地覆盖，旧版入 variants */
  function regenMsg(id){
    if (S.sending) return;
    var i = findMsg(id); if (i < 0) return;
    var m = S.msgs[i];
    if (m.role !== 'assistant' || m.status === 'streaming') return;
    if (!m.variants || !m.variants.length){ m.variants = [m.content || '']; m.vi = 0; }
    m.variants = m.variants.slice(0, m.vi + 1); // 当前版往后截断，再追加新版
    m.variants.push('');
    m.vi = m.variants.length - 1; m.content = ''; delete m.srcs; // v0.3.34：重新生成不再挂上一轮的来源
    inPlaceStream(m, i, '', S.msgs.slice(0, i));
  }
  /* 版本切换：content 同步 variants[vi] */
  function variantStep(id, dir){
    var i = findMsg(id);
    if (i < 0) return;
    var m = S.msgs[i];
    if (!m || !m.variants || m.status === 'streaming') return;
    var nv = (m.vi || 0) + dir;
    if (nv < 0 || nv >= m.variants.length) return;
    m.vi = nv; m.content = m.variants[nv];
    var node = $listNode(id);
    var body = node.querySelector('.msg-body');
    node.classList.remove('collapsed');
    var fold = node.querySelector('.msg-fold'); if (fold) fold.remove();
    body.textContent = '';
    if (m.content) body.innerHTML = MD.render(m.content);
    var oldActs = node.querySelector('.msg-acts'); if (oldActs) oldActs.remove();
    node.appendChild(actsRow(m));
    DB.putMessage(m);
  }
  /* 继续生成：以已收部分内容为起点续写 */
  function continueMsg(id){
    if (S.sending) return;
    var i = findMsg(id); if (i < 0) return;
    var m = S.msgs[i];
    if (m.role !== 'assistant') return;
    inPlaceStream(m, i, m.content,
      S.msgs.slice(0, i).concat([{ role: 'assistant', content: m.content, status: 'ok' }]));
  }
  /* 编辑用户消息：就地替换为编辑框 */
  function editMsg(id){
    var i = findMsg(id);
    if (i < 0) return;
    var m = S.msgs[i];
    var node = $listNode(id);
    if (!node || node.querySelector('textarea')) return;
    var body = node.querySelector('.msg-body');
    var ta = el('textarea', { class: 'f-in', style: 'width:100%;min-height:70px' });
    ta.value = m.content;
    var row = el('div', { class: 'f-actions' }, [
      el('button', { class: 'btn btn-sec', 'data-act': 'edit-cancel', text: '取消' }),
      el('button', { class: 'btn btn-primary', 'data-act': 'edit-save', 'data-id': id, text: '保存并发送' })
    ]);
    var box = el('div', {}, [ta, row]);
    node.replaceChild(box, body);
    ta.focus();
  }
  function editCancel(id){
    renderMsgs();
  }
  function editSave(id){
    if (S.sending){ UI.toast('回复生成中，先停止再编辑重发', true); return; } // v0.3.2：否则先删尾部再被 isSending 挡回
    var i = findMsg(id);
    if (i < 0) return;
    var node = $listNode(id);
    var ta = node.querySelector('textarea');
    var text = ta.value.trim();
    if (!text) return;
    var m = S.msgs[i];
    var _oldText = m.content;
    m.content = text.slice(0, LIMITS.MSG_TEXT);
    m.tokens = tokEst(m.content);
    DB.putMessage(m);
    truncateAfter(i, _oldText);
    renderMsgs();
    touchSession(text);
    textsForMsg(m).then(function(t){ startStream(null, t); });
  }
  /* 截断：删 index 之后全部消息，index 保留；被截断的进 2 分钟撤销槽（/rewind） */
  var _rewind = null, _rewindTimer = 0;
  function finalizeRewind(){
    if (!_rewind) return;
    var r = _rewind; _rewind = null;
    try { clearTimeout(_rewindTimer); } catch (e) {}
    r.items.forEach(function(m){
      DB.delMessage(m.id);
      if (m.attachments && m.attachments.length) DB.delAttachments(m.attachments);
    });
  }
  function truncateAfter(idx, oldText){
    finalizeRewind();
    var removed = S.msgs.splice(idx + 1);
    var sid = S.sid || 'draft';
    removed.forEach(function(m){
      m._sid0 = m.sid || sid;
      m.sid = m._sid0 + '#u'; // 软删除：不随会话加载，撤销时还原
      DB.putMessage(m);
    });
    if (removed.length){
      _rewind = { sid: sid, idx: idx, items: removed, oldText: oldText, at: Date.now() };
      _rewindTimer = setTimeout(finalizeRewind, 120000);
      toast('已截断后续 ' + removed.length + ' 条，2 分钟内可 /rewind 恢复');
    }
  }
  function doRewind(){
    if (!_rewind || _rewind.sid !== (S.sid || 'draft')){ UI.toast('没有可恢复的截断（只有编辑重发后的 2 分钟内可恢复）', true); return; }
    var r = _rewind; _rewind = null;
    try { clearTimeout(_rewindTimer); } catch (e) {}
    var tail = S.msgs.splice(r.idx + 1);
    tail.forEach(function(m){
      DB.delMessage(m.id);
      if (m.attachments && m.attachments.length) DB.delAttachments(m.attachments);
    });
    var head = S.msgs[r.idx];
    if (head && r.oldText != null){ head.content = r.oldText; head.tokens = tokEst(head.content); DB.putMessage(head); }
    r.items.forEach(function(m){
      m.sid = m._sid0 || r.sid; delete m._sid0;
      DB.putMessage(m); S.msgs.push(m);
    });
    renderMsgs(); touchSession();
    UI.toast('已恢复 ' + r.items.length + ' 条消息');
  }
  function deleteMsg(id){
  if (S.sending){ UI.toast('回复生成中，先停止再删除', true); return; } // v0.3.5：否则收尾时会把消息写回库
    var i = findMsg(id);
    if (i < 0) return;
    var m = S.msgs[i];
    if (m.attachments && m.attachments.length) DB.delAttachments(m.attachments);
    DB.delMessage(id);
    S.msgs.splice(i, 1);
    var node = $listNode(id);
    if (node) node.remove();
    touchSession();
  }
  function copyMsg(id){
    var i = findMsg(id);
    if (i < 0) return;
    copyText(S.msgs[i].content).then(function(){ toast('已复制'); });
  }
  /* v1.11：优先走宿主剪贴板 —— WebView2 的 navigator.clipboard.writeText 会卡在权限请求上
     一直 pending（既不 resolve 也不 reject），代码块复制按钮就永远没反应 */
  function hostBridge(){ try{ return window.chrome && window.chrome.webview && window.chrome.webview.postMessage ? window.chrome.webview : null; }catch(e){ return null; } }
  function copyText(t){
    t = String(t == null ? '' : t);
    var h = hostBridge();
    if (h){ try { h.postMessage({ t: 'copy', text: t }); return Promise.resolve(true); } catch (e) {} }
    if (navigator.clipboard && navigator.clipboard.writeText){
      return Promise.race([
        navigator.clipboard.writeText(t).then(function(){ return true; }).catch(function(){ return legacyCopy(t); }),
        new Promise(function(res){ setTimeout(function(){ res(legacyCopy(t)); }, 600); })
      ]);
    }
    return Promise.resolve(legacyCopy(t));
  }
  function legacyCopy(t){
    var ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }
  function $listNode(id){ // Issue 19: 转义属性值中的引号/反斜杠，防特殊 id 破坏选择器
    return $('#msg-list .msg[data-id="' + String(id).replace(/["\\]/g, '\\$&') + '"]'); }

  /* 附件：图片压缩 / 纯文本直读 / 文档解析（§4.3，v1.4 放宽格式与大小） */
  var TEXT_EXT = { txt: 1, md: 1, markdown: 1, json: 1, html: 1, htm: 1, css: 1, js: 1, py: 1,
    java: 1, c: 1, cpp: 1, h: 1, cs: 1, xml: 1, yml: 1, yaml: 1, csv: 1, log: 1, ini: 1, toml: 1, sql: 1, sh: 1, bat: 1 };
  var TEXT_SLICE = 256 * 1024;     // 注入 prompt 时截断长度
  function extOf(name){ var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function docMaxBytes(){ return clamp(parseInt(S.cfg.maxDocMB, 10) || 20, 1, 100) * 1048576; }  // 文本/文档上限
  function imgMaxBytes(){ return clamp(parseInt(S.cfg.maxImgMB, 10) || 10, 1, 100) * 1048576; }   // 图片上限
  function isTextFile(f){
    if (/^text\//.test(f.type)) return true;
    return !!TEXT_EXT[extOf(f.name)];
  }
  function isDocFile(f){ return !!DOC_EXT[extOf(f.name)]; }   // docx/xlsx/pptx/pdf/rtf（v1.4）
  function addFiles(files){
    var imgs = [], texts = [], docs = [], bad = [];
    for (var i = 0; i < files.length; i++){
      var f = files[i];
      if (/^image\//.test(f.type)) imgs.push(f);
      else if (isTextFile(f)) texts.push(f);
      else if (isDocFile(f)) docs.push(f);
      else bad.push(f);
    }
    bad.forEach(function(f){ toast('不支持的文件格式：' + f.name, true); });
    if (!imgs.length && !texts.length && !docs.length) return;
    imgs.forEach(function(f){
      if (f.size > imgMaxBytes()){ toast('图片超过 ' + (parseInt(S.cfg.maxImgMB, 10) || 10) + 'MB：' + f.name, true); return; }
      compressImage(f).then(function(r){
        S.pendAtts.push({
          id: uuid(), name: f.name, blob: r.blob, w: r.w, h: r.h, url: URL.createObjectURL(r.blob),
          /* v1.1.22：原图另存，工作区放原文件；发送给模型仍用压缩图 */
          rawBlob: f, origSize: f.size, origMime: f.type || 'image/jpeg'
        });
        renderChips();
      }).catch(function(){ toast('图片处理失败：' + f.name, true); });
    });
    texts.forEach(function(f){
      if (f.size > docMaxBytes()){ toast('文本/文档超过 ' + (parseInt(S.cfg.maxDocMB, 10) || 20) + 'MB：' + f.name, true); return; }
      f.text().then(function(content){
        S.pendAtts.push({
          id: uuid(), name: f.name, blob: f, isText: true, size: f.size,
          text: content.slice(0, TEXT_SLICE), truncated: content.length > TEXT_SLICE
        });
        renderChips();
      }).catch(function(){ toast('文件读取失败：' + f.name, true); });
    });
    docs.forEach(function(f){ // 文档解析：提取为纯文本附件，随重试/导入持久化
      if (!S.cfg.docParse){ toast('文档解析未开启（设置 → 文档解析）：' + f.name, true); return; }
      if (f.size > docMaxBytes()){ toast('文档超过 ' + (parseInt(S.cfg.maxDocMB, 10) || 20) + 'MB：' + f.name, true); return; }
      toast('正在解析文档：' + f.name);
      DOC.parse(f).then(function(txt){
        if (!txt || !txt.replace(/\s/g, '')) throw new Error('empty');
        S.pendAtts.push({
          id: uuid(), name: f.name, blob: f, isText: true, size: f.size, doc: true,
          text: txt.slice(0, TEXT_SLICE), truncated: txt.length > TEXT_SLICE
        });
        renderChips();
        toast('已解析 ' + f.name + (txt.length > TEXT_SLICE ? '（超长已截断）' : ''));
      }).catch(function(e){
        /* v0.4.8：扫描版 PDF 不再直接失败 —— 支持文档输入的协议直接收原文件 */
        var proto = S.cfg.protocol || 'openai-chat';
        var canDoc = (proto === 'anthropic-messages' || proto === 'openai-responses') && S.cfg.docToModel !== false;
        if (canDoc && /\.pdf$/i.test(f.name)){
          S.pendAtts.push({ id: uuid(), name: f.name, blob: f, isDoc: true, size: f.size });
          renderChips();
          toast('已作为 PDF 附件交给模型读取：' + f.name);
          return;
        }
        var tip = /pdf/i.test(f.name) ? '（扫描版需 OCR，或把协议切到 Anthropic / Responses 让模型直接读 PDF）' : '';
        toast('文档解析失败：' + f.name + ' —— ' + (e && e.message ? e.message : '未知错误') + tip, true);
      });
    });
  }
  function compressImage(file){
    return new Promise(function(res, rej){
      var url = URL.createObjectURL(file); // 避免 5MB 图转 base64 常驻（§5.2.6）
      var img = new Image();
      function done(){ URL.revokeObjectURL(url); }
      img.onload = function(){
        done();
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, LIMITS.ATTACH_EDGE / Math.max(w, h));
        var q = LIMITS.ATTACH_Q, tries = 0;
        (function attempt(){
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var cv = el('canvas');
          cv.width = cw; cv.height = ch;
          cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
          cv.toBlob(function(b){
            if (!b) return rej(new Error('compress'));
            if (b.size <= LIMITS.ATTACH_SEND || ++tries >= 3)
              return res({ blob: b, w: cw, h: ch });
            scale *= 0.8; q = Math.max(0.6, q - 0.1);
            attempt();
          }, 'image/jpeg', q);
        })();
      };
      img.onerror = function(){ done(); rej(new Error('decode')); };
      img.src = url;
    });
  }
  function revokePreviews(){
    for (var i = 0; i < S.previewUrls.length; i++) URL.revokeObjectURL(S.previewUrls[i]);
    S.previewUrls = [];
  }

  /* 导入/导出：流式写 Blob
     F5：导出含全部聊天/附件；默认【脱敏分享】把 workspace 绝对路径压成末级文件夹名，
     避免泄露本机目录结构。选【完整备份】才保留绝对路径（仅自用/还原；工作区需重新授权）。 */
  function doExport(){
    var full = confirm('导出模式\n\n【确定】完整备份 —— 保留本机工作区绝对路径，用于自用还原\n【取消】脱敏分享 —— 工作区只保留文件夹名，去除本机绝对路径\n\n导出文件包含全部聊天记录与附件，请确认分享对象。');
    DB.exportData().then(function(d){
      var sess = d.sessions;
      if (!full){
        sess = sess.map(function(s){
          var o = {}; for (var k in s) o[k] = s[k];
          if (o.workspace) o.workspace = (String(o.workspace).split(/[\\/]/).filter(Boolean).pop()) || '';
          return o;
        });
      }
      var atts = d.attachments || [];
      var parts = ['{"v":2,"sessions":', JSON.stringify(sess), ',"messages":', JSON.stringify(d.messages), ',"workfs":', JSON.stringify(d.workfs || []), ',"attachments":['];
      var chain = Promise.resolve();
      atts.forEach(function(a, i){
        chain = chain.then(function(){
          return blobToDataURL(a.blob).then(function(u){
            parts.push((i ? ',' : '') + JSON.stringify({ id: a.id, sid: a.sid, name: a.name, mime: a.mime, size: a.size, w: a.w, h: a.h, data: u }));
          });
        });
      });
      chain.then(function(){
        parts.push(']}');
        var blob = new Blob(parts, { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = el('a', { href: url, download: 'solochat-export-' + new Date().toISOString().slice(0, 10) + '.json' });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function(){ URL.revokeObjectURL(url); }, 1000); // createObjectURL 与 revoke 成对（§5.2.1）
        toast('导出完成');
      });
    });
  }
  function doImport(file){
    var r = new FileReader();
    r.onload = function(){
      var d;
      try { d = JSON.parse(r.result); } catch (e) { toast('文件不是有效 JSON', true); return; }
      if (!d || !Array.isArray(d.sessions) || !Array.isArray(d.messages)){ toast('文件格式不符', true); return; }
      (d.attachments || []).forEach(function(a){
        if (a.data){
          try { a.blob = dataURLtoBlob(a.data); } // Issue 19: 单个损坏附件不再中断整个导入
          catch (e){ a.blob = null; }
        }
        delete a.data;
      });
      DB.importData(d).then(function(){ reloadSessions(); toast('导入完成'); });
    };
    r.readAsText(file);
  }
  function reloadSessions(asDraft){
    DB.allSessions().then(function(list){
      S.sessions = list || [];
      /* 迁移（一次性）：旧会话把默认值当显式设置存了 → 删键改跟随全局 */
      if (!S.cfg.migSess){
        for (var mi = 0; mi < S.sessions.length; mi++){
          var ms = S.sessions[mi];
          if (ms.params){
            if (ms.params.maxTokens === 2048 || ms.params.maxTokens === 0) delete ms.params.maxTokens;
            if (ms.params.temperature === 0.7) delete ms.params.temperature;
            if (!Object.keys(ms.params).length) delete ms.params;
            DB.putSession(ms);
          }
          if (ms.systemPrompt && ms.systemPrompt === (S.cfg.systemPrompt || '')){ ms.systemPrompt = ''; DB.putSession(ms); }
        }
        S.cfg.migSess = 1; saveCfg();
      }
      sortSessions();
      renderSessions();
      if (!S.sessions.length || asDraft){ S.sid = null; S.msgs = []; renderMsgs(); $title.textContent = 'SoloChat'; }
      else if (!curSession()) selectSession(S.sessions[0].id);
      updateEmpty();
    });
  }


  /* v1.12：输入框左侧那枚胶囊 —— Work 选子模式，Agent 选 Auto/Read/Write */
  function closeModePop(){ var p = $('#sub-pop'); if (p) p.hidden = true; }
  function modeItems(){
    var out = [];
    if ((S.cfg.mode || 'chat') === 'work'){
      var cur = MODE.sub();
      MODE.subList().forEach(function(x){
        out.push({ name: x.name, hint: x.hint || '', on: !!(cur && cur.id === x.id),
          run: function(){ MODE.setSub(x.id); } });
      });
    }
    return out;
  }
  function openChipPop(){
    var pop = $('#sub-pop'), btn = $('#btn-cmode');
    if (!pop || !btn) return;
    if (!pop.hidden){ closeModePop(); return; }
    var list = el('div', { class: 'sp-list' });
    modeItems().forEach(function(it){
      var b = el('button', { type: 'button', class: 'sp-item' + (it.on ? ' on' : '') });
      b.appendChild(el('span', { class: 'sp-n', text: it.name }));
      b.appendChild(el('span', { class: 'sp-h', text: it.hint }));
      b.addEventListener('click', function(){ it.run(); closeModePop(); renderComposerCtl(); });
      list.appendChild(b);
    });
    pop.textContent = ''; pop.appendChild(list);
    var r = btn.getBoundingClientRect();
    pop.style.left = Math.round(r.left) + 'px';
    pop.style.bottom = Math.round(window.innerHeight - r.top + 8) + 'px';
    pop.hidden = false;
  }
  /* v1.28.4：自动路由的提示条 —— 切了要说，且能一键切回 */
  function hideRouteHint(){
    var b = document.getElementById('route-hint');
    if (b){ b.hidden = true; b.textContent = ''; }
  }
  function routeHint(from, to){
    var b = document.getElementById('route-hint'); if (!b) return;
    var nm = { chat: 'Chat', work: 'Work', agent: 'Agent', soul: 'Soul' };
    var nFrom = nm[from] || from, nTo = nm[to] || to;
    b.textContent = '';
    b.appendChild(el('span', { class: 'rh-t' }, ['已按本轮输入切到 ', el('b', { text: nTo }), '（原 ' + nFrom + '）']));
    var back = el('button', { type: 'button', text: '切回 ' + nFrom });
    back.addEventListener('click', function(){
      setCfg({ mode: from, persona: '' });
      hideRouteHint();
      try { renderComposerCtl(); } catch (e) {}
      toast('已切回 ' + nFrom);
    });
    var ok = el('button', { type: 'button', text: '知道了' });
    ok.addEventListener('click', hideRouteHint);
    b.appendChild(back); b.appendChild(ok);
    b.hidden = false;
  }
  function renderModeChip(){
    var b = $('#btn-cmode'); if (!b) return;
    var md = S.cfg.mode || 'chat';
    var txt = '', cls = 'cmode';
    if (md === 'work'){ var x = MODE.sub(); txt = x ? x.name : ''; } /* v1.28.2：Agent 不再有 Auto/Read/Write 小模式，不显示圆钮 */
    b.style.display = txt ? 'flex' : 'none';
    b.className = cls;
    b.textContent = '';
    if (!txt) return;
    b.appendChild(el('span', { text: txt }));
    b.appendChild(el('span', { class: 'caret' }));
    b.title = 'Work 子模式：' + txt + '（点开切换）';
  }
  var _cmodeBtn = $('#btn-cmode');
  if (_cmodeBtn) _cmodeBtn.addEventListener('click', function(e){ e.stopPropagation(); openChipPop(); });
  var _permPick = $('#perm-pick'), _permTrigger = $('#perm-trigger'), _permMenu = $('#perm-menu');
  function closePermMenu(){
    if (!_permMenu) return;
    _permMenu.hidden = true;
    if (_permTrigger) _permTrigger.setAttribute('aria-expanded', 'false');
  }
  function openPermMenu(){
    if (!_permMenu) return;
    _permMenu.hidden = false;
    if (_permTrigger) _permTrigger.setAttribute('aria-expanded', 'true');
  }
  if (_permTrigger) _permTrigger.addEventListener('click', function(e){
    e.stopPropagation();
    if (_permMenu && _permMenu.hidden) openPermMenu(); else closePermMenu();
  });
  if (_permMenu) _permMenu.addEventListener('click', function(e){
    e.stopPropagation();
    var b = e.target.closest && e.target.closest('button[data-perm]');
    if (!b) return;
    var v = b.getAttribute('data-perm');
    setPerm(v);
    closePermMenu();
    try { renderComposerCtl(); } catch (x) {}
    UI.toast('执行权限：' + ({ plan: 'Plan · 只读规划', write: 'Write · 命令需确认', free: 'Free · 全部免确认' }[normPerm(v)] || v));
  });
  document.addEventListener('click', function(e){
    if (_permPick && !_permPick.contains(e.target)) closePermMenu();
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && _permMenu && !_permMenu.hidden){ e.preventDefault(); e.stopPropagation(); closePermMenu(); }
  });

  document.addEventListener('click', function(e){
    if (e.target.closest && (e.target.closest('#sub-pop') || e.target.closest('#btn-cmode'))) closeModePop();
  });

  /* v0.4.2：语音按钮显隐（STT/TTS 各自开关，不改动其他输入区图标） */
  function applyVoiceClasses(){
    var st = !!(S.cfg && S.cfg.sttEnabled), tt = !!(S.cfg && S.cfg.ttsEnabled);
    document.body.classList.toggle('voice-stt', st);
    document.body.classList.toggle('voice-tts', tt);
    var bs = document.getElementById('btn-stt'), bt = document.getElementById('btn-tts');
    if (bs) bs.title = st ? '语音输入（STT）：点一下开始说话' : '语音输入：未启用（+更多 里开启）';
    if (bt) bt.title = tt ? '朗读最后一条回复（TTS）' : '语音合成：未启用（+更多 里开启）';
  }
  function syncSoulFaceBtn(){
    var n = document.querySelector('#btn-soul-profile .sp-face');
    if (!n || !window.SOUL || !SOUL.avatar) return;
    var av = SOUL.avatar();
    n.textContent = '';
    if (/^data:image\//i.test(String(av))) n.appendChild(el('img', { src: av, alt: 'Soul 头像' }));
    else n.textContent = String(av || '🌙');
  }
  /* 输入区控件（v1.2）：模式/模型/思考 */
  var _lastPanelMode = null;
  function renderComposerCtl(){
    var _mNow = S.cfg.mode || 'chat';
    /* 模式从设置/会话参数等路径切换时，也清掉上一模式的网页侧栏（只关 web 标签，不误伤工作区） */
    if (_lastPanelMode && _lastPanelMode !== _mNow && document.body.classList.contains('rn-open')){
      try { RUNNER.closeWebSidebar(); } catch (e) {}
    }
    _lastPanelMode = _mNow;
    var mdName = $('#tb-mode-name');
    if (mdName) mdName.textContent = (S.cfg.mode === 'work') ? 'Work' : (S.cfg.mode === 'agent' ? 'Agent' : (S.cfg.mode === 'soul' ? 'Soul' : 'Chat'));
    var _isSoul = (S.cfg.mode || 'chat') === 'soul';
    var _permSel = $('#perm-pick');
    if (_permSel){
      _permSel.style.display = (_mNow === 'chat') ? 'none' : '';
      var _plab = $('#perm-label');
      if (_plab) _plab.textContent = ({ plan: 'Plan', write: 'Write', free: 'Free' }[permNow()] || 'Write');
      var _pbs = _permSel.querySelectorAll('#perm-menu [data-perm]');
      for (var _pi = 0; _pi < _pbs.length; _pi++)
        _pbs[_pi].classList.toggle('on', _pbs[_pi].getAttribute('data-perm') === permNow());
      _permSel.title = '执行权限：' + ({ plan: 'Plan 只读规划', write: 'Write 全部工具、命令需确认', free: 'Free 全部工具、免确认' }[permNow()] || '');
      closePermMenu();
    }
    /* v0.4.11：空态模式条状态同步（权限选框在输入框内） */
    var _segMode = $('#seg-mode');
    if (_segMode){
      var _modeBtns = _segMode.querySelectorAll('[data-mode]');
      for (var _mi = 0; _mi < _modeBtns.length; _mi++)
        _modeBtns[_mi].classList.toggle('on', _modeBtns[_mi].getAttribute('data-mode') === _mNow && !S.cfg.persona);
    }
    if (typeof applyLimitCfg === 'function') applyLimitCfg(_mNow);
    document.body.classList.toggle('m-chat', (S.cfg.mode || 'chat') === 'chat');
    document.body.classList.toggle('m-soul', _isSoul);
    applyVoiceClasses();
    syncSoulFaceBtn();
    if (_isSoul){
      var _pk = S.cfg.picks || {}, _has = false;
      for (var _k in _pk) if (Object.prototype.hasOwnProperty.call(_pk, _k) && (_pk[_k] || []).length){ _has = true; break; }
      if (_has){ setCfg({ picks: {} }); } /* Soul 不需要勾选，清掉旧选择避免限制工具 */
    }
    var pb = $('#btn-panel');
    if (pb) pb.style.display = ((S.cfg.mode || 'chat') === 'chat') ? 'none' : '';
    if ((S.cfg.mode || 'chat') === 'chat' && document.body.classList.contains('rn-open')) { document.body.classList.remove('rn-open'); try { RUNNER.webHostHide(); } catch (e) {} }
    renderModeChip();
    var dblBtn = $('#btn-dual');
    if (dblBtn) dblBtn.style.display = (S.cfg.mode === 'chat') ? '' : 'none';
    if (S.cfg.mode !== 'chat' && S.cfg.dual){ setCfg({ dual: false }); document.body.classList.remove('dual-on'); }
    var selM = $('#sel-model'), selT = $('#sel-think'), act = document.activeElement;
    var _effM = sessModel(curSession()) || S.cfg.currentModel; // 会话自己的模型优先
    if (selM && act !== selM){
      var ps = S.cfg.presets || [];
      selM.textContent = '';
      if (!ps.length) selM.appendChild(el('option', { value: '', text: '选择模型' }));
      if (ps.length && !_effM) selM.appendChild(el('option', { value: '', text: '选择模型', selected: '' }));
      for (var j = 0; j < ps.length; j++){
        var pg = ps[j], og = el('optgroup', { label: pg.name || '配置' });
        var ms = (pg.models && pg.models.length) ? pg.models : (pg.currentModel ? [pg.currentModel] : []);
        if (!ms.length) og.appendChild(el('option', { value: pg.id + '\x01', text: '选择模型', disabled: true }));
        for (var k = 0; k < ms.length; k++)
          og.appendChild(el('option', { value: pg.id + '\x01' + ms[k], text: modelLabel(ms[k]),
            selected: (pg.id === S.cfg.activePreset && ms[k] === _effM) ? '' : null }));
        selM.appendChild(og);
      }
    }
    if (selT && act !== selT){
      var list = String(S.cfg.thinkList || 'Default').split(',').map(function(x){ return x.trim(); }).filter(Boolean);
      if (list.indexOf('Default') < 0) list.unshift('Default');
      /* v0.2.5：优先用「该模型自动探测到的档位」（GPT-5 → minimal/low/medium/high；Qwen/GLM → enabled/disabled） */
      var effL = (MODE.efforts && MODE.efforts()) || ((NET.reasonProfile && NET.reasonProfile(_effM) || {}).efforts) || null;
      if (effL && effL.length) list = ['Default'].concat(effL);
      var cur = (S.cfg.thinkByModel && S.cfg.thinkByModel[_effM]) || 'Default';
      selT.textContent = '';
      for (var i = 0; i < list.length; i++)
        selT.appendChild(el('option', { value: list[i], text: list[i], selected: list[i] === cur ? '' : null }));
    }
    renderWsBtn();
    renderCtxRing();
    var imgBtn = $('#btn-img');
    if (imgBtn){ var ok = (typeof IMG !== 'undefined' && IMG.available && IMG.available()); imgBtn.disabled = !ok; imgBtn.classList.toggle('is-disabled', !ok); if (!ok) imgBtn.title = '生成图片（先在设置里配置连接）'; else imgBtn.title = '生成图片（输入描述后生成，支持流式预览）'; }
    if (typeof notifyQuickState === 'function') notifyQuickState(); // 小窗 Chat/Agent、联网状态回显
  }
  /* 上下文估算（v2.9 重做 / v3.0 修正口径）
     口径 = 缓存命中 + 未缓存历史 + 本次输入 + 本次输出。
     注意「本次输出」是**已经发生的**：上一轮回复真实生成的 completion token，
     不再按 max_tokens 预占一个「预计输出」（那既会重复计数，又会在空草稿时凭空多出几千）。 */
  function ctxEst(){
    var fam = NET.estimate.family(sessModel(curSession())); /* session groups v0.4.2 */
    var u = lastUsage(S.msgs);
    var sys = sessSystemPrompt(curSession()) || '';
    var sysT = Math.ceil(NET.estimate.text(sys, fam));
    var histT, cache = 0, outT = 0, src = 'estimate';
    if (u && u.p > 0){
      /* 真实口径：prompt（缓存+未缓存）与 completion 分开报，不再拿「预计输出」凑数 */
      histT = u.p;                        /* 上一轮请求的 prompt = 系统提示 + 全部历史 */
      outT = u.c || 0;                    /* 上一轮回复真实生成的 token（已发生） */
      cache = Math.min(u.h || 0, histT);
      src = 'actual';
    } else {
      var t = 0, n = 0, chars = 0;
      for (var i = S.msgs.length - 1; i >= 0 && n < LIMITS.CTX_MSGS; i--){
        var m = S.msgs[i], len = String(m.content || '').length;
        if (chars + len > LIMITS.CTX_CHARS && n) break;
        t += 4 + NET.estimate.text(m.content, fam); chars += len; n++;
      }
      histT = Math.ceil(sysT + t);
    }
    var inp = ($input && $input.value) || '';
    var inpT = (inp ? 4 : 0) + NET.estimate.text(inp, fam);
    var imgN = 0, attT = 0;
    for (var k = 0; k < S.pendAtts.length; k++){
      var a = S.pendAtts[k];
      if (a.isText) attT += NET.estimate.text(a.text || '', fam);
      else { imgN++; attT += NET.estimate.image(a.w, a.h); }
    }
    var used = histT + inpT + attT + outT;
    return { tok: Math.ceil(used), sys: sysT, hist: histT, cache: Math.ceil(cache),
      uncached: Math.ceil(Math.max(0, histT - cache)),
      inp: Math.ceil(inpT), att: Math.ceil(attT), imgN: imgN,
      out: Math.ceil(outT), src: src, nMsgs: u ? 0 : undefined };
  }
  function renderCtxRing(){
    var z = $('#ctx-ring'); if (!z) return;
    var e = ctxEst();
    var lim = ctxLimitFor(sessModel(curSession())); /* session groups v0.4.2 */
    var pct = lim > 0 ? Math.min(1, e.tok / lim) : 0;
    var fg = z.querySelector('.ctx-fg'), num = z.querySelector('.ctx-num');
    if (fg) fg.style.strokeDasharray = (pct * 97.4).toFixed(1) + ' 97.4';
    if (num) num.textContent = '≈' + fmtTok(e.tok) + '/' + fmtTok(lim);
    z.classList.toggle('warn', pct >= 0.7 && pct < 0.9);
    z.classList.toggle('over', pct >= 0.9);
    var tip = ['上下文占用 ≈ ' + e.tok.toLocaleString() + ' / ' + lim.toLocaleString() + ' tok（' + Math.round(pct * 100) + '%）',
      '= 缓存命中 ' + e.cache.toLocaleString() + ' + 未缓存输入 ' + e.uncached.toLocaleString() +
      ' + 草稿 ' + (e.inp + e.att).toLocaleString() + ' + 本次输出 ' + e.out.toLocaleString(),
      '· 上一轮 prompt ' + e.hist.toLocaleString() + '（' + (e.src === 'actual' ? '接口返回的真实 usage' : '按字数估算') + '，含系统提示与你已发的消息）',
      '· 正在输入（未发送）' + e.inp.toLocaleString() + (e.att ? ' + 附件 ' + (e.imgN ? e.imgN + ' 张图 ' : '') + e.att.toLocaleString() : ''),
      '· 本次输出 ' + e.out.toLocaleString() + '（' + (e.out ? '上一轮回复真实生成的 token，已进入上下文' : '本轮还没生成') + '）',
      '估算部分按模型家族系数折算，非 BPE'];
    z.title = tip.join('\n');
  }
  function renderWsBtn(){
    var b = $('#btn-ws'), s = curSession();
    RUNNER.renderWs(); /* v2.1：运行面板「工作区」区随会话联动 */
    if (!b) return; /* v2.9：按钮只在 Agent 主页存在，会话开始后自然消失 */
    var ws = (s && s.workspace) || (!s ? S.pendWs : '');
    b.classList.toggle('on', !!ws);
    var lab = $('#ws-label');
    if (lab) lab.textContent = ws ? (ws.split(/[\\/]/).filter(Boolean).pop() || ws) : '选择文件夹';
    b.title = ws ? '工作区：' + ws + '（点击可更换）'
      : '选择工作区文件夹：本次会话中 AI 只能读取该文件夹内的文件（开始后不可更改）';
  }
  /* Work：沙箱工作区整包 zip（页内 ZIP，全程内存）。入口在右侧「运行」面板的工作区区。 */
  function zipVfs(){
    if (!S.sid){ toast('先开始一个会话', true); return; }
    DB.workfsBySid(S.sid).then(function(fs){
      if (!fs.length){ toast('沙箱工作区暂无文件', true); return; }
      var enc = new TextEncoder();
      var jobs = fs.map(function(f){
        if (f.binary && f.attachmentId){
          return DB.getAttachment(f.attachmentId).then(function(a){
            var src = a && (a.rawBlob || a.blob);
            return src ? src.arrayBuffer().then(function(b){ return new Uint8Array(b); }) : new Uint8Array(0);
          }, function(){ return new Uint8Array(0); });
        }
        return Promise.resolve(enc.encode(f.content || ''));
      });
      return Promise.all(jobs).then(function(arr){
        var entries = fs.map(function(f, i){ return { name: 'workspace/' + f.path, data: arr[i] }; });
        var s = curSession();
        var base = 'sandbox-' + ((s && s.title || 'work').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30));
        ZIP.dl(ZIP.pack(entries), base + '.zip');
        toast('已打包 ' + fs.length + ' 个文件');
      });
    });
  }
  function pickWorkspace(){
    var s = curSession();
    if (s && S.msgs.length){ toast('会话开始后不能更改工作区', true); return; }
    if (!NET.bridge.ok && !NET.isMock()){ toast('工作区需宿主环境', true); return; }
    NET.fs('addroot', '', null).then(function(r){
      if (!r || !r.root) return;
      if (s){ s.workspace = r.root; DB.putSession(s); }
      else S.pendWs = r.root; // 草稿态：预选，建会话时落入
      renderWsBtn();
      /* v2.9：不再 toast「工作区：…」—— 主页按钮上已经显示文件夹名 */
    }, function(err){ toast(err && err.message || '选择失败', true); });
  }

  /* 更多菜单/提示词/导入弹层 */
  var popMode = null; // null | 'more' | 'prompt' | 'at'
  function popOpen(){ return !!popMode; }
  function closePop(){ popMode = null; var p = $('#cmp-pop'); if (p) p.hidden = true; }
  function popItems(items, title){
    var p = $('#cmp-pop');
    p.textContent = '';
    if (title) p.appendChild(el('div', { class: 'cmp-title', text: title }));
    if (!items.length) p.appendChild(el('div', { class: 'cmp-title', text: '（无匹配项）' }));
    for (var i = 0; i < items.length; i++){
      (function(it){
        var kids = [el('span', { class: 't', text: it.t })];
        if (it.p) kids.push(el('span', { class: 'p', text: it.p }));
        if (it.x) kids.push(el('button', { class: 'x', 'data-pact': 'prompt-del', 'data-id': it.id, title: '删除', text: '✕' }));
        p.appendChild(el('div', { class: 'cmp-item', 'data-pact': it.act, 'data-id': it.id || '' }, kids));
      })(items[i]);
    }
    p.hidden = false;
  }
  function openHandoff(){
    var box = el('div', { style: 'padding:18px 20px;min-width:300px' });
    box.appendChild(el('div', { style: 'font-size:14px;font-weight:600;margin-bottom:6px', text: '交接到哪个模式？' }));
    box.appendChild(el('div', { class: 'hint', style: 'display:block;margin-bottom:12px', text: '会新建一个会话，带上最近 10 条压缩上下文与产物清单；原会话保留不动。' }));
    var row = el('div', { class: 'f-actions', style: 'justify-content:flex-start' });
    ['chat', 'work', 'agent'].forEach(function(m){
      var b2 = el('button', { class: 'btn btn-sec', text: m.toUpperCase() });
      b2.addEventListener('click', function(){ closeModal(); HANDOFF.to(m); });
      row.appendChild(b2);
    });
    box.appendChild(row);
    openModal(box, false, true);
  }
  function popMore(){
    popMode = 'more';
    var items = [
      { t: (S.cfg.research ? '✓ 深度研究' : '深度研究'), p: '多地检索再写报告', act: 'go-research' },
      { t: '生成图片', p: '输入描述 → 生图', act: 'go-img' },
      { t: '生成视频', p: '需配置视频接口（Base / 模型）', act: 'go-video' },
      { t: (S.cfg.sttEnabled ? '✓ 语音输入 STT' : '语音输入 STT'), p: '麦克风转文字', act: 'go-stt' },
      { t: (S.cfg.ttsEnabled ? '✓ 语音合成 TTS' : '语音合成 TTS'), p: '朗读最后一条回复', act: 'go-tts' }
    ];
    items.push({ t: '/ 提示词库', p: (S.cfg.prompts || []).length + ' 条', act: 'go-prompt' });
    items.push({ t: '@ 导入历史会话', p: '并入当前会话', act: 'go-at' });
    items.push({ t: '交接会话', p: '带上文切换到另一个模式', act: 'go-handoff' });
    items.push({ t: '多智能体流水线', p: '方案 → 执行 → 验证 → 交付', act: 'go-pipe' });
    items.push({ t: '多智能体辩论', p: '三视角并行 + 裁判合并', act: 'go-debate' });
    items.push({ t: '工作流 · 生成页面', p: '生成→运行→自检重写→存盘', act: 'go-flow' });
    popItems(items, '更多');
  }
  function popPrompts(filter){
    popMode = 'prompt';
    filter = filter || '';
    var ps = S.cfg.prompts || [], items = [];
    for (var i = 0; i < ps.length; i++)
      if (!filter || ps[i].name.indexOf(filter) >= 0)
        items.push({ t: '/' + ps[i].name, p: ps[i].text.slice(0, 42), act: 'prompt-use', id: ps[i].name, x: true });
    popItems(items, '提示词（点击插入，✕ 删除；新建在 设置 → 提示词）');
  }
  function popAt(filter){
    popMode = 'at';
    filter = (filter || '').toLowerCase();
    var items = [];
    for (var i = 0; i < S.sessions.length; i++){
      var ss = S.sessions[i];
      if (ss.id === S.sid) continue;
      if (!filter || (ss.title || '').toLowerCase().indexOf(filter) >= 0)
        items.push({ t: ss.title || '未命名', p: (ss.msgCount || 0) + ' 条', act: 'at-use', id: ss.id });
      if (items.length >= 30) break;
    }
    popItems(items, '导入历史（并入当前会话，≤' + LIMITS.CTX_MSGS + ' 条）');
  }
  function importHistory(sid){
  if (!S.sid){ UI.toast('先在当前对话发一条消息，再导入历史（草稿态没有会话可挂）', true); return; } // v0.3.24：草稿态导入会写成 sid:null 的孤儿消息
    var src = null;
    for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].id === sid) src = S.sessions[i];
    if (!src) return;
    DB.msgsBySid(sid).then(function(list){
      var pick = list.sort(function(a, b){ return a.ts - b.ts; }).slice(-LIMITS.CTX_MSGS), copies = [];
      for (var j = 0; j < pick.length; j++)
        copies.push({ id: uuid(), sid: S.sid, role: pick[j].role, content: pick[j].content, status: 'ok', ts: pick[j].ts || Date.now(), attachments: [] });
      S.msgs = S.msgs.concat(copies);
      for (j = 0; j < copies.length; j++) DB.putMessage(copies[j]);
      renderMsgs();
      touchSession('（导入「' + (src.title || '历史会话') + '」）');
      closePop();
      maybeScroll(true);
      toast('已导入 ' + copies.length + ' 条历史消息');
    }, function(){ toast('读取历史会话失败', true); });
  }
  function cmpTrigger(){ // 输入首字符 / 或 @ 时唤出选择器
    var v = $input.value || '';
    /* v3.x：「/」交给统一扩展搜索面板（pk-slash），不再弹旧提示词库；@ 仍走导入历史 */
    if (v.charAt(0) === '/'){ if (popMode && popMode !== 'more') closePop(); return; }
    else if (v.charAt(0) === '@') popAt(v.slice(1));
    else if (popMode && popMode !== 'more') closePop();
  }
  function moreToggle(){ if (popMode === 'more') closePop(); else popMore(); }
  function popAct(pact, id){
    if (pact === 'prompt-del'){ S.cfg.prompts = (S.cfg.prompts || []).filter(function(x){ return x.name !== id; }); saveCfg(); popPrompts(''); return; }
    if (pact === 'prompt-use'){
      var p0 = (S.cfg.prompts || []).filter(function(x){ return x.name === id; })[0];
      if (p0){ $input.value = p0.text; autosize(); }
      closePop(); $input.focus(); return;
    }
    if (pact === 'go-research'){
      S.cfg.research = !S.cfg.research; saveCfg(); popMore();
      toast(S.cfg.research ? '深度研究：开（会多轮检索再写报告）' : '深度研究：关');
      return;
    }
    if (pact === 'go-img'){ closePop(); return openImgGen(); }
    if (pact === 'go-video'){ closePop(); return openVideoGen(); }
    if (pact === 'go-stt'){
      S.cfg.sttEnabled = !S.cfg.sttEnabled; saveCfg(); applyVoiceClasses(); popMore();
      if (S.cfg.sttEnabled && !(window.VOICE && VOICE.listenSupported && VOICE.listenSupported()))
        toast('浏览器不支持语音识别；可换用桌面版或 Chrome/Edge', true);
      else toast(S.cfg.sttEnabled ? '语音输入：开（输入区显示麦克风）' : '语音输入：关');
      return;
    }
    if (pact === 'go-tts'){
      S.cfg.ttsEnabled = !S.cfg.ttsEnabled; saveCfg();
      try { if (window.SOUL && SOUL.setProfile) SOUL.setProfile({ voice: { enabled: !!S.cfg.ttsEnabled } }); } catch (e) {}
      applyVoiceClasses(); popMore();
      if (!S.cfg.ttsEnabled && window.VOICE) VOICE.stop();
      if (S.cfg.ttsEnabled && !(window.VOICE && VOICE.speakSupported && VOICE.speakSupported()))
        toast('当前环境不支持语音合成', true);
      else toast(S.cfg.ttsEnabled ? '语音合成：开（输入区显示朗读按钮）' : '语音合成：关');
      return;
    }
    if (pact === 'go-handoff'){ closePop(); return openHandoff(); }
    if (pact === 'go-pipe'){ closePop(); return ORCH.pipeline(); }
    if (pact === 'go-debate'){ closePop(); return ORCH.debate(); }
    if (pact === 'go-flow'){ closePop(); return ORCH.flow(); }
  if (pact === 'go-prompt') return popPrompts('');
    if (pact === 'go-at') return popAt('');
    if (pact === 'at-use') return importHistory(id);
  }
  /* —— 配置组操作（全局委托调用） —— */
  function presetModels(list){
    var p = AP(); p.models = list;
    if (!p.currentModel || list.indexOf(p.currentModel) < 0) p.currentModel = list[0];
    mirrorPreset(); saveCfg(); renderComposerCtl();
  }
  /* v1.6：获取模型列表 → 多选清单（不自动全量填入）。模型池中已有的自动勾选，勾完点「填入模型池」写入文本框。 */
  function modelPicker(list){
    var box = $('#mdl-pick'); if (!box) return;
    var ap = AP(), have = {}, manual = {};
    (ap.models || []).forEach(function(x){ have[x] = 1; });
    list = list || [];
    var ids = list.slice();
    ids.sort(function(a, b){ return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' }); }); // v1.7：按首字母/数字自然排序
    ap.models.forEach(function(x){ // 池内有、接口未返回的手动条目也进清单（带「手动」角标），保证「填入=勾选内容」下不丢可见性
      if (list.indexOf(x) < 0){ ids.push(x); manual[x] = 1; }
    });
    box.textContent = '';
    box.hidden = false;
    var srch = el('input', { class: 'mdl-srch', type: 'text', placeholder: '搜索模型（输入即过滤，如 qwen）' }); // v1.7：顶部搜索
    var grid = el('div', { class: 'mdl-grid' });
    for (var i = 0; i < ids.length; i++){
      (function(id){
        var ck = el('input', { type: 'checkbox', value: id });
        if (have[id] || id === ap.currentModel) ck.checked = true; // 已在模型池/当前模型 → 自动勾选
        var kids = [ck, el('span', { text: id })];
        if (manual[id]) kids.push(el('i', { class: 'mdl-tag', text: '手动' }));
        grid.appendChild(el('label', { class: 'mdl-item', title: id + (manual[id] ? '（模型池手动条目，接口未返回）' : '') }, kids));
      })(ids[i]);
    }
    var cnt = el('span', { class: 'mdl-cnt' });
    function upd(){
      var q = (srch.value || '').toLowerCase().trim(), visN = 0, onN = 0,
          items = grid.querySelectorAll('.mdl-item');
      for (var j = 0; j < items.length; j++){
        var show = !q || items[j].title.toLowerCase().indexOf(q) >= 0; // title 含完整模型 id
        items[j].style.display = show ? '' : 'none';
        if (show){ visN++; if (items[j].querySelector('input').checked) onN++; }
      }
      cnt.textContent = '已勾选 ' + onN + ' / ' + ids.length + (visN < ids.length ? '（匹配 ' + visN + '）' : '');
      return onN;
    }
    srch.addEventListener('input', upd); // 输入即过滤
    grid.addEventListener('change', upd); // 勾选计数实时刷新（面板每次重建即重建，无监听残留）
    box.appendChild(srch); box.appendChild(grid);
    box.appendChild(el('div', { class: 'mdl-ops' }, [
      cnt,
      el('button', { class: 'btn btn-sec', 'data-m': 'mdl-all', text: '全选' }),
      el('button', { class: 'btn btn-sec', 'data-m': 'mdl-none', text: '清空' }),
      el('button', { class: 'btn btn-primary', 'data-m': 'mdl-apply', text: '填入模型池' })
    ]));
    upd();
    var ro = $('#ctx-ro'); if (ro) ro.value = ctxDisp(); // 获取时可能已探测出新窗口值
    try { box.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }
  function pickerAct(kind){
    var box = $('#mdl-pick'); if (!box) return;
    var items = box.querySelectorAll('.mdl-item'), i, it;
    if (kind === 'mdl-all' || kind === 'mdl-none'){
      var on = kind === 'mdl-all', onN = 0, visN = 0; // v1.7：搜索过滤时只作用于可见项
      for (i = 0; i < items.length; i++){
        if (items[i].style.display === 'none') continue;
        visN++;
        items[i].querySelector('input').checked = on;
        if (on) onN++;
      }
      var cn = box.querySelector('.mdl-cnt');
      if (cn) cn.textContent = '已勾选 ' + (on ? onN : 0) + ' / ' + items.length + (visN < items.length ? '（匹配 ' + visN + '）' : '');
      return;
    }
    /* mdl-apply：以勾选内容【替换】模型池（v1.7 修：原先保留池内未勾选的旧模型，清空不生效） */
    var sel = [];
    for (i = 0; i < items.length; i++){
      it = items[i].querySelector('input');
      if (it.checked) sel.push(it.value);
    }
    if (!sel.length){ toast('请先勾选要填入的模型', true); return; }
    presetModels(sel);
    var w = applyCtx(); // 按（可能已切换的）当前模型刷新自动探测的上下文上限
    openSettings();     // 重建弹层：刷新模型池文本框、模型下拉与上下文上限显示
    toast('已用 ' + sel.length + ' 个勾选模型替换模型池' + (w ? '，探测到上下文窗口 ' + w.toLocaleString() + ' tok' : ''));
  }
  function presetBtn(kind){
    var ps = S.cfg.presets || [];
    if (kind === 'new'){
      var nm = window.prompt('新配置名称（提供商/策略）', '配置' + (ps.length + 1));
      if (!nm) return;
      var np = { id: 'p' + Date.now().toString(36), name: nm, baseURL: '', apiKey: '', models: [], currentModel: '' };
      S.cfg.presets = ps.concat([np]);
      applyPreset(np.id); openSettings();
      toast('已新建「' + nm + '」，请填写 Base URL / Key');
    } else if (kind === 'rename'){
      var cp = AP(), nn = window.prompt('重命名配置', cp.name || '');
      if (!nn) return; cp.name = nn; saveCfg(); openSettings();
    } else if (kind === 'del'){
      if (ps.length <= 1){ toast('至少保留一个配置', true); return; }
      var gone = AP();
      S.cfg.presets = ps.filter(function(x){ return x.id !== gone.id; });
      Vault.clearPreset(gone.id); // Issue 14：同步清除该预置留在保险库的密钥，防残留
      try { sanitizePresetKeys(S.cfg); } catch (e) {} // v0.5.8：剩下的配置里若有别人家的 Key，一并清掉
      applyPreset(S.cfg.presets[0].id); openSettings();
      toast('已删除「' + (gone.name || '') + '」');
    }
  }
  /* —— 提示词卡片（设置页；对话侧只插入/删除） —— */
  function promptCard(m, b){
    var ed = $('#p-editor'); if (!ed) return;
    if (m === 'p-new'){ ed.textContent = ''; ed.appendChild(S._pEditor(null)); $('#p-ed-name').focus(); return; }
    if (m === 'p-ed-cancel'){ ed.textContent = ''; return; }
    if (m === 'p-ed-open'){
      var ix = +b.getAttribute('data-i');
      ed.textContent = ''; ed.appendChild(S._pEditor((S.cfg.prompts || [])[ix], ix));
      $('#p-ed-name').focus(); return;
    }
    if (m === 'p-ed-save'){
      var nm2 = $('#p-ed-name').value.trim(), tt2 = $('#p-ed-text').value.trim(), s = b.getAttribute('data-i');
      if (!nm2 || !tt2){ toast('名称与内容都要填写', true); return; }
      var arr = (S.cfg.prompts || []).slice();
      if (s !== '') arr[+s] = { name: nm2, text: tt2 };
      else { arr = arr.filter(function(x){ return x.name !== nm2; }); arr.push({ name: nm2, text: tt2 }); }
      setCfg({ prompts: arr }); ed.textContent = ''; S._pRefresh(); toast('已保存提示词');
      return;
    }
    if (m === 'p-view'){
    var ix4 = +b.getAttribute('data-i');
    var pr4 = (S.cfg.prompts || [])[ix4];
    if (!pr4) return;
    clearDetails(null);
    ed.textContent = '';
    ed.appendChild(detailBox({ title: '/' + pr4.name, blocks: [
      { k: '正文', v: pr4.text || '' },
      { k: '来源包', v: pr4.pkg ? (pr4.pkg + (pr4.pkgVer ? '（' + pr4.pkgVer + '）' : '')) : '（手工添加，无包）' },
      { k: '插入方式', v: '对话里输入 /' + pr4.name + ' 回车，整段插进输入框' },
      { k: '导出结构', v: 'prompts/' + pr4.name + '.md' }
    ] }));
    return;
  }
  if (m === 'p-export'){
    var ix3 = +b.getAttribute('data-i');
    var pr3 = (S.cfg.prompts || [])[ix3];
    if (!pr3) return;
    try { savePkg(EXT.exportPrompt(pr3.name)); }
    catch(e){ toast('导出失败：' + (e && e.message || e), true); }
    return;
  }
  if (m === 'p-del'){
      var a2 = (S.cfg.prompts || []).slice(); a2.splice(+b.getAttribute('data-i'), 1);
      setCfg({ prompts: a2 }); S._pRefresh(); return;
    }
  }
  /* ---------- 生图（P2） ---------- */
  function revokeImgFrames(card){
    if (!card) return;
    var urls = card._frameUrls || [];
    for (var i = 0; i < urls.length; i++){ try { URL.revokeObjectURL(urls[i]); } catch(e){} }
    card._frameUrls = [];
  }
  function openImgGen(){
    if (typeof IMG === 'undefined' || !IMG.available()){
      UI.toast('先在设置里配置连接', true);
      return;
    }
    var ta = el('textarea', { class: 'f-in', rows: '4', placeholder: '描述你想画的画面…', style: 'width:100%;min-height:90px;resize:vertical' });
    var sz = el('select', { class: 'f-in' });
    ['1024x1024','1024x1536','1536x1024'].forEach(function(v){
      sz.appendChild(el('option', { value: v, text: v, selected: (S.cfg.imgSize || '1024x1024') === v ? '' : null }));
    });
    var nn = el('select', { class: 'f-in' });
    [1,2].forEach(function(v){ nn.appendChild(el('option', { value: String(v), text: String(v) })); });
    var box = el('div', { class: 'img-gen-modal' }, [
      el('h3', { text: '生成图片' }),
      el('div', { class: 'f-row' }, [el('label', { text: '提示词' }), ta]),
      el('div', { class: 'f-row f-row-2' }, [
        el('div', {}, [el('label', { text: '尺寸' }), sz]),
        el('div', {}, [el('label', { text: '张数' }), nn])
      ]),
      el('div', { class: 'f-actions' }, [
        el('button', { class: 'btn btn-sec', type: 'button', text: '取消', 'data-m': 'close' }),
        el('button', { class: 'btn btn-primary', type: 'button', text: '生成', id: 'img-gen-go' })
      ])
    ]);
    UI.openModal(box);
    setTimeout(function(){ try { ta.focus(); } catch(e){} }, 0);
    var go = box.querySelector('#img-gen-go');
    if (go) go.addEventListener('click', function(){
      var prompt = String(ta.value || '').trim();
      if (!prompt){ UI.toast('请输入描述', true); return; }
      UI.closeModal();
      startImgGen(prompt, sz.value, parseInt(nn.value, 10) || 1);
    });
  }
  /* v0.4.2：生成视频（最小可用）——配置 Base / 模型 / 尺寸 / 秒数，结果只接受 https 或相对地址 */
  function videoDisplayUrl(u){
    u = String(u || '').trim();
    if (!u) return '';
    if (/^https:\/\//i.test(u)) return /\.(mp4|webm|ogv|mov|m4v)(\?\S*)?$/i.test(u) ? u : u + '#solo-video.mp4';
    if (/^\/(?!\/)/.test(u)) return /\.(mp4|webm|ogv|mov|m4v)(\?\S*)?$/i.test(u) ? u : u + '#solo-video.mp4';
    return '';
  }
  function openVideoGen(){
    var vp = (window.SOUL && SOUL.profile) ? SOUL.profile() : null;
    var va = (vp && vp.abilities) || {};
    var ta = el('textarea', { class: 'f-in', rows: '4', placeholder: '描述你想生成的视频画面、镜头和动作…', style: 'width:100%;min-height:90px;resize:vertical' });
    var base = el('input', { class: 'f-in', type: 'text', value: S.cfg.videoBase || va.videoBase || '', placeholder: 'https://api.example.com/v1' });
    var model = el('input', { class: 'f-in', type: 'text', value: S.cfg.videoModel || va.videoModel || '', placeholder: '如 sora-2 / veo-3 / kling-v2' });
    var sz = el('select', { class: 'f-in' });
    ['1280x720','720x1280','1024x1024','1920x1080'].forEach(function(v){
      sz.appendChild(el('option', { value: v, text: v, selected: (S.cfg.videoSize || '1280x720') === v ? '' : null }));
    });
    var sec = el('input', { class: 'f-in', type: 'number', min: '1', max: '60', step: '1', value: String(S.cfg.videoSeconds || 5) });
    var box = el('div', { class: 'img-gen-modal' }, [
      el('h3', { text: '生成视频' }),
      el('div', { class: 'f-row' }, [el('label', { text: '提示词' }), ta]),
      el('div', { class: 'f-row f-row-2' }, [
        el('div', {}, [el('label', { text: '尺寸' }), sz]),
        el('div', {}, [el('label', { text: '秒数' }), sec])
      ]),
      el('div', { class: 'f-row' }, [el('label', { text: '视频接口 Base URL（留空则不可用；Key 跟随当前 API Key）' }), base]),
      el('div', { class: 'f-row' }, [el('label', { text: '视频模型' }), model]),
      el('div', { class: 'soul-note', text: '接口按 /videos/generations 调用；返回 {url} 或 {id} 时自动轮询。只显示 https 或相对地址的结果，失败会明确报错，不生成假视频。' }),
      el('div', { class: 'f-actions' }, [
        el('button', { class: 'btn btn-sec', type: 'button', text: '取消', 'data-m': 'close' }),
        el('button', { class: 'btn btn-primary', type: 'button', text: '生成', id: 'video-gen-go' })
      ])
    ]);
    UI.openModal(box);
    setTimeout(function(){ try { ta.focus(); } catch(e){} }, 0);
    var go = box.querySelector('#video-gen-go');
    if (go) go.addEventListener('click', function(){
      var prompt = String(ta.value || '').trim();
      if (!prompt){ UI.toast('请输入视频描述', true); return; }
      var vb = String(base.value || '').trim(), vm = String(model.value || '').trim();
      if (!vb){ UI.toast('请先填写视频接口 Base URL（也可在 Soul 人格设置 → 能力里配置）', true); return; }
      setCfg({ videoBase: vb, videoModel: vm, videoSize: sz.value, videoSeconds: Math.max(1, Math.min(60, parseInt(sec.value, 10) || 5)), soulProfile: (function(){
        if (!window.SOUL || !SOUL.profile) return S.cfg.soulProfile;
        var p = SOUL.profile(); p.abilities.videoBase = vb; p.abilities.videoModel = vm; return p;
      })() });
      saveCfg();
      UI.closeModal();
      startVideoGen(prompt, { size: sz.value, seconds: Math.max(1, Math.min(60, parseInt(sec.value, 10) || 5)) });
    });
  }
  function startVideoGen(prompt, opt){
    if (typeof VIDEO === 'undefined'){ UI.toast('视频模块未加载', true); return; }
    if (!VIDEO.available()){ UI.toast('先在 +更多 → 生成视频 里配置视频接口 Base', true); return; }
    opt = opt || {};
    var s = curSession() || createSession('视频生成');
    var userMsg = { id: uuid(), sid: s.id, role: 'user', content: prompt, status: 'ok', ts: Date.now(), attachments: [] };
    var asstMsg = { id: uuid(), sid: s.id, role: 'assistant', content: '视频生成中…', status: 'streaming', ts: Date.now(), attachments: [] };
    S.msgs.push(userMsg); S.msgs.push(asstMsg);
    try { DB.putMessage(userMsg).catch(function(){}); } catch(e){}
    try { DB.putMessage(asstMsg).catch(function(){}); } catch(e){}
    try { if (typeof DB.putSession === 'function' && s) DB.putSession(s).catch(function(){}); } catch(e){}
    touchSession(prompt.slice(0, 18));
    appendMsgNode(userMsg); appendMsgNode(asstMsg);
    updateEmpty();
    maybeScroll(true);
    VIDEO.generate({
      prompt: prompt,
      size: opt.size || S.cfg.videoSize || '1280x720',
      seconds: opt.seconds || S.cfg.videoSeconds || 5,
      onFrame: function(st){
        asstMsg.content = '视频生成中…' + (st ? '（' + st + '）' : '');
        try { DB.putMessage(asstMsg).catch(function(){}); } catch(e){}
        repaintMsg(asstMsg.id);
      },
      onDone: function(url){
        var show = videoDisplayUrl(url);
        if (!show){
          asstMsg.status = 'error'; asstMsg.errMsg = '接口返回了非 https / 相对地址，已拒绝显示：' + String(url || '').slice(0, 200); asstMsg.content = '';
          try { DB.putMessage(asstMsg).catch(function(){}); } catch(e){}
          repaintMsg(asstMsg.id);
          UI.toast('视频地址不安全（只允许 https / 相对地址）', true);
          return;
        }
        asstMsg.status = 'ok'; asstMsg.errMsg = ''; asstMsg.content = '已生成视频：' + prompt + '\n\n' + show + '\n';
        try { DB.putMessage(asstMsg).catch(function(){}); } catch(e){}
        repaintMsg(asstMsg.id);
        maybeScroll(true);
      },
      onError: function(e){
        asstMsg.status = 'error'; asstMsg.errMsg = (e && e.message) || String(e); asstMsg.content = '';
        try { DB.putMessage(asstMsg).catch(function(){}); } catch(e2){}
        repaintMsg(asstMsg.id);
        UI.toast('视频生成失败：' + asstMsg.errMsg, true);
      }
    });
  }
  function startImgGen(prompt, size, n, targetId){
    if (typeof IMG === 'undefined'){ UI.toast('生图模块未加载', true); return; }
    var s = curSession() || createSession('图片生成');
    var asstMsg = null;
    if (targetId){
      var idx = findMsg(targetId);
      if (idx >= 0) asstMsg = S.msgs[idx];
    }
    if (!asstMsg){
      var userMsg = { id: uuid(), sid: s.id, role: 'user', content: prompt, status: 'ok', ts: Date.now(), attachments: [], imgAsk: 1 };
      asstMsg = { id: uuid(), sid: s.id, role: 'assistant', content: '', status: 'streaming', ts: Date.now(), attachments: [],
        imgCard: { prompt: prompt, frames: [], final: '' } };
      S.msgs.push(userMsg);
      S.msgs.push(asstMsg);
      try { DB.putMessage(userMsg).catch(function(){}); } catch(e){}
      try { DB.putMessage(asstMsg).catch(function(){}); } catch(e){}
      try { if (typeof DB.putSession === 'function' && s) DB.putSession(s).catch(function(){}); } catch(e){}
      touchSession(prompt.slice(0, 18));
      appendMsgNode(userMsg);
      appendMsgNode(asstMsg);
      updateEmpty();
    } else {
      revokeImgFrames(asstMsg.imgCard);
      if (asstMsg.imgCard && asstMsg.imgCard._finalUrl){ try { URL.revokeObjectURL(asstMsg.imgCard._finalUrl); } catch(e){} asstMsg.imgCard._finalUrl = ''; }
      asstMsg.status = 'streaming';
      asstMsg.errMsg = '';
      asstMsg.attachments = [];
      asstMsg.content = '';
      asstMsg.imgCard = { prompt: prompt, frames: [], final: '' };
      try { DB.putMessage(asstMsg).catch(function(){}); } catch(e){}
      repaintMsg(asstMsg.id);
    }
    maybeScroll(true);
    var runOne = function(i, done){
      IMG.generate({
        prompt: prompt,
        size: size || S.cfg.imgSize || '1024x1024',
        n: 1,
        partial: S.cfg.imgPartial != null ? S.cfg.imgPartial : 2,
        onPartial: function(blob){
          if (!blob) return;
          var card = asstMsg.imgCard;
          if (!card) return;
          var url = URL.createObjectURL(blob);
          card._frameUrls = card._frameUrls || [];
          card._frameUrls.push(url);
          while (card._frameUrls.length > 3){
            var old = card._frameUrls.shift();
            try { URL.revokeObjectURL(old); } catch(e){}
          }
          repaintMsg(asstMsg.id);
        },
        onFinal: function(blob){
          if (!blob){
            asstMsg.status = 'error';
            asstMsg.errMsg = '未返回图片数据';
            try { DB.putMessage(asstMsg); } catch(e){}
            repaintMsg(asstMsg.id);
            if (done) done(new Error('no image'));
            return;
          }
          var aid = uuid();
          var name = 'gen-' + Date.now() + '.png';
          var att = { id: aid, sid: s.id, name: name, mime: 'image/png', blob: blob, ts: Date.now() };
          DB.putAttachment(att).then(function(){
            var card = asstMsg.imgCard || { prompt: prompt };
            revokeImgFrames(card);
            if (card._finalUrl){ try { URL.revokeObjectURL(card._finalUrl); } catch(e){} }
            card._finalUrl = URL.createObjectURL(blob);
            card.final = aid;
            asstMsg.imgCard = { prompt: prompt, final: aid, _finalUrl: card._finalUrl };
            asstMsg.attachments = [aid];
            asstMsg.status = 'ok';
            asstMsg.content = '';
            asstMsg.errMsg = '';
            var pmsg = null;
            try { pmsg = DB.putMessage(asstMsg); } catch(e){}
            if (pmsg && pmsg.then) pmsg.catch(function(){});
            try { if (typeof DB.putSession === 'function' && s) DB.putSession(s).catch(function(){}); } catch(e){}
            repaintMsg(asstMsg.id);
            maybeScroll(true);
            if (done) done(null);
          }).catch(function(e){
            // still show final from blob url
            var card = asstMsg.imgCard || { prompt: prompt };
            revokeImgFrames(card);
            card._finalUrl = URL.createObjectURL(blob);
            asstMsg.imgCard = { prompt: prompt, final: '', _finalUrl: card._finalUrl };
            asstMsg.status = 'ok';
            asstMsg.errMsg = '';
            try { DB.putMessage(asstMsg); } catch(e){}
            repaintMsg(asstMsg.id);
            if (done) done(null);
          });
        },
        onError: function(e){
          var card = asstMsg.imgCard;
          if (card) revokeImgFrames(card);
          asstMsg.status = 'error';
          asstMsg.errMsg = (e && e.message) ? e.message : String(e || '生成失败');
          try { DB.putMessage(asstMsg).catch(function(){}); } catch(e2){}
          repaintMsg(asstMsg.id);
          if (done) done(e);
        }
      });
    };
    if (n > 1){
      // generate first; for simplicity create additional messages for 2nd
      runOne(0, function(err){
        if (err) return;
        var asst2 = { id: uuid(), sid: s.id, role: 'assistant', content: '', status: 'streaming', ts: Date.now(), attachments: [],
          imgCard: { prompt: prompt, frames: [], final: '', _frameUrls: [] } };
        S.msgs.push(asst2);
        try { DB.putMessage(asst2); } catch(e){}
        appendMsgNode(asst2);
        var old = asstMsg; asstMsg = asst2;
        runOne(1, function(){ asstMsg = old; });
      });
    } else {
      runOne(0);
    }
  }
  function imgCopyPrompt(id){
    var i = findMsg(id); if (i < 0) return;
    var m = S.msgs[i];
    var p = (m.imgCard && m.imgCard.prompt) || m.content || '';
    copyText(p).then(function(){ UI.toast('已复制 prompt'); }).catch(function(){ UI.toast('复制失败', true); });
  }
  function imgDownload(id){
    var i = findMsg(id); if (i < 0) return;
    var m = S.msgs[i];
    function dlBlob(blob, name){
      if (!blob){ UI.toast('没有可下载的图片', true); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name || 'image.png';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ try { a.remove(); URL.revokeObjectURL(url); } catch(e){} }, 500);
    }
    var aid = (m.imgCard && m.imgCard.final) || (m.attachments && m.attachments[0]);
    if (aid){
      DB.getAttachment(aid).then(function(a){
        if (a && a.blob) dlBlob(a.blob, a.name || 'gen.png');
        else if (m.imgCard && m.imgCard._finalUrl) fetch(m.imgCard._finalUrl).then(function(r){ return r.blob(); }).then(function(b){ dlBlob(b, 'gen.png'); }).catch(function(){ UI.toast('下载失败', true); });
        else UI.toast('没有可下载的图片', true);
      }).catch(function(){ UI.toast('下载失败', true); });
      return;
    }
    if (m.imgCard && m.imgCard._finalUrl){
      fetch(m.imgCard._finalUrl).then(function(r){ return r.blob(); }).then(function(b){ dlBlob(b, 'gen.png'); }).catch(function(){ UI.toast('下载失败', true); });
      return;
    }
    UI.toast('没有可下载的图片', true);
  }
  function imgRegen(id){
    var i = findMsg(id); if (i < 0) return;
    var m = S.msgs[i];
    var prompt = (m.imgCard && m.imgCard.prompt) || '';
    if (!prompt){ UI.toast('没有可用的 prompt', true); return; }
    startImgGen(prompt, S.cfg.imgSize || '1024x1024', 1, m.id);
  }

  /* ==================================================================
     v3.0 模块（30 项改进）。全部为零依赖纯前端实现。
     ================================================================== */

  /* ---------- 通用小工具 ---------- */
  function download(name, text, mime){
    if (window.__SC_ANDROID__ && NET && NET.saveFile){
      NET.saveFile(name, text, mime || 'text/plain').then(function(r){
        toast('已保存到 ' + ((r && r.path) || name));
      }, function(e){ toast('保存失败：' + (e && e.message || e), true); });
      return;
    }
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name, style: 'display:none' });
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  function pickText(title, accept, cb){
    var inp = el('input', { type: 'file', style: 'display:none' });
    if (accept) inp.setAttribute('accept', accept);
    inp.addEventListener('change', function(){
      var f = inp.files && inp.files[0]; if (!f) return;
      f.text().then(function(t){ cb(t, f); }).catch(function(){ toast(title + '读取失败', true); });
      inp.remove();
    });
    document.body.appendChild(inp); inp.click();
  }

  /* ---------- #19 命令面板 ---------- */
  var PAL = (function(){
    var box = null, inp = null, list = null, items = [], sel = 0, shown = false;
    function score(q, t){
      t = String(t || '').toLowerCase();
      if (!q) return 1;
      if (t.indexOf(q) === 0) return 1000 - t.length;
      var k = t.indexOf(q);
      if (k > 0) return 500 - k;
      var i = 0, s = 0;                       /* 子序列匹配 */
      for (var j = 0; j < q.length; j++){
        while (i < t.length && t[i] !== q[j]) i++;
        if (i >= t.length) return 0;
        s += 10 - Math.min(9, i - j); i++;
      }
      return s;
    }
    function source(){
      var arr = [];
      arr.push({ pin: '动作', t: '新建对话', k: 'Ctrl+N', run: function(){ UI.newDraft(); } });
      if (S.msgs.length) arr.push({ pin: '动作', t: '重新生成本条回答', k: '', run: function(){
        var last = S.msgs[S.msgs.length - 1]; if (last) UI.regenMsg(last.id); } });
      if (S.msgs.length) arr.push({ pin: '动作', t: '导出完整备份（JSON）', k: '', run: function(){ doExport(); } /* v0.3.62：少的不是功能，是诚实——要 Markdown 用 /export */ });
      arr.push({ pin: '动作', t: '打开设置', k: 'Ctrl+,', run: function(){ openSettings(); } });
      arr.push({ pin: '动作', t: S.cfg.webSearch ? '关闭联网搜索' : '开启联网搜索', k: '', run: function(){
        setCfg({ webSearch: !S.cfg.webSearch }); toast('联网搜索：' + (S.cfg.webSearch ? '开' : '关')); } });
      arr.push({ pin: '动作', t: S.tempMode ? '关闭临时会话' : '开启临时会话', k: '', run: function(){ toggleTemp(); } });
      arr.push({ pin: '动作', t: '切换深浅色', k: '', run: function(){
        setCfg({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' }); applyTheme(); } });
      arr.push({ pin: '动作', t: '运行连接自检', k: '', run: function(){ runSelfCheck(); } });
      arr.push({ pin: '动作', t: '导出诊断包', k: '', run: function(){ doExportDiag(); } });
      arr.push({ pin: '动作', t: '查找（会话内搜索）', k: 'Ctrl+F', run: function(){ FIND.open(); } });
      for (var i = 0; i < (S.sessions || []).length && i < 60; i++){
        var s = S.sessions[i]; if (s.temp) continue;
        arr.push({ pin: '会话', t: s.title || '未命名会话', k: s.workspace ? '工作区' : '', run: (function(sid){
          return function(){ selectSession(sid); };
        })(s.id) });
      }
      for (var j = 0; j < (S.cfg.models || []).length; j++){
        var mid = S.cfg.models[j];
        arr.push({ pin: '模型', t: mid, k: mid === S.cfg.currentModel ? '当前' : '', run: (function(m){
          return function(){ setCfg({ currentModel: m }); mmUse(m); toast('已切换模型：' + m); };
        })(mid) });
      }
      for (var p = 0; p < (S.cfg.prompts || []).length; p++){
        var pr = S.cfg.prompts[p];
        arr.push({ pin: '提示词', t: pr.name, k: '', run: (function(txt){
          return function(){ $input.value = txt; autosize(); $input.focus(); };
        })(typeof EXT.resolve === 'function' ? EXT.resolve(pr.text, pr) : pr.text) });
      }
      var groups = ['连接与模型', '通用设置', '数据与维护', '快捷键', '提示词', '关于'];
      for (var g = 0; g < groups.length; g++)
        arr.push({ pin: '设置', t: groups[g], k: '', run: (function(gname){
          return function(){ openSettings(); setTimeout(function(){ setGroup(gname); }, 60); };
        })(groups[g]) });
      return arr;
    }
    function render(q){
      list.textContent = '';
      var all = items, scored = [];
      for (var i = 0; i < all.length; i++){
        var sc = Math.max(score(q, all[i].t), score(q, all[i].pin) - 400, 0);
        if (q && !sc) continue;
        scored.push({ it: all[i], sc: sc });
      }
      scored.sort(function(a, b){ return b.sc - a.sc; });
      scored = scored.slice(0, 40);
      items._view = scored.map(function(x){ return x.it; });
      if (!scored.length){ list.appendChild(el('div', { class: 'pal-empty', text: '没有匹配项' })); return; }
      sel = Math.min(sel, scored.length - 1);
      for (var k = 0; k < scored.length; k++){
        var it = scored[k].it;
        var node = el('div', { class: 'pal-item' + (k === sel ? ' sel' : ''), 'data-i': k }, [
          el('span', { class: 'pin', text: it.pin }),
          el('span', { text: it.t }),
          it.k ? el('span', { class: 'k', text: it.k }) : ''
        ]);
        list.appendChild(node);
      }
    }
    function ensure(){
      if (box) return;
      inp = el('input', { placeholder: '搜索会话、模型、提示词、设置项或动作…', spellcheck: 'false' });
      list = el('div', { class: 'pal-list' });
      box = el('div', { id: 'pal' }, [el('div', { class: 'pal-box' }, [inp, list])]);
      document.body.appendChild(box);
      box.addEventListener('mousedown', function(e){ if (e.target === box) close(); });
      inp.addEventListener('input', function(){ sel = 0; render(inp.value.trim().toLowerCase()); });
      list.addEventListener('mousedown', function(e){
        var it = e.target.closest('.pal-item'); if (!it) return;
        e.preventDefault(); fire(+it.getAttribute('data-i'));
      });
      /* 键盘/程序触发（click 而非 mousedown）也要能执行；fire 内部 250ms 去重防双触发 */
      list.addEventListener('click', function(e){
        var it = e.target.closest('.pal-item'); if (!it) return;
        fire(+it.getAttribute('data-i'));
      });
    }
    var _lastFire = 0;
    function fire(i){
      var now = Date.now();
      if (now - _lastFire < 250) return;
      _lastFire = now;
      var it = (items._view || [])[i]; if (!it) return;
      close(); setTimeout(function(){ try { it.run(); } catch (e) { toast('动作失败：' + e.message, true); } }, 30);
    }
    function open(){
      ensure(); items = source(); items._view = items; sel = 0;
      inp.value = ''; render(''); box.classList.add('show'); shown = true;
      setTimeout(function(){ inp.focus(); }, 20);
    }
    function close(){ if (box) box.classList.remove('show'); shown = false; }
    function isOpen(){ return shown; }
    function key(e){
      if (!shown) return false;
      var n = (items._view || []).length;
      if (e.key === 'Escape'){ close(); return true; }
      if (e.key === 'ArrowDown'){ sel = Math.min(n - 1, sel + 1); render(inp.value.trim().toLowerCase()); return true; }
      if (e.key === 'ArrowUp'){ sel = Math.max(0, sel - 1); render(inp.value.trim().toLowerCase()); return true; }
      if (e.key === 'Enter'){ fire(sel); return true; }
      return false;
    }
    return { open: open, close: close, isOpen: isOpen, key: key };
  })();

  /* ---------- #23 会话内搜索 ---------- */
  var FIND = (function(){
    var bar, inp, cnt, hits = [], idx = -1, on = false;
    function ensure(){
      if (bar) return;
      inp = el('input', { placeholder: '在会话内查找…', spellcheck: 'false' });
      cnt = el('span', { class: 'cnt', text: '' });
      bar = el('div', { id: 'find-bar' }, [
        inp, cnt,
        el('button', { class: 'btn btn-sec', 'data-f': 'prev', text: '↑' }),
        el('button', { class: 'btn btn-sec', 'data-f': 'next', text: '↓' }),
        el('button', { class: 'btn btn-sec', 'data-f': 'close', text: '✕' })
      ]);
      var sc = $('#msg-scroll');
      sc.parentNode.insertBefore(bar, sc);
      inp.addEventListener('input', function(){ scan(inp.value); });
      bar.addEventListener('click', function(e){
        var b = e.target.closest('[data-f]'); if (!b) return;
        var a = b.getAttribute('data-f');
        if (a === 'close') return close();
        step(a === 'next' ? 1 : -1);
      });
    }
    function clearMarks(){
      var ms = document.querySelectorAll('#msg-list mark.hit');
      for (var i = 0; i < ms.length; i++){
        var m = ms[i], p = m.parentNode;
        p.replaceChild(document.createTextNode(m.textContent), m);
        p.normalize();
      }
      hits = []; idx = -1;
    }
    function scan(q){
      clearMarks();
      if (!q){ cnt.textContent = ''; return; }
      var root = $('#msg-list'), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var nodes = [], t;
      while ((t = walker.nextNode())) if (t.nodeValue && t.nodeValue.trim()) nodes.push(t);
      var lq = q.toLowerCase();
      for (var i = 0; i < nodes.length; i++){
        var node = nodes[i], txt = node.nodeValue, low = txt.toLowerCase(), from = 0;
        while (true){
          var k = low.indexOf(lq, from);
          if (k < 0) break;
          var r = document.createRange();
          r.setStart(node, k); r.setEnd(node, k + q.length);
          var mk = el('mark', { class: 'hit', text: txt.slice(k, k + q.length) });
          try { r.deleteContents(); r.insertNode(mk); } catch (e) { break; }
          hits.push(mk);
          node = mk.nextSibling;                         /* 继续在剩下的文本节点里找 */
          if (!node || node.nodeType !== 3) break;
          txt = node.nodeValue; low = txt.toLowerCase(); from = 0;
        }
      }
      cnt.textContent = hits.length ? '0/' + hits.length : '无结果';
      idx = -1;
      if (hits.length) step(1);
    }
    function step(d){
      if (!hits.length) return;
      if (idx >= 0 && hits[idx]) hits[idx].classList.remove('cur');
      idx = (idx + d + hits.length) % hits.length;
      var h = hits[idx];
      if (!h) return;
      h.classList.add('cur');
      try { h.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { h.scrollIntoView(); }
      cnt.textContent = (idx + 1) + '/' + hits.length;
    }
    function open(){ ensure(); bar.classList.add('show'); on = true; inp.focus(); inp.select(); }
    function close(){ if (!bar) return; clearMarks(); bar.classList.remove('show'); on = false; }
    function isOpen(){ return on; }
    function key(e){
      if (e.key === 'Escape' && on){ close(); return true; }
      if (e.key === 'F3' && on){ step(1); return true; }
      return false;
    }
    return { open: open, close: close, isOpen: isOpen, key: key, rescan: function(){ if (on) scan(inp.value); } };
  })();

  /* ---------- #22 主页最近会话 ---------- */
  function recentRow(n){
    var arr = (S.sessions || []).filter(function(s){ return !s.temp; }).slice(0, n || 4);
    if (!arr.length) return null;
    var row = el('div', { class: 'e-recent' });
    arr.forEach(function(s){
      var b = el('button', { 'data-recent': s.id, type: 'button', title: s.title || '' }, [
        el('span', { class: 't', text: s.title || '未命名会话' }),
        el('span', { class: 'm', text: (s.mode || 'chat') + ' · ' + ago(s.updatedAt) })
      ]);
      b.addEventListener('click', function(){ selectSession(s.id); });
      row.appendChild(b);
    });
    return row;
  }

  /* ---------- #24 消息分支 ---------- */
  function forkFrom(id){
    var i = findMsg(id); if (i < 0) return;
    var cut = S.msgs.slice(0, i + 1).map(function(m){
      var c = {}; for (var k in m) c[k] = m[k];
      c.id = uuid(); /* v0.3.0：必须换 id，否则 putMessages 按主键覆写会把原会话的消息搬走 */
      delete c.usage; delete c.variants; delete c.vIdx;
      return c;
    });
    var s = createSession('分支：' + ((curSession() && curSession().title) || '会话'));
    cut.forEach(function(m){ m.sid = s.id; });
  S.msgs = cut.slice(); // v0.3.60：createSession 会清空 S.msgs，分支正文必须放回去，否则新会话是空主页
    s.msgCount = cut.length;
    DB.putMessages(cut).then(function(){
      s.updatedAt = Date.now();
      if (!s.temp) DB.putSession(s);
      renderSessions(); renderMsgs();
      toast('已从该条新开分支（' + cut.length + ' 条）');
    }).catch(function(e){ toast('分支创建失败：' + e.message, true); });
  }

  /* ---------- #17 Work 模板 ---------- */
  var TPL = {
    static: function(){
      return [
        { path: 'index.html', body: '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>页面</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<h1>Hello SoloChat</h1>\n<p>在这里写内容。</p>\n<script src="app.js"><\/script>\n</body>\n</html>\n' },
        { path: 'style.css', body: ':root{--fg:#141413;--bg:#faf9f5}\n*{box-sizing:border-box}\nbody{margin:0;padding:32px;font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg)}\nh1{margin:0 0 12px;font-size:24px}\n' },
        { path: 'app.js', body: 'console.log("ready");\n' }
      ];
    },
    spa: function(){
      return [
        { path: 'index.html', body: '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>单页应用</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<nav><button data-go="home">首页</button><button data-go="about">关于</button></nav>\n<main id="view"></main>\n<script src="app.js"><\/script>\n</body>\n</html>\n' },
        { path: 'style.css', body: 'body{margin:0;font:15px/1.6 system-ui,sans-serif;background:#faf9f5;color:#141413}\nnav{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid #e8e0d2}\nnav button{border:1px solid #e8e0d2;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer}\nmain{padding:24px}\n' },
        { path: 'app.js', body: 'const routes = { home: "<h1>首页</h1><p>欢迎。</p>", about: "<h1>关于</h1><p>单页应用模板。</p>" };\nconst view = document.getElementById("view");\nfunction go(name){ view.innerHTML = routes[name] || "<p>404</p>"; }\ndocument.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));\ngo("home");\n' }
      ];
    },
    chart: function(){
      return [
        { path: 'index.html', body: '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>图表</title>\n<style>body{margin:0;padding:24px;font:14px system-ui,sans-serif;background:#faf9f5;color:#141413}canvas{max-width:100%}</style>\n</head>\n<body>\n<h1>月度数据</h1>\n<canvas id="c" width="720" height="360"></canvas>\n<script src="app.js"><\/script>\n</body>\n</html>\n' },
        { path: 'app.js', body: 'const data = [12, 19, 8, 15, 22, 30, 18];\nconst cv = document.getElementById("c"), g = cv.getContext("2d");\nconst W = cv.width, H = cv.height, pad = 40, bw = (W - pad * 2) / data.length;\nconst max = Math.max(...data);\nfor (let i = 0; i < data.length; i++){\n  const h = (data[i] / max) * (H - pad * 2);\n  g.fillStyle = "#cc785c";\n  g.fillRect(pad + i * bw + 6, H - pad - h, bw - 12, h);\n  g.fillStyle = "#141413";\n  g.fillText(String(data[i]), pad + i * bw + 6, H - pad - h - 6);\n}\n' }
      ];
    }
  };
  function newFromTemplate(kind){
    var files = TPL[kind]; if (!files) return;
    files = files();
    var s = createSession('模板：' + ({ static: '静态页', spa: '单页应用', chart: '图表页' }[kind] || kind));
    var chain = Promise.resolve();
    files.forEach(function(f){
      chain = chain.then(function(){
        return DB.workfsPut({ id: s.id + '|' + f.path, sid: s.id, path: f.path,
          content: f.body, size: new Blob([f.body]).size, ts: Date.now(), vers: [] });
      });
    });
    chain.then(function(){
      RUNNER.renderWs();
      toast('已铺好 ' + files.length + ' 个模板文件，直接说需求即可');
    }, function(e){ toast('模板创建失败：' + (e && e.message || e), true); });
  }
  function applyFontScale(){
    var sc = parseFloat(S.cfg.fontScale) || 1;
    if (sc > 3) sc = sc / 100;            /* 兼容旧版按百分比存的 112 */
    if (sc < 0.7) sc = 0.7; if (sc > 1.6) sc = 1.6;
    document.documentElement.style.setProperty('--fs-scale', String(sc));
  }
  function applyAccent(){
    var a = S.cfg.accent || 'coral';
    var map = {
      coral: ['#cc785c', '#b0634a'],
      lavender: ['#6f6ae0', '#5b57c9'],
      teal: ['#2f9e8f', '#26877a'],
      amber: ['#c08a2e', '#a4741f']
    };
    var c = map[a] || map.coral;
    document.documentElement.style.setProperty('--primary', c[0]);
    document.documentElement.style.setProperty('--primary-dim', c[1]);
  }
  function setGroup(label){
    var bs = document.querySelectorAll('#modal .set-nav button');
    for (var i = 0; i < bs.length; i++)
      if ((bs[i].textContent || '').indexOf(label) >= 0){ bs[i].click(); return; }
  }

  /* ---------- #2 一键自检 ---------- */
  function runSelfCheck(){
    var box = el('div', {}, [
      el('h2', { text: '连接自检' }),
    ]);
    var host = el('div', {}); box.appendChild(host);
    box.appendChild(el('div', { class: 'f-actions' }, [
      el('button', { class: 'btn btn-sec', 'data-m': 'close', text: '关闭' })
    ]));
    openModal(box);
    var tests = [
      ['代理 / 直连', function(){
        if (!NET.bridge.ok) return Promise.resolve('浏览器模式：无宿主桥，代理不生效（桌面端才有意义）');
        return NET.raw({ url: 'https://www.gstatic.com/generate_204', method: 'GET', timeout: 12000 }).then(function(r){
          if (!r || r.status >= 400) throw new Error('HTTP ' + (r && r.status) + '（检查代理地址或直连例外）');
          return 'HTTP ' + r.status;
        });
      }],
      ['模型列表', function(){
        return NET.fetchModels().then(function(r){
          var n = (r && r.list || []).length;
          if (!n) throw new Error('未取到模型（检查 Base URL / Key / 代理）');
          return n + ' 个模型';
        });
      }],
      ['能力目录', function(){
        return NET.catalog().then(function(m){
          var n = 0; for (var k in m) n++;
          if (!n) throw new Error('目录为空（网络或代理）');
          return n + ' 条';
        });
      }],
      ['OCR', function(){
        if (!S.cfg.ocr) return Promise.resolve('未启用（跳过）');
        return OCR.test().then(function(t){ return '可用' + ((t || '').trim() ? '' : '（空结果）'); });
      }]
    ];
    var i = 0;
    function next(){
      if (i >= tests.length) return;
      var t = tests[i++], t0 = Date.now();
      var st = el('span', { class: 'st', text: '…' });
      var rs = el('span', { class: 'rs', text: '检测中' });
      host.appendChild(el('div', { class: 'chk-row' }, [st, el('span', { class: 'nm', text: t[0] }), rs]));
      var pr;
      try { pr = t[1](); } catch (e) { pr = Promise.reject(e); }
      pr.then(function(msg){
        st.textContent = '✓'; st.style.color = 'var(--ok, #3fb950)';
        rs.textContent = msg + ' · ' + (Date.now() - t0) + 'ms';
      }, function(e){
        st.textContent = '✗'; st.style.color = 'var(--danger)';
        rs.textContent = (e && e.message || e) + ' · ' + (Date.now() - t0) + 'ms';
      }).then(next);
    }
    next();
  }

  /* ---------- #3 存储用量 ---------- */
  function storagePanel(){
    var box = el('div', {}, [el('h2', { text: '存储用量' })]);
    var body = el('div', {}); box.appendChild(body);
    box.appendChild(el('div', { class: 'f-actions' }, [
      el('button', { class: 'btn btn-danger', 'data-m': 'purge-orphan', text: '清理孤立附件' }),
      el('button', { class: 'btn btn-sec', 'data-m': 'settings', text: '返回设置' }),
      el('button', { class: 'btn btn-sec', 'data-m': 'close', text: '关闭' })
    ]));
    openModal(box);
    render();
    function kb(n){ return (n / 1024 / 1024).toFixed(2) + ' MB'; }
    function render(){
      body.textContent = '';
      Promise.all([DB.allSessions(), DB.allAttachments(), DB.allWorkfs()]).then(function(r){
        var ses = r[0] || [], atts = r[1] || [], wfs = r[2] || [];
        var ids = {}; ses.forEach(function(s){ ids[s.id] = 1; });
        var aBytes = 0, orphan = [];
        atts.forEach(function(a){
          var sz = (a.blob && a.blob.size) || a.size || (a.text ? a.text.length : 0);
          aBytes += sz;
          if (a.sid && !ids[a.sid]) orphan.push(a.id);
        });
        var wBytes = 0;
        wfs.forEach(function(w){ wBytes += (w.content || '').length + (w.path || '').length; });
        body.appendChild(el('div', { class: 'kv' }, [el('span', { text: '会话' }), el('b', { text: String(ses.length) })]));
        body.appendChild(el('div', { class: 'kv' }, [el('span', { text: '附件' }), el('b', { text: atts.length + ' 个 · ' + kb(aBytes) })]));
        body.appendChild(el('div', { class: 'kv' }, [el('span', { text: '虚拟工作区文件' }), el('b', { text: wfs.length + ' 个 · ' + kb(wBytes) })]));
        body.appendChild(el('div', { class: 'kv' }, [el('span', { text: '孤立附件' }), el('b', { text: orphan.length + ' 个' })]));
        S._orphan = orphan;
        /* v3.0 #3：按会话排出占用前 20，长会话可压缩（只留最近 30 条 + 一条摘要占位） */
        var top = ses.slice().sort(function(a, b){ return (b.updatedAt || 0) - (a.updatedAt || 0); }).slice(0, 20);
        var attBySid = {};
        atts.forEach(function(a){
          var sz = (a.blob && a.blob.size) || a.size || (a.text ? a.text.length : 0);
          if (a.sid) attBySid[a.sid] = (attBySid[a.sid] || 0) + sz;
        });
        Promise.all(top.map(function(s){ return DB.msgsBySid(s.id); })).then(function(lists){
          var rows = [];
          for (var i = 0; i < top.length; i++){
            var ms = lists[i] || [], bytes = attBySid[top[i].id] || 0;
            for (var j = 0; j < ms.length; j++) bytes += (ms[j].content || '').length;
            rows.push({ s: top[i], n: ms.length, b: bytes });
          }
          rows.sort(function(a, b){ return b.b - a.b; });
          if (!rows.length) return;
          body.appendChild(el('div', { class: 'sub', style: 'margin-top:12px', text: '占用最大的会话（前 20）' }));
          rows.forEach(function(r){
            body.appendChild(el('div', { class: 'sc-row' }, [
              el('span', { class: 't', text: r.s.title || '未命名会话', title: r.s.title || '' }),
              el('span', { class: 'hint', text: r.n + ' 条 · ' + (r.b / 1024).toFixed(0) + ' KB' }),
              r.n > 40 ? el('button', { class: 'btn btn-ghost rn-mini', 'data-m': 'compress', 'data-id': r.s.id, text: '压缩' }) : ''
            ]));
          });
        });
        if (navigator.storage && navigator.storage.estimate)
          navigator.storage.estimate().then(function(est){
            var pct = est.quota ? est.usage / est.quota : 0;
            body.appendChild(el('div', { class: 'kv', style: 'margin-top:8px' }, [
              el('span', { text: '浏览器分配空间' }), el('b', { text: kb(est.usage || 0) + ' / ' + kb(est.quota || 0) })
            ]));
            var bar = el('div', { class: 'bar' }, [el('i', { style: 'width:' + Math.max(1, Math.round(pct * 100)) + '%' })]);
            body.appendChild(bar);
          });
      });
    }
    S._refreshStorage = render;
  }
  /* v3.0 #3：压缩单个长会话——保留最近 30 条，早前消息合并成一条摘要占位（不可逆，需二次确认） */
  function compressSession(sid){
    DB.msgsBySid(sid).then(function(ms){
      ms.sort(function(a, b){ return (a.ts || 0) - (b.ts || 0); });
      var keep = 30, dropN = ms.length - keep;
      if (dropN <= 10) return toast('消息不多，无需压缩');
      var drop = ms.slice(0, dropN);
      return confirmBox({
        title: '压缩会话',
        text: '将删除该会话最早的 ' + dropN + ' 条消息，保留最近 ' + keep + ' 条，并插入一条摘要占位。此操作不可撤销，确定继续？',
        okText: '压缩'
      }).then(function(ok){
        if (!ok) return;
        var head = (drop[0].content || '').replace(/\s+/g, ' ').slice(0, 40);
        var tail = (drop[drop.length - 1].content || '').replace(/\s+/g, ' ').slice(0, 40);
        var chain = Promise.resolve();
        drop.forEach(function(m){ chain = chain.then(function(){ return DB.delMessage(m.id); }); });
        chain = chain.then(function(){
          return DB.putMessage({
            id: uuid(), sid: sid, role: 'system', status: 'ok', ts: (drop[0].ts || Date.now()),
            content: '（已压缩 ' + dropN + ' 条早期消息：' + head + ' … ' + tail + '）', attachments: []
          });
        }).then(function(){
          return DB.msgsBySid(sid);
        }).then(function(now){
          var s = (S.sessions || []).filter(function(x){ return x.id === sid; })[0];
          if (s){ s.msgCount = now.length; DB.putSession(s); }
          toast('已压缩 ' + dropN + ' 条早期消息');
          if (sid === S.sid) renderMsgs();
          if (S._refreshStorage) S._refreshStorage();
        });
        return chain;
      });
    });
  }
  function purgeOrphans(){
    var ids = S._orphan || [];
    if (!ids.length) return toast('没有孤立附件');
    DB.delAttachments(ids).then(function(){
      toast('已清理 ' + ids.length + ' 个孤立附件');
      if (S._refreshStorage) S._refreshStorage();
    }, function(e){ toast('清理失败：' + (e && e.message || e), true); });
  }

  /* ---------- #4 配置快照 ---------- */
  function exportSnapshot(){
    var c = {}, skip = /(apiKey|token|secret|password)/i;
    /* v0.3.0：先深拷贝再剥离，否则 scrub 删的是活动配置里的密钥 */
    try { c = JSON.parse(JSON.stringify(S.cfg)); } catch (e) { c = {}; }
    for (var k0 in c) if (skip.test(k0)) delete c[k0];
    /* presets 里也有 apiKey：深拷贝时递归剥离，避免密钥进快照文件 */
    (function scrub(v){
      if (!v || typeof v !== 'object') return v;
      for (var kk in v){
        if (skip.test(kk)) delete v[kk];
        else if (v[kk] && typeof v[kk] === 'object') scrub(v[kk]);
      }
      return v;
    })(c);
    var o = { app: 'SoloChat', v: 1, ts: Date.now(), cfg: c };
    download('solochat-快照-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(o, null, 2), 'application/json');
    toast('已导出配置快照（不含密钥）');
  }
  function importSnapshot(){
    pickText('配置快照', '.json,application/json', function(txt){
      var o;
      try { o = JSON.parse(txt); } catch (e) { return toast('不是合法的 JSON', true); }
      if (!o || !o.cfg) return toast('快照格式不正确', true);
      for (var k in o.cfg){
        if (/(apiKey|token|secret|password|^presets$|^maxTokens$)/i.test(k)) continue;
        S.cfg[k] = o.cfg[k];
      }
      saveCfg(); applyTheme(); applyAccent(); applyFontScale();
      renderSessions(); renderMsgs(); renderCtxRing(); renderComposerCtl();
      toast('已导入配置快照');
    });
  }

  /* ---------- 手机 ↔ 电脑 配置同步（关于页） ---------- */
  function cfgSyncScrub(v, keepKeys){
    if (!v || typeof v !== 'object') return v;
    for (var k in v){
      if (/(token|secret|password)/i.test(k)) delete v[k];
      else if (!keepKeys && /apiKey/i.test(k)) delete v[k];
      else if (v[k] && typeof v[k] === 'object') cfgSyncScrub(v[k], keepKeys);
    }
    return v;
  }
  function cfgSyncSnapshot(withKeys){
    var c = {};
    try { c = JSON.parse(JSON.stringify(S.cfg)); } catch (e) { c = {}; }
    if (Array.isArray(c.presets)) c.presets.forEach(function(p){ if (p && !withKeys) delete p.apiKey; });
    cfgSyncScrub(c, !!withKeys);
    delete c.presets; // 单独放，保持结构清晰
    var ps = [];
    try { ps = JSON.parse(JSON.stringify(S.cfg.presets || [])); } catch (e) { ps = []; }
    ps.forEach(function(p){ if (p && !withKeys) delete p.apiKey; });
    c.presets = ps;
    return { app: 'SoloChat', kind: 'config-sync', v: 1, ts: Date.now(), cfg: c };
  }
  function cfgSyncOut(){
    download('solochat-config-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify(cfgSyncSnapshot(), null, 2), 'application/json');
    toast('已导出本机配置（不含密钥）');
  }
  function cfgSyncFind(list, rp){
    for (var i = 0; i < list.length; i++){
      var lp = list[i];
      if (!lp) continue;
      if (lp.id && rp.id && lp.id === rp.id) return lp;
      if (lp.name && rp.name && lp.name === rp.name && (lp.baseURL || '') === (rp.baseURL || '')) return lp;
      if (lp.baseURL && rp.baseURL && lp.baseURL === rp.baseURL) return lp;
    }
    return null;
  }
  function cfgSyncMergePresets(mode, withKeys){
    var local = S.cfg.presets || [], remote = (cfgSyncRemote && cfgSyncRemote.presets) || [];
    if (!remote.length) return local;
    if (mode === 'remote'){
      return remote.map(function(rp){
        var lp = cfgSyncFind(local, rp);
        var np = JSON.parse(JSON.stringify(rp));
        np.apiKey = withKeys ? (rp.apiKey || (lp ? (lp.apiKey || '') : '')) : (lp ? (lp.apiKey || '') : '');
        return np;
      });
    }
    var out = local.map(function(p){ return JSON.parse(JSON.stringify(p)); });
    remote.forEach(function(rp){
      var lp = cfgSyncFind(out, rp);
      if (lp){
        for (var k in rp){
          if (k === 'apiKey'){
            if (withKeys && rp.apiKey) lp.apiKey = rp.apiKey;
            continue;
          }
          if (lp[k] == null || lp[k] === '' || (Array.isArray(lp[k]) && !lp[k].length)) lp[k] = rp[k];
        }
      } else {
        var np = JSON.parse(JSON.stringify(rp));
        np.apiKey = withKeys ? (rp.apiKey || '') : '';
        out.push(np);
      }
    });
    return out;
  }
  var cfgSyncRemote = null;
  function cfgSyncImport(mode){
    pickText(mode === 'remote' ? '选择对方的配置（以对方为准）' : '选择对方的配置（取并集）', '.json,application/json', function(txt){
      var o;
      try { o = JSON.parse(txt); } catch (e) { return toast('不是合法的 JSON', true); }
      if (!o || !o.cfg) return toast('配置文件格式不正确', true);
      cfgSyncRemote = JSON.parse(JSON.stringify(o.cfg));
      var skip = /(apiKey|token|secret|password|^presets$|^activePreset$|^maxTokens$)/i;
      for (var k in cfgSyncRemote){
        if (skip.test(k)) continue;
        if (mode === 'remote') S.cfg[k] = cfgSyncRemote[k];
        else if (S.cfg[k] == null || S.cfg[k] === '' || (Array.isArray(S.cfg[k]) && !S.cfg[k].length)) S.cfg[k] = cfgSyncRemote[k];
      }
      if (mode === 'union'){
        var s1 = (S.cfg.models || []).slice();
        (cfgSyncRemote.models || []).forEach(function(m){ if (s1.indexOf(m) < 0) s1.push(m); });
        S.cfg.models = s1;
        ['groups', 'prompts'].forEach(function(key){
          var cur = S.cfg[key] || [], rem = cfgSyncRemote[key] || [];
          rem.forEach(function(it){
            var id = it && (it.id || it.name);
            var hit = cur.some(function(x){ return x && (x.id || x.name) === id; });
            if (!hit) cur.push(it);
          });
          S.cfg[key] = cur;
        });
        if (cfgSyncRemote.modelMeta && typeof cfgSyncRemote.modelMeta === 'object'){
          S.cfg.modelMeta = S.cfg.modelMeta || {};
          for (var mk in cfgSyncRemote.modelMeta) if (!S.cfg.modelMeta[mk]) S.cfg.modelMeta[mk] = cfgSyncRemote.modelMeta[mk];
        }
      }
      S.cfg.presets = cfgSyncMergePresets(mode);
      var want = S.cfg.activePreset;
      var act = null;
      for (var i = 0; i < S.cfg.presets.length; i++) if (S.cfg.presets[i].id === want) act = S.cfg.presets[i];
      if (!act) act = S.cfg.presets[0] || null;
      if (act){ S.cfg.activePreset = act.id; S.cfg.apiKey = act.apiKey || ''; }
      saveCfg(); applyTheme(); applyAccent(); applyFontScale();
      renderSessions(); renderMsgs(); renderCtxRing(); renderComposerCtl();
      try { UI.openSettings(); } catch (e) {}
      toast(mode === 'remote' ? '已按对方配置覆盖（密钥需重填或沿用同名配置）' : '已合并配置（保留本机独有项）');
    });
  }

  /* v0.5.17：配对收到对象后直接应用，不经过文件选择器 */
  function cfgSyncApply(o, mode, withKeys){
    if (!o || !o.cfg) throw new Error('配置格式不正确');
    mode = (mode === 'remote') ? 'remote' : 'union';
    cfgSyncRemote = JSON.parse(JSON.stringify(o.cfg));
    var skip = withKeys ? /(token|secret|password|^presets$|^activePreset$|^maxTokens$)/i : /(apiKey|token|secret|password|^presets$|^activePreset$|^maxTokens$)/i;
    for (var k in cfgSyncRemote){
      if (skip.test(k)) continue;
      if (mode === 'remote') S.cfg[k] = cfgSyncRemote[k];
      else if (S.cfg[k] == null || S.cfg[k] === '' || (Array.isArray(S.cfg[k]) && !S.cfg[k].length)) S.cfg[k] = cfgSyncRemote[k];
    }
    if (mode === 'union'){
      var s1 = (S.cfg.models || []).slice();
      (cfgSyncRemote.models || []).forEach(function(m){ if (s1.indexOf(m) < 0) s1.push(m); });
      S.cfg.models = s1;
      ['groups', 'prompts'].forEach(function(key){
        var cur = S.cfg[key] || [], rem = cfgSyncRemote[key] || [];
        rem.forEach(function(it){
          var id = it && (it.id || it.name);
          var hit = cur.some(function(x){ return x && (x.id || x.name) === id; });
          if (!hit) cur.push(it);
        });
        S.cfg[key] = cur;
      });
      if (cfgSyncRemote.modelMeta && typeof cfgSyncRemote.modelMeta === 'object'){
        S.cfg.modelMeta = S.cfg.modelMeta || {};
        for (var mk in cfgSyncRemote.modelMeta) if (!S.cfg.modelMeta[mk]) S.cfg.modelMeta[mk] = cfgSyncRemote.modelMeta[mk];
      }
    }
    S.cfg.presets = cfgSyncMergePresets(mode, !!withKeys);
    var want = S.cfg.activePreset, act = null;
    for (var i = 0; i < S.cfg.presets.length; i++) if (S.cfg.presets[i].id === want) act = S.cfg.presets[i];
    if (!act) act = S.cfg.presets[0] || null;
    if (act){ S.cfg.activePreset = act.id; S.cfg.apiKey = act.apiKey || ''; }
    saveCfg(); applyTheme(); applyAccent(); applyFontScale();
    renderSessions(); renderMsgs(); renderCtxRing(); renderComposerCtl();
    return true;
  }

  /* ---------- #10 诊断包 ---------- */
  function doExportDiag(){
    var L = [];
    L.push('# SoloChat 诊断包 ' + new Date().toLocaleString());
    L.push('UA: ' + navigator.userAgent);
    L.push('主题: ' + resolvedTheme() + ' / 强调色: ' + (S.cfg.accent || 'coral') + ' / 模式: ' + S.cfg.mode);
    L.push('宿主桥: ' + (NET.bridge.ok ? 'OK' : '未连接'));
    L.push('Base URL: ' + (S.cfg.baseURL ? S.cfg.baseURL.replace(/\/\/([^/]+)/, '//$1') : '（未配置）'));
    L.push('API Key: ' + (S.cfg.apiKey ? '已配置（' + S.cfg.apiKey.length + ' 字符，已隐藏）' : '未配置'));
    L.push('代理: ' + (/^direct$/i.test(String(S.cfg.proxy || '')) ? '直连' : (S.cfg.proxy || '系统')) + ' / 直连例外: ' + (S.cfg.proxyDirect || '-'));
    L.push('当前模型: ' + (S.cfg.currentModel || '-') + ' / 池大小: ' + (S.cfg.models || []).length);
    var e = ctxEst();
    L.push('上下文估算: ' + e.tok + ' (缓存 ' + e.cache + ' + 未缓存历史 ' + e.uncached + ' + 输入 ' + (e.inp + e.att) + ' + 输出 ' + e.out + ')');
    L.push('会话数: ' + (S.sessions || []).length + ' / 当前消息数: ' + S.msgs.length);
    try {
      var cat = NET.catalogCached();
      var n = 0; for (var k in (cat || {})) n++;
      L.push('能力目录缓存: ' + n + ' 条 / ' + Math.round((localStorage.getItem('sc.cat.v1') || '').length / 1024) + ' KB');
    } catch (err) {}
    var side = window.SC && window.SC.lastErr ? window.SC.lastErr : '';
    if (side) L.push('最近错误: ' + side);
    L.push('—— 以下为配置键（不含值）——');
    L.push(Object.keys(S.cfg).join(', '));
    UI.download('solochat-diag-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.txt', L.join('\n'));
    toast('诊断包已导出');
  }

  /* 对外接口 */
  return {
    AP: AP, applyPreset: applyPreset, presetField: presetField, applyProv: applyProv,
    presetModels: presetModels, applyCtx: applyCtx, presetBtn: presetBtn, promptCard: promptCard,
    cfgSyncSnapshot: cfgSyncSnapshot, cfgSyncApply: cfgSyncApply,
    modelPicker: modelPicker, pickerAct: pickerAct,
    init: function(){
      $list = $('#session-list'); $scroll = $('#msg-scroll'); $empty = $('#empty');
      $input = $('#input'); $send = $('#btn-send'); $chips = $('#chips');
      $modal = $('#modal'); $panel = $('#modal-panel'); $title = $('#tb-title');
      applyTheme();
      applyAccent(); applyFontScale();
      document.body.classList.toggle('nowrap-code', !!S.cfg.codeNoWrap);
      $('#btn-web').classList.toggle('on', !!S.cfg.webSearch); // 刷新后恢复开关视觉态
/* v0.3.92：输入区扩展选择（智能体/插件/技能/工具/提示词/MCP）+ 「/」唤起面板 */
(function(){
  var KEY = { agent: '智能体', plugin: '插件', skill: '技能', tool: '工具', prompt: '提示词', mcp: 'MCP' };
  function picks(){ if (!S.cfg.picks) setCfg({ picks: { agent: [], plugin: [], skill: [], tool: [], prompt: [], mcp: [] } }); return S.cfg.picks || {}; }
  /* v0.4.0c：六类内容统一从扩展目录取（EXT.registry），这里只做分类与显示 */
  function list(kind){
    try {
      return EXT.registry().filter(function(x){ return x.kind === kind; })
        .map(function(x){ return { id: x.id, t: x.title || x.name, d: x.desc || '', modes: x.modes || [] }; });
    } catch (e) { return []; }
  }
  function refreshBadges(){
    var ps = picks();
    var bs = document.querySelectorAll('.pk-btn');
    for (var b = 0; b < bs.length; b++){
      var k = bs[b].getAttribute('data-pk'), n = (ps[k] || []).length, sp = bs[b].querySelector('.pk-badge');
      if (sp){ sp.hidden = !n; sp.textContent = String(n); }
      bs[b].classList.toggle('on', !!n);
    }
    var all = 0;
    for (var kk in ps) if (Object.prototype.hasOwnProperty.call(ps, kk)) all += (ps[kk] || []).length;
    var ab = document.getElementById('pk-all-badge'), abtn = document.getElementById('btn-pk-all');
    if (ab){ ab.hidden = !all; ab.textContent = String(all); }
    if (abtn) abtn.classList.toggle('on', !!all);
  }
  function toggle(kind, id){
    var ps = picks(); var arr = (ps[kind] || []).slice(); var at = arr.indexOf(id);
    if (at >= 0) arr.splice(at, 1); else arr.push(id);
    var nxt = {}; nxt[kind] = arr;
    var merged = {}; for (var k in ps) merged[k] = ps[k]; merged[kind] = arr;
    setCfg({ picks: merged }); refreshBadges();
  }
  function row(kind, it, multi){
    var ps = picks(); var on = (ps[kind] || []).indexOf(it.id) >= 0;
    var mode = S.cfg.mode || 'chat';
    var avail = !it.modes.length || it.modes.indexOf(mode) >= 0;
    var kids = [ el('span', { class: 'bx' }), el('span', { class: 'nm', text: it.t }) ];
    if (it.d) kids.push(el('span', { class: 'ds', text: it.d }));
    if (!avail) kids.push(el('span', { class: 'tag', text: it.modes.map(function(m){ return ({ chat: 'Chat', work: 'Work', agent: 'Agent' })[m] || m; }).join('/') }));
    var r = el('div', { class: 'pk-it' + (on ? ' on' : '') + (avail ? '' : ' off') }, kids);
    r.addEventListener('click', function(){ toggle(kind, it.id); r.classList.toggle('on'); });
    return r;
  }
  function panel(kind){
    var box = el('div', { class: 'pk-pop' });
    var items = list(kind);
    var hd = el('div', { class: 'pk-hd' }, [ el('b', { text: KEY[kind] }), el('span', { text: '（' + items.length + '）' }), el('span', { class: 'pk-clear', text: '清空' }) ]);
    hd.querySelector('.pk-clear').addEventListener('click', function(){ var ps = picks(); var merged = {}; for (var k in ps) merged[k] = ps[k]; merged[kind] = []; setCfg({ picks: merged }); refreshBadges(); box.remove(); });
    box.appendChild(hd);
    if (!items.length){ box.appendChild(el('div', { class: 'pk-it', style: 'cursor:default;color:var(--faint)', text: '（还没有）' })); return box; }
    items.forEach(function(it){ box.appendChild(row(kind, it)); });
    return box;
  }
  function closeAll(){ var ps = document.querySelectorAll('.pk-pop'); for (var i = 0; i < ps.length; i++) ps[i].remove(); }
  document.addEventListener('click', function(e){
    if (e.target.closest && (e.target.closest('.pk-pop') || e.target.closest('.pk-btn'))) return;
    closeAll();
  });
  document.addEventListener('click', function(e){
    /* 点面板内部不算「点按钮」——否则点一项就被当成再点一次按钮，面板立刻收起 */
    if (e.target.closest && e.target.closest('.pk-pop')) return;
    var b = e.target.closest && e.target.closest('.pk-btn'); if (!b) return;
    var open = b.querySelector('.pk-pop');
    closeAll();
    if (open) return;
    var pop = panel(b.getAttribute('data-pk')); b.appendChild(pop);
  });
  refreshBadges();
  /* 「/」统一扩展搜索：保留符号，按 / 后查询实时过滤全部 EXT.registry() */
  function cnOf(it){ return it.kind==='tool' ? (it.builtin?'内置工具':'工具') : (KEY[it.kind]||it.kind); }
  function slashRow(it){
    var ps=picks(), isP=it.kind==='prompt', on=!isP && (ps[it.kind]||[]).indexOf(it.id)>=0;
    var kids=[];
    if(!isP) kids.push(el('span',{class:'bx'}));
    kids.push(el('span',{class:'tag'+(it.builtin&&it.kind==='tool'?' bi':''),text:cnOf(it)}));
    kids.push(el('span',{class:'nm',text:it.title||it.name}));
    if(it.desc) kids.push(el('span',{class:'ds',text:String(it.desc).replace(/s+/g,' ').slice(0,64)}));
    var r=el('div',{class:'pk-it'+(on?' on':'')},kids);
    r.addEventListener('click',function(){
      if(isP){ $input.value=it.body||''; try{autosize();}catch(e){} closeAll(); $input.focus(); return; }
      toggle(it.kind,it.id); r.classList.toggle('on');
    });
    return r;
  }
  function slashFilter(box,q){
    var lst=box.querySelector('.pk-scroll'); if(!lst) return;
    while(lst.firstChild) lst.removeChild(lst.firstChild);
    q=String(q||'').trim().toLowerCase();
    var reg=[]; try{reg=EXT.registry();}catch(e2){}
    var shown=0;
    for(var i=0;i<reg.length&&shown<60;i++){
      var it=reg[i], hay=[it.name,it.title,it.desc,it.id,cnOf(it)].join(' ').toLowerCase();
      if(q && hay.indexOf(q)<0) continue;
      lst.appendChild(slashRow(it)); shown++;
    }
    if(!shown) lst.appendChild(el('div',{class:'pk-it',style:'cursor:default;color:var(--faint)',text:'没有匹配的扩展'}));
  }
  function slashPanel(){
    var box=el('div',{class:'pk-pop',id:'pk-slash'});
    box.appendChild(el('div',{class:'pk-head'},[el('b',{text:'本轮扩展'}),el('span',{text:'输入字母筛选全部扩展'})]));
    box.appendChild(el('div',{class:'pk-scroll'}));
    box.appendChild(el('div',{class:'pk-foot',text:'输入字母筛选 · Esc 关闭 · 点选加入本轮'}));
    return box;
  }
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape'||!document.querySelector('.pk-pop')) return;
    e.stopPropagation(); closeAll();
  });
  window.addEventListener('load',function(){
    var inp=document.getElementById('input'); if(!inp) return;
    inp.addEventListener('input',function(){
      var v=inp.value||'', cur=document.getElementById('pk-slash');
      if(v.charAt(0)==='/'){
        if(!cur){ closeAll(); cur=slashPanel(); (document.querySelector('.cbox')||document.body).appendChild(cur); }
        slashFilter(cur,v.slice(1));
      } else if(cur) cur.remove();
    });
  });
})();
      applyCtx(); // v1.6：启动即按已缓存的窗口映射/模型名规则刷新上下文上限（全自动，无需手动设置）
      metaLazy(); // v2.9：启动时用目录缓存补全当前模型能力（不联网）
      renderComposerCtl();
      on('cfg', renderComposerCtl); // 配置变化（含设置页编辑）同步输入区控件
      on('cfg', function(){ applyAccent(); applyFontScale(); document.body.classList.toggle('nowrap-code', !!S.cfg.codeNoWrap); });
      notifyQuickbar();
      notifyHotkey();
      renderSessions();
      renderMsgs();
      autosize();
    },
    lightbox: lightbox,
    toast: toast, applyTheme: applyTheme, openSettings: openSettings, closeModal: closeModal, holdBusy: holdBusy, routeHint: routeHint, hideRouteHint: hideRouteHint,
    modalOpen: modalOpen, confirmBox: confirmBox, renderSessions: renderSessions,
    renderMsgs: renderMsgs, selectSession: selectSession, createSession: createSession,
    deleteSession: deleteSession, deleteProject: deleteProject, renameInline: renameInline, sendMessage: sendMessage,
    sessCfgDlg: sessCfgDlg,
    groupDlg: groupDlg, delGroup: delGroup, newFromGroup: newFromGroup, /* session groups v0.4.2 */
    newDraft: newDraft, newFromProject: newFromProject,
    stopGeneration: stopGeneration, killStreams: killStreams, startStream: startStream, startStreamFor: startStreamFor, retryMsg: retryMsg,
    regenMsg: regenMsg, variantStep: variantStep, continueMsg: continueMsg, editMsg: editMsg, editSave: editSave,
    editCancel: editCancel, deleteMsg: deleteMsg, copyMsg: copyMsg, copyText: copyText,
    addFiles: addFiles, renderChips: renderChips, onScroll: onScroll,
    repaintMsg: repaintMsg, appendMsgNode: appendMsgNode,
    openImgGen: openImgGen, openVideoGen: openVideoGen, imgDownload: imgDownload, imgCopyPrompt: imgCopyPrompt, imgRegen: imgRegen,
    applyVoiceClasses: applyVoiceClasses,
    autosize: autosize, doExport: doExport, doImport: doImport, reloadSessions: reloadSessions,
    updateEmpty: updateEmpty, setSending: setSending, quickAsk: quickAsk, refreshFsRoots: refreshFsRoots,
    quickCmd: quickCmd, notifyQuickState: notifyQuickState, resetQuick: resetQuick,
    renderComposerCtl: renderComposerCtl, pickWorkspace: pickWorkspace, cmpTrigger: cmpTrigger, openHandoff: openHandoff,
    zipVfs: zipVfs, toggleTemp: toggleTemp, DUAL: DUAL,
    /* v2.9：模型池/能力表 */
    renderPool: renderPool, mmUse: mmUse, mmToggleCfg: mmToggleCfg, mmDelete: mmDelete, mmSave: mmSave,
    fillMetaFromCatalog: fillMetaFromCatalog, ctxDisp: ctxDisp, ctxLimitFor: ctxLimitFor, mMeta: mMeta,
    renderCtxRing: renderCtxRing, metaLazy: metaLazy,
    closePop: closePop, popOpen: popOpen, openModal: openModal, confirmBox: confirmBox,
    moreToggle: moreToggle, popAct: popAct, popPrompts: popPrompts, popAt: popAt, importHistory: importHistory,
    touchSession: touchSession, streamDelta: streamDelta,
    /* v3.0：命令面板 / 查找 / 分支 / 维护面板 */
    PAL: PAL, FIND: FIND, forkFrom: forkFrom, recentRow: recentRow,
    runSelfCheck: runSelfCheck, storagePanel: storagePanel, purgeOrphans: purgeOrphans,
    exportSnapshot: exportSnapshot, importSnapshot: importSnapshot, cfgSyncOut: cfgSyncOut, cfgSyncImport: cfgSyncImport, doExportDiag: doExportDiag,
    download: download, compressSession: compressSession,
    applyAccent: applyAccent, applyFontScale: applyFontScale, setGroup: setGroup,
    notifyQuickbar: notifyQuickbar, notifyHotkey: notifyHotkey,
    quickbarReady: function(){ QB_READY = true; notifyQuickbar(); }
  };
})();
/*  */
(function(){
  /* 委托① 侧栏 */
  /* v1.16：收起后的图标轨 */
(function(){
  var rail = document.getElementById('sb-rail');
  if (!rail) return;
  rail.addEventListener('click', function(e){
    var b = e.target.closest('[data-r]'); if (!b) return;
    var r = b.getAttribute('data-r');
    if (r === 'new'){ var n = document.getElementById('btn-new'); if (n) n.click(); return; }
    if (r === 'settings'){ UI.openSettings(); return; }
    if (r === 'expand'){ toggleSidebar('show'); return; }
    if (r === 'search'){ toggleSidebar('show'); setTimeout(function(){ var q = document.getElementById('sb-q'); if (q) q.focus(); }, 120); return; }
  });
})();
$('#sidebar').addEventListener('click', function(e){
    var t = e.target;
    if (t.closest('#btn-new')) return void UI.newDraft();
    if (t.closest('#btn-new-group')) return void UI.groupDlg(); /* session groups v0.4.2 */
    if (t.closest('#btn-settings')) return void UI.openSettings();
    /* session groups v0.4.2：分组头点击（先于文件夹项目判断，因为组头也是 .ss-proj） */
    var gEl = t.closest('[data-gid]');
    if (gEl){
      var gid = gEl.getAttribute('data-gid');
      if (t.closest('[data-gnew]')) return void UI.newFromGroup(gid);
      if (t.closest('[data-gcfg]')) return void UI.groupDlg(gid);
      if (t.closest('[data-gdel]')) return void UI.delGroup(gid);
      var gcMap = S.cfg.gClosed || (S.cfg.gClosed = {});
      if (gcMap[gid]) delete gcMap[gid]; else gcMap[gid] = 1;
      saveCfg(); UI.renderSessions();
      return;
    }
    var pj = t.closest('.ss-proj');
    if (pj){
      var pws = pj.getAttribute('data-pws');
      if (t.closest('[data-pnew]')) return void UI.newFromProject(pws);
      if (t.closest('[data-pdel]')) return void UI.deleteProject(pws);
      if (t.closest('[data-ppin]')){ // 项目置顶/取消（无确认）
        var pm = S.cfg.pinnedWs || (S.cfg.pinnedWs = {});
        if (pm[pws]) delete pm[pws]; else pm[pws] = 1;
        saveCfg();
        UI.renderSessions();
        return;
      }
      var closedMap = S.cfg.wsClosed || (S.cfg.wsClosed = {});
      if (closedMap[pws]) delete closedMap[pws]; else closedMap[pws] = 1; // 项目折叠/展开
      saveCfg();
      UI.renderSessions();
      return;
    }
    var actBtn = t.closest('[data-act]');
    var item = t.closest('.ss-item');
    if (actBtn && item){
      var sid = item.getAttribute('data-sid');
      var s = null;
      for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].id === sid) s = S.sessions[i];
      if (!s) return;
      var act = actBtn.getAttribute('data-act');
      if (act === 'pin'){
        s.pinned = !s.pinned;
        sortSessions();
        DB.putSession(s);
        UI.renderSessions();
      } else if (act === 'sesscfg'){
        UI.sessCfgDlg(s);
      } else if (act === 'rename'){
        UI.renameInline(item, s);
      } else if (act === 'del'){
        UI.deleteSession(sid);
      }
      return;
    }
    if (item){
      UI.selectSession(item.getAttribute('data-sid'));
    }
  });
  /* 侧栏搜索：委托在 #sidebar input 事件 */
  var sbqThrottle = throttle(function(){ UI.renderSessions(); }, 150);
  $('#sidebar').addEventListener('input', function(e){
    if (e.target.id === 'sb-q') sbqThrottle();
  });

  /* 委托② 消息区 */
  $('#msg-scroll').addEventListener('click', function(e){
    var t = e.target;
    if (t.closest('#btn-bottom')){
      S.follow = true;
      $('#msg-scroll').scrollTop = $('#msg-scroll').scrollHeight;
      $('#btn-bottom').classList.remove('show');
      return;
    }
    var fk = t.closest('[data-fork]');
    if (fk){ UI.forkFrom(fk.getAttribute('data-fork')); return; }
    var rb = t.closest('.code-run');
    if (rb){
      var rpre = rb.closest('pre') || rb.parentNode;
      var rcode = rpre.querySelector('code');
      RUNNER.run(rb.getAttribute('data-run'), rcode ? rcode.textContent : '');
      return;
    }
    /* v3.0 #20：下载代码 / 切换换行 / 工具卡片折叠 */
    var db_ = t.closest('.code-dl');
    if (db_){
      var dpre = db_.closest('pre'), dcode = dpre && dpre.querySelector('code');
      var dlang = dpre && dpre.querySelector('.lang');
      var ext = { javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py',
        html: 'html', css: 'css', json: 'json', bash: 'sh', sh: 'sh', shell: 'sh', c: 'c',
        cpp: 'cpp', java: 'java', sql: 'sql', xml: 'xml', yaml: 'yml', yml: 'yml', markdown: 'md', md: 'md' }[
        ((dlang && dlang.textContent) || '').trim().toLowerCase()] || 'txt';
      if (dcode) UI.download('code-' + Date.now().toString().slice(-6) + '.' + ext, dcode.textContent);
      return;
    }
    var wb = t.closest('.code-wrap');
    if (wb){
      setCfg({ codeNoWrap: !S.cfg.codeNoWrap });
      document.body.classList.toggle('nowrap-code', !!S.cfg.codeNoWrap);
      UI.toast('代码块换行：' + (S.cfg.codeNoWrap ? '关（横向滚动）' : '开'));
      return;
    }
    var zimg = t.closest('[data-zoom]');
    if (zimg){ UI.lightbox(zimg.getAttribute('data-zoom')); return; }
    var rv = t.closest('[data-reveal]');
    if (rv){ NET.revealPath(rv.getAttribute('data-reveal')); return; }
    var tc = t.closest('[data-tc]');
    if (tc){ tc.parentNode.classList.toggle('collapsed'); return; }
    var cp = t.closest('.code-copy');
    if (cp){
      var cpre = cp.closest('pre') || cp.parentNode;
      var code = cpre.querySelector('code');
      if (code) UI.copyText(code.textContent).then(function(){
        cp.classList.add('ok');
        setTimeout(function(){ cp.classList.remove('ok'); }, 1200);
      });
      return;
    }
    var b = t.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    switch (act){
      case 'earlier':
        S.windowSize += LIMITS.DOM_WINDOW;
        UI.renderMsgs();
        break;
      case 'fold': {
        var n = b.closest('.msg');
        n.classList.toggle('collapsed');
        b.textContent = n.classList.contains('collapsed') ? '展开全文' : '收起';
        break;
      }
      case 'copy': UI.copyMsg(id); break;
      case 'edit': UI.editMsg(id); break;
      case 'edit-save': UI.editSave(id); break;
      case 'edit-cancel': UI.editCancel(id); break;
      case 'delmsg': UI.deleteMsg(id); break;
        case 'retry': UI.retryMsg(id); break;
        case 'regen': UI.regenMsg(id); break;
        case 'varprev': UI.variantStep(id, -1); break;
        case 'varnext': UI.variantStep(id, 1); break;
      case 'continue': UI.continueMsg(id); break;
      case 'img-dl': UI.imgDownload(id); break;
      case 'img-regen': UI.imgRegen(id); break;
      case 'img-copy': UI.imgCopyPrompt(id); break;
      case 'canvas': if (window.CANVAS) window.CANVAS.fromMsg(id); break;
      case 'fs-apply': { var fa = b.closest('.msg'); if (fa) FS.apply(fa.getAttribute('data-id'), b.getAttribute('data-path'), b); break; }
        case 'fs-applyall': { var mm2 = b.closest('.msg'); if (mm2) FS.applyAll(mm2.getAttribute('data-id')); break; }
      case 'fs-reject': { var fr = b.closest('.msg'); if (fr) FS.reject(fr.getAttribute('data-id'), b.getAttribute('data-path')); break; }
  case 'fs-undo': { var fu = b.closest('.msg'); if (fu) FS.undo(fu.getAttribute('data-id'), b.getAttribute('data-path'), b); break; }
      case 'cfg': UI.openSettings(); break;
      case 'sug': { var si = $('#input'); si.value = b.getAttribute('data-v') || ''; UI.autosize(); si.focus(); break; }
      case 'mock':
        /* v0.4.x：演示走同一 setCfg，并重置协议/供应商/怪癖，避免残留上一预置的协议（P0） */
        setCfg({ baseURL: 'mock', models: ['mock-demo'], currentModel: 'mock-demo',
                 protocol: 'openai-chat', provId: '', quirks: {}, __flatOnly: true });
        UI.updateEmpty();
        UI.toast('已进入演示模式，直接发消息试试');
        break;
    }
  });
  $('#msg-scroll').addEventListener('scroll', UI.onScroll);

  /* 委托③ 输入区 */
  $('#composer').addEventListener('click', function(e){
    var t = e.target;
    if (t.closest('#btn-send')) return void UI.sendMessage(); // 生成中：同一按钮变停止键
    if (t.closest('#btn-attach')) return void $('#file-input').click();
    if (t.closest('#btn-img')) return void UI.openImgGen();
    if (t.closest('#btn-web')){
      var wb = t.closest('#btn-web');
      /* 打开前先检查配置：未配置就保持关闭，明确告知怎么配（不弹设置层，不打断会话） */
      if (!S.cfg.webSearch && !NET.searchReady()){
        wb.classList.remove('on');
        UI.toast('联网搜索未配置：设置 → 连接与模型 → 在线搜索，选择提供商并填 Key；自定义/SearXNG 填地址后才能用', true);
        return;
      }
      S.cfg.webSearch = !S.cfg.webSearch;
      saveCfg();
      wb.classList.toggle('on', S.cfg.webSearch);
      UI.toast(S.cfg.webSearch ? '联网搜索已开启' : '联网搜索已关闭');
      UI.notifyQuickState();
      return;
    }
    if (t.closest('#btn-more')) return void UI.moreToggle();
    if (t.closest('#btn-soul-profile')){
      if (window.SOUL && SOUL.openProfile) SOUL.openProfile();
      else UI.toast('人格组件未加载', true);
      return;
    }
    if (t.closest('#btn-stt')){
      var sb = t.closest('#btn-stt');
      if (!(window.VOICE && VOICE.listenSupported && VOICE.listenSupported()))
        return void UI.toast('当前浏览器不支持语音识别（STT）；桌面版/Chrome/Edge 可用', true);
      if (sb.getAttribute('data-on') === '1') return void UI.toast('正在听…说完会自动停');
      sb.setAttribute('data-on', '1');
      UI.toast('正在听…说完会自动停');
      VOICE.listen(function(txt){
        sb.removeAttribute('data-on');
        if (!txt) return;
        var inp = document.getElementById('input');
        if (!inp) return;
        var s0 = (typeof inp.selectionStart === 'number') ? inp.selectionStart : inp.value.length;
        var s1 = (typeof inp.selectionEnd === 'number') ? inp.selectionEnd : inp.value.length;
        inp.value = inp.value.slice(0, s0) + txt + inp.value.slice(s1);
        try { inp.selectionStart = inp.selectionEnd = s0 + txt.length; } catch (e) {}
        UI.autosize(); inp.focus();
      }).catch(function(e){
        sb.removeAttribute('data-on');
        UI.toast('语音识别失败：' + ((e && e.message) || e), true);
      });
      return;
    }
    if (t.closest('#btn-tts')){
      if (window.VOICE && VOICE.speakLast) VOICE.speakLast().catch(function(e){ UI.toast('朗读失败：' + ((e && e.message) || e), true); });
      else UI.toast('语音组件未加载', true);
      return;
    }
    if (t.closest('#btn-sesscfg')){ // session groups v0.4.2：发送前（草稿态）也能打开会话参数
      var cs = curSession();
      UI.sessCfgDlg(cs || null);
      return;
    }
    var pr = t.closest('[data-pact]');
    if (pr) return void UI.popAct(pr.getAttribute('data-pact'), pr.getAttribute('data-id') || '');
    var rm = t.closest('[data-act="rmchip"]');
    if (rm){
      var id = rm.getAttribute('data-id');
      S.pendAtts = S.pendAtts.filter(function(a){
        if (a.id === id){ if (a.url) URL.revokeObjectURL(a.url); return false; }
        return true;
      });
      UI.renderChips();
    }
  });
  /* 顶栏的会话参数按钮不在 #composer 内，单独绑定（v0.5.12 从输入框右下角挪到工作区右侧） */
  var _sessBtnTop = $('#btn-sesscfg');
  if (_sessBtnTop) _sessBtnTop.addEventListener('click', function(){
    var cs = curSession();
    UI.sessCfgDlg(cs || null);
  });
  /* 手机端单一「本轮扩展」按钮：插入 / 唤起统一扩展面板 */
  var _pkAll = $('#btn-pk-all');
  if (_pkAll) _pkAll.addEventListener('click', function(e){
    e.preventDefault(); e.stopPropagation();
    var pops = document.querySelectorAll('.pk-pop');
    for (var pi = 0; pi < pops.length; pi++) pops[pi].remove();
    var _inp = document.getElementById('input');
    if (!_inp) return;
    _inp.value = '/';
    _inp.dispatchEvent(new Event('input', { bubbles: true }));
    _inp.focus();
  });
  var _setBtnMobile = $('#btn-m-settings');
  if (_setBtnMobile) _setBtnMobile.addEventListener('click', function(e){
    e.preventDefault();
    e.stopPropagation();
    UI.openSettings();
  });
  var _draftSid = null;
    var saveDraft = debounce(function(){ var dsid = _draftSid || S.sid; if (dsid) S.drafts[dsid] = $('#input').value; }, 400); // v0.3.0：锁住触发时的会话
  $('#composer').addEventListener('input', function(e){
    if (e.target.id === 'input'){ UI.autosize(); _draftSid = S.sid; saveDraft(); UI.cmpTrigger(); UI.renderCtxRing(); }
  });
  $('#composer').addEventListener('keydown', function(e){
    if (e.target.id !== 'input') return;
    /* IME 组词 Enter 不触发发送 */
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape' && S.sending){ if (!document.querySelector('.pk-pop')) UI.stopGeneration(); return; } // 面板开着时 Esc 只收面板，别顺带把生成停了
    /* Enter 或 Ctrl+Enter 发送；Shift+Enter / Alt+Enter 换行（§8.1） */
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey){
      e.preventDefault();
      UI.sendMessage();
    } else if (e.key === 'ArrowUp' && !e.target.value){
      /* 空输入框按 ↑ 回填上一条（§8.1 快捷键表） */
      for (var i = S.msgs.length - 1; i >= 0; i--)
        if (S.msgs[i].role === 'user'){ e.target.value = S.msgs[i].content; UI.autosize(); break; }
      e.preventDefault();
    }
  });

  /* 委托④ window（顶栏/弹层/快捷键/粘贴拖放） */
  window.addEventListener('click', function(e){
    var t = e.target;
    /* 顶栏静态控件（window 委托） */
    if (t.closest('#btn-ws')) return void UI.pickWorkspace();
    /* v2.8：主页「临时会话」开关 */
    if (t.closest('#btn-temp')) return void UI.toggleTemp();
    /* 运行面板「工作区」区：预览/查看（v2.5 内置侧边栏浏览器） */
    var vpv = t.closest('[data-vpv]');
    if (vpv){
      if (!S.sid){ UI.toast('先开始一个会话', true); return; }
      var vpath = vpv.getAttribute('data-vpv');
      /* v0.9.7：所有类型都走 previewTo —— 它会自动切到「运行」标签，
         并复用 pvRender 的文本/源码样式（之前 src 类走 previewSource，不切标签） */
      RUNNER.previewTo(S.sid, vpath, true);
      return;
    }
    /* 运行面板「工作区」区：在沙箱运行该文件（v2.8） */
    var vrun = t.closest('[data-vrun]');
    if (vrun){
      if (!S.sid){ UI.toast('先开始一个会话', true); return; }
      RUNNER.runVfs(S.sid, vrun.getAttribute('data-vrun'));
      return;
    }
    /* v3.0 #15：回滚到上一个版本 */
    var vver = t.closest('[data-vver]');
    if (vver){
      var vpath2 = vver.getAttribute('data-vver');
      DB.workfsBySid(S.sid).then(function(fs){
        var rec = null;
        for (var i = 0; i < fs.length; i++) if (fs[i].path === vpath2) rec = fs[i];
        if (!rec || !rec.vers || !rec.vers.length){ UI.toast('没有可回滚的版本', true); return; }
        var last = rec.vers[rec.vers.length - 1];
        UI.confirmBox({ title: '回滚文件', text: '把 ' + vpath2 + ' 恢复到 ' + new Date(last.ts).toLocaleString() + ' 的版本？当前内容会成为新的历史版本。', okText: '回滚' })
          .then(function(ok){
            if (!ok) return;
            vfsWrite(S.sid, vpath2, last.content).then(function(){
              RUNNER.renderWs(); UI.toast('已回滚：' + vpath2);
            }, function(e){ UI.toast('回滚失败：' + (e && e.message || e), true); });
          });
      });
      return;
    }
    /* 运行面板「工作区」区：单文件下载（v2.1） */
    var vdl = t.closest('[data-vdl]');
    if (vdl){
      var fid = vdl.getAttribute('data-vdl');
      DB.workfsBySid(S.sid).then(function(fs){
        for (var i = 0; i < fs.length; i++) if (fs[i].id === fid){
          var f = fs[i], name = f.path.split('/').pop();
          /* 有 attachmentId 一律读附件原字节（文本/图片/二进制都走这条），不再只看 f.binary */
          if (f.attachmentId){
            DB.getAttachment(f.attachmentId).then(function(a){
              var src = a && (a.rawBlob || a.blob);
              if (src) ZIP.dl(src, name);
              else UI.toast('原文件已不存在（附件可能已删除）', true);
            }, function(e){ UI.toast('读取附件失败：' + (e && e.message || e), true); });
          } else {
            ZIP.dl(new Blob([f.content || ''], { type: 'text/plain;charset=utf-8' }), name);
          }
          return;
        }
        UI.toast('文件不存在（可能已删除）', true);
      });
      return;
    }

    var mb = t.closest('#seg-mode [data-mode]');
    if (mb){
      var _newMode = mb.getAttribute('data-mode');
      var _oldMode = S.cfg.mode;
      var _patch = { mode: _newMode, persona: '', modePin: true };
      if (_newMode === 'soul') _patch.picks = {}; /* Soul 自主使用全部扩展，清掉旧勾选 */
      setCfg(_patch);
      if (_newMode !== _oldMode) { try { RUNNER.closeWebSidebar(); } catch (e) {} }
      MODE.mountUI();
      UI.renderComposerCtl();
      UI.updateEmpty();
      return;
    }
    var pb = t.closest('#seg-mode [data-persona]');
    if (pb){
      var pid = pb.getAttribute('data-persona');
      var pp = MODE.persona(pid);
      setCfg({ persona: pid, mode: (pp && pp.base) || 'work', modePin: true });
      MODE.mountUI();
      UI.renderComposerCtl();
      UI.updateEmpty();
      return;
    }
    var wb = t.closest('#win-ctl [data-win]');
    if (wb){ if (NET.bridge.ok) NET.bridge.send({ t: 'win', act: wb.getAttribute('data-win') }); return; }
    if (!UI.modalOpen()) return;
    var accHead = t.closest('.acc-head');
    if (accHead){ accHead.parentNode.classList.toggle('open'); return; }
    if (t.classList && t.classList.contains('scrim')) return void UI.closeModal();
    var b = t.closest('[data-m]');
    if (!b) return;
    var m = b.getAttribute('data-m');
    if (m === 'close') UI.closeModal();
    /* session groups v0.4.2：分组弹层的保存/删除（回调在 groupDlg 里挂到 S） */
    else if (m === 'grp-save'){ if (S._grpSave) S._grpSave(); }
    else if (m === 'grp-del'){ if (S._grpDel) S._grpDel(); }
    else if (m === 'settings') UI.openSettings();
    else if (m === 'limits-mode-reset'){
      S.cfg.modeCfg = JSON.parse(JSON.stringify(DEF_CFG.modeCfg));
      saveCfg(); applyLimitCfg(S.cfg.mode); UI.openSettings(); UI.toast('模式参数已恢复默认');
    }
    else if (m === 'limits-tool-reset'){
      S.cfg.toolCfg = JSON.parse(JSON.stringify(DEF_CFG.toolCfg));
      saveCfg(); applyLimitCfg(S.cfg.mode); UI.openSettings(); UI.toast('工具参数已恢复默认');
    }
    else if (m === 'compress') UI.compressSession(b.getAttribute('data-id'));
    else if (m === 'open-data'){
      if (NET.bridge.ok) NET.bridge.send({ t: 'win', act: 'datadir' });
      else UI.toast('仅桌面端可打开数据目录', true);
    }
    else if (m === 'yes' || m === 'no'){
      var r = S._confirmRes; S._confirmRes = null;
      UI.closeModal();
      if (r) r(m === 'yes');
    }
    else if (m === 'theme'){
      setCfg({ theme: b.getAttribute('data-v') });
      UI.applyTheme();
      var seg = b.parentNode;
      for (var i = 0; i < seg.children.length; i++) seg.children[i].classList.remove('on');
      b.classList.add('on');
    }
    else if (m === 'sp'){ /* 设置分屏：左目录切换 */
      var nav = b.parentNode;
      for (var j = 0; j < nav.children.length; j++) nav.children[j].classList.remove('on');
      b.classList.add('on');
      var pg = b.getAttribute('data-sp');
      var pages = document.querySelectorAll('#modal .set-page');
      for (j = 0; j < pages.length; j++)
        pages[j].classList.toggle('on', pages[j].getAttribute('data-page') === pg);
    }
    else if (m.indexOf('preset-') === 0) UI.presetBtn(m.slice(7));
    else if (m === 'p-new' || m === 'p-ed-open' || m === 'p-ed-save' || m === 'p-ed-cancel' || m === 'p-del' || m === 'p-export' || m === 'p-view') UI.promptCard(m, b);
    else if (m === 'fetch-models'){
      b.disabled = true; b.textContent = '获取中…';
      NET.fetchModels().then(function(r){
        b.disabled = false; b.textContent = '获取列表';
        var list = r && r.list;
        if (!list){
          var info = r && r.err ? NET.classify(r.err) : null;
          var msg;
          if (info && info.code === '401') msg = info.msg;
          else if (info && info.code === '404') msg = '该服务商不提供模型列表接口（404）。如火山方舟，请直接在下方手动输入模型 ID（逗号分隔）';
          else msg = '获取失败：' + (info ? info.msg : '请检查 Base URL / Key');
          return void UI.toast(msg, true);
        }
        UI.applyCtx(r.ctx, r.meta);   // 缓存各模型窗口映射并即时刷新当前模型上限（v1.6 全自动探测）
        UI.modelPicker(list); // v1.6：不再一次性全部填入，弹出多选清单（池中已有的自动勾选）
        /* v2.9：并行走 models.dev 目录补全上下文/输出/输入类型/思考字段（失败静默） */
        UI.fillMetaFromCatalog(list, true).then(function(n){
          var ro = $('#ctx-ro'); if (ro) ro.value = UI.ctxDisp();
          if (n) UI.renderPool();
        });
        UI.toast('已获取 ' + list.length + ' 个模型，可搜索勾选后点「填入模型池」（将替换模型池）');
      });
    }
    else if (m === 'mdl-all' || m === 'mdl-none' || m === 'mdl-apply') UI.pickerAct(m);
    /* v2.9：模型池行内动作 */
    else if (m === 'mm-use') UI.mmUse(b.getAttribute('data-id'));
    else if (m === 'mm-cfg') UI.mmToggleCfg(b.getAttribute('data-id'));
    else if (m === 'mm-del') UI.mmDelete(b.getAttribute('data-id'));
    else if (m === 'bindkey'){
      S.recKey = b.getAttribute('data-k');
      S.recBtn = b;
      b.textContent = '按下组合键…';
    }
    else if (m === 'reset-keys'){
      setCfg({ shortcuts: { newSession: 'Ctrl+N', search: 'Ctrl+K', theme: '', sidebar: 'Ctrl+B', quickbar: 'Alt+Space',
        shotAsk: 'Alt+A',
        showMain: 'Ctrl+Alt+S', toggleMain: 'Ctrl+H', newGlobal: 'Ctrl+Alt+N', tempGlobal: 'Ctrl+Alt+T' } });
      UI.notifyHotkey();
      UI.openSettings();
    }
    else if (m === 'proxy-test'){ /* v1.5：代理连通性测试（经当前代理访问 gstatic 探测页） */
      b.disabled = true; b.textContent = '测试中…';
      var t0 = Date.now();
      function ptestDone(){ b.disabled = false; b.textContent = '测试连通性'; }
      if (!NET.bridge.ok) UI.toast('未检测到宿主：代理仅在宿主桥通道生效，浏览器直连无法指定代理', true);
      NET.raw({ url: 'https://www.gstatic.com/generate_204', method: 'GET', timeout: 15000 }).then(function(r){
        ptestDone();
        if (r.status === 204 || (r.status >= 200 && r.status < 400))
          UI.toast('代理可用（HTTP ' + r.status + '，' + (Date.now() - t0) + 'ms）');
        else UI.toast('代理返回 HTTP ' + r.status + '，请检查代理地址', true);
      }, function(err){
        ptestDone();
        UI.toast('测试失败：' + (err && err.message || err) + '（确认代理已启动、地址与端口正确）', true);
      });
    }
    else if (m === 'ocr-test'){ /* v1.5：用内置样例图验证当前 OCR 引擎 */
      b.disabled = true; b.textContent = '识别中…';
      function otestDone(){ b.disabled = false; b.textContent = '测试识别'; }
      OCR.test().then(function(txt){
        otestDone();
        var flat = (txt || '').replace(/\s+/g, ' ').trim();
        UI.toast('OCR 引擎可用' + (flat ? '（识别示例：' + flat.slice(0, 40) + '…）' : ''));
      }, function(e){
        otestDone();
        UI.toast('OCR 测试失败：' + (e && e.message || e), true);
      });
    }
    else if (m === 'fs-addroot'){
      NET.fs('addroot').then(function(){
        UI.refreshFsRoots(); UI.toast('工作区目录已添加');
      }, function(err){
        UI.refreshFsRoots(); UI.toast(err && err.message || '操作失败', true);
      });
    }
    else if (m === 'fs-rmroot'){
      NET.fs('rmroot', b.getAttribute('data-path')).then(function(){
        UI.refreshFsRoots(); UI.toast('已移除工作区目录');
      }, function(err){
        UI.refreshFsRoots(); UI.toast(err && err.message || '操作失败', true);
      });
    }
    else if (m === 'export') UI.doExport();
    /* v3.0：数据与维护页 */
    else if (m === 'self-check') UI.runSelfCheck();
    else if (m === 'storage') UI.storagePanel();
    else if (m === 'purge-orphan') UI.purgeOrphans();
    else if (m === 'snap-out') UI.exportSnapshot();
    else if (m === 'snap-in') UI.importSnapshot();
    else if (m === 'diag') UI.doExportDiag();
  else if (m === 'diag-out'){
      var _blob = new Blob([JSON.stringify({ ts: Date.now(), ver: APP_VER, diag: DIAG }, null, 2)], { type: 'application/json' }); // v0.3.63：这个作用域里没有 download()，也没有 ver；改用 Blob + a 标签 + APP_VER
      var _a = document.createElement('a'); _a.href = URL.createObjectURL(_blob); _a.download = 'solochat-diag-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(_a); _a.click(); _a.remove(); setTimeout(function(){ URL.revokeObjectURL(_a.href); }, 3000); UI.toast('已导出诊断计数');
  }
  else if (m === 'diag-clear'){
    DIAG.ok = DIAG.fail = DIAG.stop = DIAG.toolFail = DIAG.timeouts = DIAG.undos = DIAG.gated = 0;
    DIAG.prov = {}; diagSave(); UI.toast('已清空诊断计数');
      try { var _vs = document.querySelectorAll('.diag-v'); for (var _vi = 0; _vi < _vs.length; _vi++) _vs[_vi].textContent = '0'; } catch (e) {} // v0.3.64：清完就地刷新数字，别让用户以为没生效
  }
    else if (m === 'catalog-clear'){
      try { localStorage.removeItem('sc.cat.v1'); } catch (e) {}
      UI.toast('已清空能力目录缓存');
    }
    else if (m === 'import'){
      var fi = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
      document.body.appendChild(fi);
      fi.addEventListener('change', function(){
        if (fi.files[0]) UI.doImport(fi.files[0]);
        fi.remove();
      });
      fi.click();
    }
    else if (m === 'clear'){
      UI.confirmBox({ title: '清空全部数据', text: '所有会话、消息与图片都将删除，且不可恢复。建议先导出备份。', okText: '全部清空', danger: true })
        .then(function(ok){
          if (!ok) return;
          DB.clearAll().then(function(){
            UI.killStreams(); // v2.2：终止全部后台流（防结果落库复活）
            S.sessions = []; S.sid = null; S.msgs = []; S.drafts = {};
      S._mem = {}; SC_SNAPS = {}; saveSnaps(); // v0.3.13：清空数据时记忆缓存与写入快照也要清，否则撤销能把旧内容写回来
            RUNNER.reset(); // 拆沙箱清运行态（v2.0 零遗留）
            UI.resetQuick(); // 快速条标记复位（v2.0）
            UI.reloadSessions(); UI.renderMsgs(); UI.closeModal();
            UI.toast('已清空');
          });
        });
    }
  });

    /* 弹层表单：data-cfg / data-sess */
  function applyCfgField(t){
    var v = t.type === 'checkbox' ? t.checked : t.value;
    var ck = t.getAttribute('data-cfg');
    if (ck === 'modelsText'){
      var arr = v.split(/[,，]/).map(function(x){ return x.trim(); }).filter(Boolean);
      setCfg({ models: arr });
    } else if (ck.indexOf('timeout.') === 0){
      var k = ck.slice(8);
      S.cfg.timeout[k] = clamp(parseInt(v, 10) || DEF_CFG.timeout[k], 1, 600);
      saveCfg();
    } else if (ck.indexOf('modeCfg.') === 0 || ck.indexOf('toolCfg.') === 0){
      /* v0.4.8：模式/工具参数是数值嵌套字段，不能按字符串保存；保存后立刻重算 LIMITS */
      var _lp = ck.split('.'), _lo = S.cfg;
      for (var _li2 = 0; _li2 < _lp.length - 1; _li2++){ _lo[_lp[_li2]] = _lo[_lp[_li2]] || {}; _lo = _lo[_lp[_li2]]; }
      var _ln = parseFloat(v);
      if (!isFinite(_ln)) return;
      _lo[_lp[_lp.length - 1]] = _ln;
      saveCfg();
      try { applyLimitCfg(S.cfg.mode); } catch (e) {}
      UI.toast('参数已保存并即时生效');
    } else if (ck.indexOf('.') > 0){ // v1.5：嵌套配置（如 ocr.mistralKey），点号路径直写
      var ps = ck.split('.'), o = S.cfg;
      for (var pi2 = 0; pi2 < ps.length - 1; pi2++){ o[ps[pi2]] = o[ps[pi2]] || {}; o = o[ps[pi2]]; }
      o[ps[ps.length - 1]] = v;
      saveCfg();
    } else if (ck === 'temperature'){
      setCfg({ temperature: clamp(isNaN(parseFloat(v)) ? 0.7 : parseFloat(v), 0, 2) }); // v0.3.59：parseFloat('0') 是 0，被 || 当成假值回退到 0.7，temperature=0 永远设不进去
    } else if (ck === 'maxTokens'){
      setCfg({ maxTokens: Math.max(0, parseInt(v, 10) || 0) }); // 0=不限制（不传 max_tokens）
    } else if (ck === 'maxDocMB'){
      setCfg({ maxDocMB: clamp(parseInt(v, 10) || 20, 1, 100) });
    } else if (ck === 'maxImgMB'){
      setCfg({ maxImgMB: clamp(parseInt(v, 10) || 10, 1, 100) });
    } else if (ck === 'overlayOpacity'){
      setCfg({ overlayOpacity: clamp(parseInt(v, 10) || 100, 35, 100) });
    } else if (ck === 'imgPartial'){
      setCfg({ imgPartial: clamp(parseInt(v, 10) || 0, 0, 3) });
    } else {
      var patch = {}; patch[ck] = v;
      if (ck === 'proxy') patch.proxyCustom = 1; // 用户手填代理 → 标记为自定义，迁移不再覆盖
      setCfg(patch);
      saveCfg(); // 修复：通用字段（含代理）改完立即持久化，重启不再回退
      if (ck === 'quickbar') UI.quickbarReady();
    }
  }
  /* session groups v0.4.2：会话参数控件 —— 会话态写指定会话，草稿态(data-draft=1)写 S.draftCfg */
  function applySessField(t){
    var sid = t.getAttribute('data-sid');
    var isDraft = t.getAttribute('data-draft') === '1';
    var s = null, draft = null;
    if (sid){ for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].id === sid){ s = S.sessions[i]; break; } }
    if (!s && isDraft) draft = S.draftCfg || (S.draftCfg = mkDraftCfg());
    if (!s && !draft && !isDraft) s = curSession();
    if (!s && !draft) return;
    var sk = t.getAttribute('data-sess'), val = t.value;
    if (sk === 'systemPrompt'){ if (s) s.systemPrompt = val; else draft.systemPrompt = val; }
    else if (sk === 'groupId'){
      if (s){
        s.groupId = val || '';
        /* 当前会话且未显式设模式时，组模式立即生效 */
        if (s.id === S.sid && !s.mode){ var g = groupById(s.groupId); if (g && g.mode) setCfg({ mode: g.mode }); }
      } else draft.groupId = val || '';
    } else if (sk === 'mode'){
      if (s){ s.mode = val || 'chat'; if (s.id === S.sid) setCfg({ mode: s.mode }); }
      else draft.mode = val || '';
    } else if (sk === 'model'){ if (s) s.model = val || ''; else draft.model = val || ''; }
    else if (sk === 'perm'){
      var _pv = normPerm(val);
      if (s) s.perm = _pv; else draft.perm = _pv;
      if (s && s.id === S.sid) S.cfg.permMode = _pv;
    }
    else {
      var pp = s ? (s.params = s.params || {}) : (draft.params = draft.params || {});
      if (sk === 'maxTokens'){
        var n = parseInt(val, 10);
        if (!n || n < 0) delete pp.maxTokens; else pp.maxTokens = n;
      } else {
        var f = parseFloat(val);
        if (isNaN(f)) delete pp.temperature; else pp.temperature = clamp(f, 0, 2);
      }
    }
    if (s) DB.putSession(s); else saveCfg();
    UI.renderSessions(); UI.renderComposerCtl();
  }
  function fieldOf(e, attr){
    var t = e.target;
    return t.getAttribute && t.getAttribute(attr) ? t : null;
  }
    /* change=离散控件；input=逐键保存防丢 */
  window.addEventListener('change', function(e){
    var t = e.target;
    if (t.id === 'file-input'){
      if (t.files && t.files.length) UI.addFiles(t.files);
      t.value = '';
      return;
    }
    if (t.id === 'sel-model'){
      var sep = t.value.indexOf('\x01');
      if (sep > 0) UI.applyPreset(t.value.slice(0, sep), t.value.slice(sep + 1));
      else {
        /* 会话隔离：模型写当前会话（草稿写 draft），不改全局默认 */
        var _mv = t.value;
        var _msess = curSession();
        if (_msess){ _msess.model = _mv; try { DB.putSession(_msess); } catch (e) {} }
        else { var _md = S.draftCfg || (S.draftCfg = mkDraftCfg()); _md.model = _mv; }
        S.cfg.currentModel = _mv;
        try { UI.renderComposerCtl(); } catch (e) {}
      }
      UI.metaLazy(); // v2.9：能力静默补全
      return;
    }
    if (t.id === 'psel'){ UI.applyPreset(t.value); UI.openSettings(); return; }
    if (t.id === 'sel-think'){
      var tm = S.cfg.thinkByModel || {};
      if (S.cfg.currentModel) tm[S.cfg.currentModel] = t.value;
      setCfg({ thinkByModel: tm });
      return;
    }
    if (fieldOf(e, 'data-preset')) UI.presetField(t);
    else if (fieldOf(e, 'data-cfg')) applyCfgField(t);
    else if (fieldOf(e, 'data-sess')) applySessField(t);
    /* v2.9：模型能力手工校正 */
    else if (t.getAttribute && t.getAttribute('data-mm')){
      UI.mmSave(t.getAttribute('data-id'), t.getAttribute('data-mm'), t.value);
    }
    else if (t.getAttribute && t.getAttribute('data-mmr')){
      UI.mmSave(t.getAttribute('data-id'), 'reason', t.value);
    }
    else if (t.getAttribute && t.getAttribute('data-mmin')){
      var mrow = t.closest('.mdl-cfg'), mid = t.getAttribute('data-id');
      var cur = ((S.cfg.modelMeta || {})[mid] || {}).in || [];
      var setIn = cur.filter(function(x){ return x !== t.getAttribute('data-mmin'); });
      if (t.checked) setIn.push(t.getAttribute('data-mmin'));
      UI.mmSave(mid, 'in', setIn);
    }
    /* v3.0 #5：该模型默认参数（留空则跟随全局） */
    else if (t.getAttribute && t.getAttribute('data-mmdef')){
      var did = t.getAttribute('data-id'), dkey = t.getAttribute('data-mmdef');
      var mm = (S.cfg.modelMeta || {})[did] || {};
      var dv = t.value === '' ? null : parseFloat(t.value);
      mm.def = mm.def || {};
      if (dv == null || isNaN(dv)) delete mm.def[dkey]; else mm.def[dkey] = dv;
      (S.cfg.modelMeta || (S.cfg.modelMeta = {}))[did] = mm;
      saveCfg();
    }
  });
  window.addEventListener('input', function(e){
    var pp = fieldOf(e, 'data-preset');
    if (pp && pp.type !== 'checkbox' && pp.type !== 'radio'){ UI.presetField(pp); return; }
    var c = fieldOf(e, 'data-cfg');
    if (c && c.type !== 'checkbox' && c.type !== 'radio'){ applyCfgField(c); return; }
    var s = fieldOf(e, 'data-sess');
    if (s) applySessField(s);
  });

  /* 顶栏空白区拖动；双击最大化走 HTCAPTION */
  window.addEventListener('mousedown', function(e){
    if (!NET.bridge.ok || e.button !== 0) return;
    if (!e.target.closest || !e.target.closest('#topbar')) return;
    if (e.target.closest('#win-ctl') || e.target.closest('button') || e.target.closest('select')) return;
    NET.bridge.send({ t: 'win', act: 'drag' });
  });


  /* 快捷键（§8.1，可在设置 → 快捷键 自定义） */
  function comboOf(e){
    var mods = (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.metaKey ? 'Meta+' : '');
    if (!mods) return null; // 必须带修饰键，避免劫持普通输入
    var code = e.code || '';
    if (code.indexOf('Key') === 0) code = code.slice(3);
    else if (code.indexOf('Digit') === 0) code = code.slice(5);
    return code ? mods + code : null;
  }
  function toggleSidebar(force){
    var hide = force === 'hide' ? true : force === 'show' ? false : !document.body.classList.contains('sb-collapsed');
    document.body.classList.toggle('sb-collapsed', hide);
      setCfg({ sbHidden: hide });
    }
  /* v1.4：两侧都是浮层，点主页面空白处收起 */
  document.addEventListener('mousedown', function(e){
    if (!e.target.closest) return;
    /* v1.1.8：弹窗/灯箱/命令面板/输入区弹层里的点击不算「点主页面空白」。
       之前点设置里的「完成」会把右侧面板一起收掉，网页标签的原生浏览器也跟着消失。 */
    if (e.target.closest('#sidebar') || e.target.closest('#runner') || e.target.closest('#composer') ||
        e.target.closest('#topbar') || e.target.closest('#modal') || e.target.closest('.lightbox') ||
        e.target.closest('#pal') || e.target.closest('#sub-pop')) return;
    if (!document.body.classList.contains('sb-collapsed')) toggleSidebar('hide');
    if (document.body.classList.contains('rn-open')){
      var pb = $('#btn-panel'); if (pb) pb.click();
    }
  });

  window.addEventListener('DOMContentLoaded', function(){
    var home = $('#btn-home');
    if (home) home.addEventListener('click', function(){ NET.openExternal('https://github.com/tsgqjxhn/SoloChat', 'browser'); });
  });

  function runShortcut(name){
    if (name === 'newSession') UI.newDraft();
    else if (name === 'search'){
    document.body.classList.remove('sb-collapsed');
    setTimeout(function(){ var q = $('#sb-q'); if (q) q.focus(); }, 30);
  }
    else if (name === 'theme'){
      var dark = document.documentElement.dataset.theme === 'dark';
      setCfg({ theme: dark ? 'light' : 'dark' });
      UI.applyTheme();
    }
    else if (name === 'sidebar') toggleSidebar();
  }
  window.addEventListener('keydown', function(e){
    /* v1.1.2：任何全屏遮罩都必须能一键退出（之前上传图片后卡死） */
    if (e.key === 'Escape'){
      try {
        var _lb = document.querySelector('.lightbox.on');
        if (_lb){
          _lb.classList.remove('on');
          document.documentElement.style.overflow = '';
          document.body.style.overflow = '';
          try { RUNNER.webHostRestore(); } catch (e) {} // v1.1.8：关灯箱后若在网页标签，恢复原生浏览器
        }
      } catch (err) {}
    }
    /* 录制模式：设置里正在捕获组合键 */
    if (S.recKey){
      if (e.key === 'Escape'){
        S.recKey = null;
        if (S.recBtn) S.recBtn.textContent = S.cfg.shortcuts[S.recBtn.getAttribute('data-k')] || '未绑定';
        return;
      }
      var rc = comboOf(e);
      if (!rc) return; // 无修饰键不拦截，弹层内仍可正常输入
      e.preventDefault(); e.stopPropagation();
      var wasKey = S.recKey;
      S.cfg.shortcuts[wasKey] = rc;
      saveCfg();
      S.recKey = null;
      if (wasKey === 'quickbar' || wasKey === 'shotAsk' || wasKey === 'showMain' || wasKey === 'toggleMain' || wasKey === 'newGlobal' || wasKey === 'tempGlobal') UI.notifyHotkey();
UI.openSettings(); // 重建以刷新显示
    try { var _nbs = document.querySelectorAll('button[data-sp]'); for (var _ni = 0; _ni < _nbs.length; _ni++){ if (/快捷键/.test(_nbs[_ni].textContent || '')){ _nbs[_ni].click(); break; } } } catch (e) {} // v0.3.66：重建后回到快捷键页，别把用户踢回第一页
      return;
    }
    /* v1.10：浏览器快捷键已放行（Ctrl+C 才能复制），把打印/保存/看源码挡掉 */
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && /^(p|s|u)$/i.test(e.key || '')){ e.preventDefault(); return; }

  /* v3.0：命令面板 / 会话内查找优先接管键盘 */
    if (UI.PAL.isOpen()){ if (UI.PAL.key(e)) { e.preventDefault(); return; } }
    if (UI.FIND.isOpen() && UI.FIND.key(e)){ e.preventDefault(); return; }
    var isMod = e.ctrlKey || e.metaKey;
    if (isMod && !e.shiftKey && (e.key === 'k' || e.key === 'K')){
      e.preventDefault(); UI.PAL.isOpen() ? UI.PAL.close() : UI.PAL.open(); return;
    }
    if (isMod && (e.key === 'f' || e.key === 'F') && !e.shiftKey && S.msgs.length){
      e.preventDefault(); UI.FIND.open(); return;
    }
    if (e.key === 'Escape'){
      if (UI.FIND.isOpen()){ UI.FIND.close(); return; }
      if (UI.PAL.isOpen()){ UI.PAL.close(); return; }
      if (UI.popOpen()){ UI.closePop(); return; }
      if (UI.modalOpen()){ UI.closeModal(); return; }
      if (S.sending) UI.stopGeneration();
      return;
    }
    if (UI.modalOpen()) return;
    var sc = S.cfg.shortcuts || {};
    for (var k in sc){
      if (sc[k] && sc[k] === comboOf(e)){ e.preventDefault(); runShortcut(k); return; }
    }
  });

  /* 图片输入三通道之一：粘贴（§8.1） */
  /* v0.5.1：自定义右键菜单 —— 宿主已关闭 WebView2 默认菜单 */
  var CTXM = (function(){
    var box = null;
    function close(){ if (box){ try { box.remove(); } catch (e) {} box = null; } }
    function show(x, y, items){
      close();
      box = el('div', { class: 'ctx-menu' });
      items.forEach(function(it){
        if (!it) return;
        if (it.sep){ box.appendChild(el('div', { class: 'ctx-sep' })); return; }
        var b = el('button', { class: 'ctx-it', type: 'button' }, [icon(it.ic || 'dot'), el('span', { text: it.label })]);
        b.addEventListener('click', function(){ close(); try { it.run(); } catch (e) {} });
        box.appendChild(b);
      });
      if (!box.firstChild) return;
      document.body.appendChild(box);
      var w = box.offsetWidth, h = box.offsetHeight;
      box.style.left = Math.max(6, Math.min(x, window.innerWidth - w - 8)) + 'px';
      box.style.top = Math.max(6, Math.min(y, window.innerHeight - h - 8)) + 'px';
    }
    document.addEventListener('mousedown', function(e){
      if (box && e.target && !e.target.closest('.ctx-menu')) close();
    }, true);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return { show: show, close: close };
  })();
  document.addEventListener('contextmenu', function(e){
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // 输入区保留原生（复制/粘贴）
    e.preventDefault();
    var sel = '';
    try { sel = String(window.getSelection() || ''); } catch (err) {}
    var a = t && t.closest ? t.closest('a[href]') : null;
    var items = [];
    if (a){
      items.push({ ic: 'link', label: '复制链接地址', run: function(){ copyText(a.href); } });
      items.push({ ic: 'globe', label: '在浏览器打开', run: function(){ NET.openExternal(a.href, 'browser'); } });
      items.push({ sep: true });
    }
    if (sel) items.push({ ic: 'copy', label: '复制', run: function(){ copyText(sel); } });
    items.push({ ic: 'plus', label: '新建会话', run: function(){ UI.newDraft(); } });
    items.push({ ic: 'folder', label: '新建分组', run: function(){ UI.groupDlg(); } }); /* session groups v0.4.2 */
    items.push({ ic: 'temp', label: '新建临时会话', run: function(){ UI.toggleTemp(); } });
    items.push({ sep: true });
    items.push({ ic: 'gear', label: '设置', run: function(){ UI.openSettings(); } });
    CTXM.show(e.clientX, e.clientY, items);
  });

  window.addEventListener('paste', function(e){
    var cd = e.clipboardData;
    if (!cd) return;
    var files = cd.files || [];
    if (!files.length) return;                       // 纯文本/HTML：完全交给浏览器默认粘贴
    var txt = '';
    try { txt = cd.getData('text/plain') || ''; } catch (err) {}
    var t = e.target;
    var inBox = t && (t.id === 'input' || (t.closest && (t.closest('#composer') || t.closest('.ask-card'))));
    /* v0.9.0：铁律——只要剪贴板里有文字，就交给浏览器默认粘贴，一个字都不拦。
       之前只要有文件就 preventDefault，从 Word/网页/PDF 复制「文字+图」时文字会被整段吞掉，
       这就是 Ctrl+V 失真。纯图片（截图、右键复制图片）没有文字，才会被接管。 */
    if (txt.trim()) return;
    e.preventDefault();
    if (inBox) UI.addFiles(files);                   // 只在输入框 / 提问卡里收图
  });
  /* 图片输入：拖放通道 */
  window.addEventListener('dragover', function(e){ e.preventDefault(); });
  window.addEventListener('drop', function(e){
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)
      UI.addFiles(e.dataTransfer.files);
  });

  /* 全局错误：提示 + 打到控制台（v2.4：原来只弹一句"未预期错误"、堆栈全丢，无法定位；现在带上原因与位置） */
  window.addEventListener('error', function(e){
    var where = e && e.filename ? String(e.filename).split('/').pop() + ':' + e.lineno : '';
    var msg = (e && e.message) || '未知错误';
    if (/ResizeObserver loop|loop limit exceeded/i.test(msg)){
      try { console.warn('[resize-observer]', msg, where); } catch (x) {}
      return; // 浏览器布局抖动提示，不是业务错误，不弹 toast
    }
    try { console.error('[uncaught]', msg, where, (e && e.error && e.error.stack) || ''); } catch (x) {}
    UI.toast('出错：' + String(msg).slice(0, 60) + (where ? '（' + where + '）' : ''), true);
  });
  window.addEventListener('unhandledrejection', function(e){
    try { console.warn('[unhandled rejection]', (e.reason && (e.reason.stack || e.reason.message)) || e.reason); } catch (x) {}
    e.preventDefault(); // 仍不弹窗打扰（多为网络/超时的可恢复拒绝）
  });

  /* 卸载：中止请求+flush 持久化 */
  window.addEventListener('beforeunload', function(){
    if (S.sending) UI.stopGeneration();
    saveCfg.flush();
  });

  /* 无常驻定时器可停（§5.2.4） */
  document.addEventListener('visibilitychange', function(){ /* no-op：定时器均为短生命周期 */ });
})();

/*  */
