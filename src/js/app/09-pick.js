var PICK = (function(){
  var KINDS = ['agent', 'plugin', 'skill', 'tool', 'prompt', 'mcp'];
  function ids(k){ var p = S.cfg.picks || {}; return (p[k] || []).slice(); }
  function resolve(){
    var reg = EXT.registry(), pick = {}, i, j, on = false;
    for (i = 0; i < KINDS.length; i++){
      var arr = ids(KINDS[i]);
      if (arr.length) on = true;
      for (j = 0; j < arr.length; j++) pick[arr[j]] = 1;
    }
    var out = { on: on, tools: [], skills: [], agents: [], prompts: [], mcp: [] };
    if (!on) return out;
    for (i = 0; i < reg.length; i++){
      var it = reg[i];
      if (!(pick[it.id] || (it.pkg && pick['plugin:' + it.pkg])) || it.kind === 'plugin') continue;
      if (it.kind === 'tool'){ if (out.tools.indexOf(it.name) < 0) out.tools.push(it.name); }
      else if (it.kind === 'skill') out.skills.push(it);
      else if (it.kind === 'agent') out.agents.push(it.name);
      else if (it.kind === 'prompt') out.prompts.push(it);
      else if (it.kind === 'mcp') out.mcp.push(it);
    }
    if (out.skills.length && out.tools.indexOf('skill') < 0) out.tools.push('skill');
    return out;
  }
  /* 只有勾了工具/插件才算「限定工具集」；只勾技能/提示词不动工具 */
  function restrict(){ return (ids('tool').length + ids('plugin').length) > 0; }
  function deny(op){
    if (!restrict()) return '';
    var r = resolve();
    if (r.tools.indexOf(op) >= 0) return '';
    return '本轮只允许这些工具：' + r.tools.join('、') + '；' + op + ' 不在名单里（输入框「/」可改）';
  }
  function agents(){ var r = resolve(); return r.agents.length ? r.agents : null; }
  function block(mode){
    var r = resolve();
    if (!r.on) return '';
    mode = mode || S.cfg.mode || 'chat';
    var L = ['本轮扩展（用户勾选，优先级高于默认清单）：'];
    if (restrict()) L.push('- 工具白名单：' + (r.tools.join('、') || '（无）') + '；名单外的围栏会被拦截。');
    if (mode !== 'chat'){
      if (r.skills.length) L.push('- 技能：' + r.skills.map(function(x){ return x.name + (x.desc ? '（' + x.desc + '）' : ''); }).join('、') + '；需要时用 ```skill 名字 取全文。');
      if (r.agents.length) L.push('- 子智能体：' + r.agents.join('、') + '；派其它角色会被拒绝。');
    }
    for (var i = 0; i < r.prompts.length; i++)
      L.push('- 本轮提示词「' + r.prompts[i].name + '」：\n' + String(r.prompts[i].body || '').slice(0, 1500));
    if (mode !== 'chat' && r.mcp.length) L.push('- MCP（已登记）：' + r.mcp.map(function(m){ return m.name + (m.url ? ' ' + m.url : ''); }).join('；'));
    return L.join('\n');
  }
  return { KINDS: KINDS, ids: ids, resolve: resolve, deny: deny, agents: agents, block: block, restrict: restrict };
})();

/* v0.6.0：模式层 —— 自动路由 + 自定义模式（配方）
   路由：按本轮输入猜该用哪个模式（只在 autoRoute 开时生效，切了就看得见）。
   配方：名字 + 一段提示词 + 底座（chat/work/agent）；选中后挂在底座上跑，提示词追加进 system。 */
var MODE = (function(){
  /* v1.2：模式细分 —— 每种基础模式下的子模式，决定提示词与工具闸门 */
  /* v1.8：Chat 不再分子模式（思考强度由上边栏那个下拉控制）；深度研究降级成「+ 更多」里的开关 */
  var RESEARCH_P = '深度研究：先用 ```search 找线索，再用 ```web 读原文，至少两轮交叉验证；' +
    '结论按「结论 / 证据 / 不确定点」三段写，引用要给 URL。信息不足就写清楚缺什么，不许编。';
  /* v1.9：Agent 合并成一个模式 —— 只读探查 → 计划 → 落地 → 需要并行才派子智能体 */
  var DELIVER_TEMPLATE = '交付总结模板（必须）：\n- 做了什么：…\n- 关键数据/来源：…（用了附件就写文件名）\n- 文件：…（路径 + 用途）\n- 打开/验证：…\n- 限制/未验证：…\n';
  var AGENT_P = '子智能体（Agent）：先只读探查（```fs-list / ```fs-read / ```git diff），再给分步计划；' +
    '每查一步用 1-2 句人话说明在查什么、为什么、发现了什么，不要只甩工具结果；' +
    '要改的才动手，改前先读原文，改动用最小 diff；' +
    '只有当任务能拆成互不依赖的几块（≥2 处并行检索或修改）时才用 ```agent plan|build|verify 派出去，' +
    '拿到摘要自己合并、落盘、验证；小改动自己做完，别为派而派。' +
    '收尾必须给交付总结：改了哪些文件、关键改动、怎么验证、风险/未验证项。\n' + DELIVER_TEMPLATE +
  '要看真实网页就 \u0060\u0060\u0060browser <url> 开应用内窗口，别派子智能体去「访问」网址。';
  /* v1.14：Work = 画布 + 沙箱脚本合并。v1.1.25：正文必须有过程说明 + 交付总结，不再只给缩略工具卡 */
  var AGENT_W_P = '直接落地：先读要改的文件，然后用最小 diff 改完；改前用 1 句说明改哪个文件、为什么，改后给交付总结：' +
    '改动文件、关键 diff、验证方式、风险。不需要先出长计划。';
var AGENT_READ_P = '本轮只读：读文件用 ```fs-list / ```fs-read，查外部信息用 ```search / ```web / ```get；'
  + '不要写盘、不要打补丁、不要跑命令（fs-write / fs-edit / patch / cmd / git 本轮会被拦下）。'
  + '读完按「结论 / 证据 / 缺口」三段写，不要只贴工具结果。';
var WORK_P = '工作区模式（Work）：你的产物就是文件。\n' +
    '1) 用户要文件、文档、网页、页面、脚本、表格、图、报告——一律用 ```vfs-write 写进会话的内存工作区（可多文件：index.html + style.css + script.js），' +
    '不碰真实磁盘，也不要在正文里贴整段代码或整篇文档。\n' +
    '2) 需要算数、批处理、跑一遍验证，就用 ```run 在沙箱里执行脚本、读它的输出，别在正文里手算。\n' +
    '3) 中间过程必须有人话：每次调用工具前用 1-2 句说明“这一步做什么、为什么”；工具返回后用 1-2 句说明“结果如何、发现什么、下一步”。' +
    '不要让整段回复只剩工具卡/缩略代码块。\n' +
    '4) 交付总结（必须，5-10 行）：做了什么；用了哪些关键数据/假设（附件/原题数值要写明来源文件，如 attachments/xxx.pptx.md）；' +
    '生成了哪些文件（路径 + 用途）；怎么打开/验证；已知限制或未验证项。不要只写「已完成」或「文件已生成」。\n' +
    '5) 代码/长文放工具卡，正文不贴整段代码；但解释、判断、总结必须写在正文。\n' +
    '6) 只有用户明确说「贴出来看看」时才在正文里展开代码。\n' +
    '7) 要看网页（榜单、文档、需要登录的页面）用 ```browser <url> 开应用内浏览器窗口；只要文字内容用 ```web。\n' +
    DELIVER_TEMPLATE;
  /* v1.28.1：Chat 没有工具，模型常自己编围栏和「已派出去」的话 —— 直接写死 */
var CHAT_NO_TOOLS_P = '本轮是纯对话，没有任何工具：不能读写文件、不能联网、不能派子智能体、不能打开内置浏览器。\n'
  + '不要写 \u0060\u0060\u0060agent / \u0060\u0060\u0060sub / \u0060\u0060\u0060web / \u0060\u0060\u0060search / \u0060\u0060\u0060browser 之类的工具围栏，也不要声称「已经派出去」「正在抓取」。\n'
  + '需要动手或联网时，直接告诉用户切到 Work 或 Agent。';
var READONLY_OPS = ['fs-write', 'fs-edit', 'patch', 'cmd', 'git'];
  var SUBS = {
    chat: [],
    work: [],   // v1.14：画布 + 沙箱脚本合并成一个 Work（提示词见 WORK_P）
    agent: []
  };
  function subList(mode){ return (SUBS[mode || S.cfg.mode || 'chat'] || []).slice(); }
  function sub(mode){
    var m = mode || S.cfg.mode || 'chat', list = subList(m), id = (S.cfg.sub || {})[m];
    var hit = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) hit = list[i];
    return hit || list[0] || null;
  }
  function setSub(id, mode){
    var m = mode || S.cfg.mode || 'chat';
    var o = Object.assign({}, S.cfg.sub || {}); o[m] = id;
    setCfg({ sub: o });
  }
  function subPrompt(){
    var x = sub(); if (x) return x.prompt || '';
    var m = S.cfg.mode || 'chat';
    var out = [];
    if (m === 'work') out.push(MODE.text('work'));
    if (m === 'chat'){
      /* v0.4.1：用户在「/」里给了工具，Chat 就不再是「没有工具」的纯对话 */
      if (typeof PICK !== 'undefined' && PICK.restrict()){
        out.push('本轮是对话模式，但用户已授权下列工具：需要事实就真的调用围栏去查（```工具名 参数），不要凭记忆答，也不要声称「没有工具」。');
      } else out.push(MODE.text(S.cfg.research ? 'research' : 'chat'));
    }
    if (m === 'agent') out.push(MODE.text('agent'));
    return out.join('\n\n');
  }
  /* v1.8：模型自己声明的思考强度字段（上边栏下拉直接用这些原生值） */
  function metaOf(id){
    var mm = S.cfg.modelMeta || {}, k = String(id || '');
    if (mm[k]) return mm[k];
    var short = k.split('/').pop();
    for (var key in mm){ if (key.split('/').pop() === short) return mm[key]; }
    return null;
  }
  function efforts(){
    var mm = metaOf(S.cfg.currentModel);
    if (mm){
      if (mm.efforts && mm.efforts.length) return mm.efforts;
      if (mm.reason === 'reasoning_effort') return ['low', 'medium', 'high'];
      if (mm.reason === 'reasoning' || mm.reason === 'thinking' || mm.reason === 'enable_thinking') return ['enabled', 'disabled'];
    }
    var p = (NET.reasonProfile && NET.reasonProfile(S.cfg.currentModel)) || null;
    return (p && p.efforts && p.efforts.length) ? p.efforts : null;
  }
  /* 该子模式禁用的操作（目前只用于 Plan 的只读锁） */
  function denyList(){
    var x = sub(), list = (x && x.deny) ? x.deny.slice() : [];
    /* v1.28.2：没有只读小模式了，README_OPS 不再收窄可见工具 */
    return list;
  }
  function denied(op){ return denyList().indexOf(op) >= 0; }

  var RULES = [
    ['agent', /(工作区|仓库|改代码|重构|单元测试|跑测试|读一下|目录结构|\bgit\b|\bdiff\b|补丁|\.(js|ts|tsx|py|java|go|rs|md|json|html)\b)/i],
    ['work',  /(抓|爬|下载|检索|搜索|查一下|网页|链接|打开|访问|展开|浏览器|视频|图片|截图|表格|\bpdf\b|docx|excel|接口|\bapi\b|脚本|生成.*(html|图表|报告))/i]
  ];
  function personas(){ return S.cfg.personas || []; }
  function persona(id){
    var l = personas();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function route(text){
    var t = String(text || '');
    for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(t)) return RULES[i][0];
    /* v1.28.1：句子里带网址、或明说要打开/访问，就别落到 Chat —— Chat 没有工具，模型只能空口答应 */
    if (/https?:\/\//i.test(t) || /(打开|访问|展开|浏览器|browser)/i.test(t)) return 'work';
    return 'chat';
  }
  function promptFor(){
    var p = persona(S.cfg.persona);
    if (!p) return '';
    return '模式配方「' + (p.name || p.id) + '」：' + (p.prompt || '');
  }
  function mountUI(){
    var seg = document.getElementById('seg-mode');
    if (!seg) return; // v1.13：模式条已换成顶栏的「切换按钮 + 当前模式名」
    var old = seg.querySelectorAll('[data-persona]');
    for (var i = 0; i < old.length; i++) old[i].remove();
    personas().forEach(function(p){
      var b = el('button', { type: 'button', 'data-persona': p.id, title: '自定义模式：' + (p.prompt || '').slice(0, 60) });
      b.textContent = p.name || p.id;
      if (S.cfg.persona === p.id) b.classList.add('on');
      seg.appendChild(b);
    });
  }
  return { personas: personas, persona: persona, route: route, promptFor: promptFor, mountUI: mountUI,
           SUBS: SUBS, subList: subList, sub: sub, setSub: setSub, subPrompt: subPrompt, denied: denied,
           texts: { chat: CHAT_NO_TOOLS_P, work: WORK_P, agent: AGENT_P, research: RESEARCH_P, agentWrite: AGENT_W_P, agentRead: AGENT_READ_P },
  /* v1.28：系统提示词各段可改写（存 cfg.sysEdits），空字符串也算「改过」 */
  edited: function(key){ var o = S.cfg.sysEdits || {}; return Object.prototype.hasOwnProperty.call(o, key); },
  text: function(key){ var o = S.cfg.sysEdits || {}; if (Object.prototype.hasOwnProperty.call(o, key)) return o[key] || ''; return MODE.texts[key] || ''; },
           /* v1.28.1：某个工具在当前模式是否可用（渲染时给「不会执行」的围栏打标） */
    toolAllowed: function(op){
      /* v0.4.1：Chat 里用户勾了工具，围栏就真的会执行，不再标「本轮不执行」 */
      if (S.cfg.mode === 'chat' && typeof PICK !== 'undefined' && PICK.restrict())
        return PICK.resolve().tools.indexOf(op) >= 0;
      var list = (typeof EXT !== 'undefined' && EXT.BUILTIN) ? EXT.BUILTIN : [];
      for (var i = 0; i < list.length; i++) if (list[i].id === op) return (list[i].modes || []).indexOf(S.cfg.mode) >= 0;
      return true;
    },
    efforts: efforts };
})();

/* v1.17：记忆 —— 工作记忆（每会话一张任务卡）+ 情景记忆（历史任务卡，词法检索）
   不引入向量库：中文按二元组切词，拉丁按词切，做重叠打分；够用且零依赖。 */
var MEM = (function(){
  var MAXN = 300;
  function toks(t){
    t = String(t || '').toLowerCase();
    var out = (t.match(/[a-z0-9_.\-]{2,}/g) || []).slice(0, 80);
    var hz = t.match(/[\u4e00-\u9fa5]+/g) || [];
    for (var i = 0; i < hz.length && out.length < 200; i++){
      var x = hz[i];
      if (x.length === 1){ out.push(x); continue; }
      for (var j = 0; j < x.length - 1 && out.length < 200; j++) out.push(x.slice(j, j + 2));
    }
    return out;
  }
  function uniq(a){ var m = {}, o = []; for (var i = 0; i < a.length; i++) if (!m[a[i]]){ m[a[i]] = 1; o.push(a[i]); } return o; }
  function score(qt, card){
    if (!card._t) card._t = uniq(toks((card.goal || '') + ' ' + (card.lesson || '') + ' ' + (card.artifacts || []).join(' ')));
    var set = {}, n = card._t.length;
    for (var i = 0; i < n; i++) set[card._t[i]] = 1;
    var hit = 0;
    for (var j = 0; j < qt.length; j++) if (set[qt[j]]) hit++;
    return n ? hit / Math.sqrt(n) : 0;
  }
  function lastUser(msgs){
    for (var i = (msgs || []).length - 1; i >= 0; i--)
      if (msgs[i].role === 'user') return String(msgs[i].content || '').trim();
    return '';
  }
  /* 写入：工作记忆 + （有工具动作时）情景卡 */
  function note(sid, msgs, status){
    if (!sid || S.cfg.memory === false) return Promise.resolve();
    var goal = lastUser(msgs).slice(0, 160);
    if (!goal) return Promise.resolve();
    return DB.workfsBySid(sid).then(function(files){
      var arts = (files || []).map(function(f){ return f.path; }).slice(0, 12);
      var card = { sid: sid, goal: goal, artifacts: arts, ts: Date.now(), status: status || 'ok' };
      return DB.taskPut(card).then(function(){
        if (!arts.length) return;
        return DB.memAll().then(function(all){
          var dup = null;
          for (var i = 0; i < (all || []).length; i++)
            if (all[i].sid === sid && all[i].goal === goal) dup = all[i];
          var rec = dup || { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
          rec.sid = sid; rec.goal = goal; rec.artifacts = arts; rec.ts = Date.now(); rec.status = status || 'ok';
          rec.lesson = rec.lesson || '';
          return DB.memPut(rec);
        });
      });
    }).then(function(){
      return promptFor(sid, msgs);
    }).then(function(blk){
      S._mem = S._mem || {}; S._mem[sid] = blk || '';
    }).catch(function(){});
  }
  /* 打开会话时预热一次 */
  function warm(sid, msgs){
    if (!sid || S.cfg.memory === false) return Promise.resolve('');
    return promptFor(sid, msgs).then(function(blk){ S._mem = S._mem || {}; S._mem[sid] = blk || ''; return blk; }).catch(function(){ return ''; });
  }
  /* 注入：当前任务卡 + 相似历史（不含本会话） */
  function promptFor(sid, msgs){
  /* v1.29.7：只注入本会话目标（会话内记忆）；不再检索其它会话的卡片 */
  if (S.cfg.memory === false) return Promise.resolve('');
  var q = lastUser(msgs).slice(0, 400);
  if (!q) return Promise.resolve('');
  return DB.taskGet(sid).then(function(t){
    if (!t || !t.goal) return '';
    return '【记忆】\n本会话目标：' + t.goal +
      (t.artifacts && t.artifacts.length ? '；已有产物：' + t.artifacts.join('、') : '');
  }).catch(function(){ return ''; });
}
function search(q){
    return DB.memAll().then(function(all){
      var qt = uniq(toks(q));
      var arr = (all || []).slice();
      if (!qt.length) return arr.sort(function(a, b){ return b.ts - a.ts; });
      arr = arr.map(function(c){ return { c: c, s: score(qt, c) }; }).filter(function(x){ return x.s > 0; });
      arr.sort(function(a, b){ return b.s - a.s; });
      return arr.map(function(x){ return x.c; });
    });
  }
  function all(){ return DB.memAll(); }
  function del(id){ return DB.memDel(id); }
  function clear(){ return DB.memClear(); }
  return { note: note, warm: warm, promptFor: promptFor, search: search, all: all, del: del, clear: clear };
})();

/* v1.17：编排 —— 多智能体流水线 / 辩论 / 工作流（DAG + 自检回边） */
var ORCH = (function(){
  function cut(t, n){ t = String(t || ''); return t.length > n ? t.slice(0, n) + '…' : t; }
  function modal(title, sub){
    var logEl = el('div', { class: 'orch-log' });
    var acts = el('div', { class: 'f-actions', style: 'justify-content:flex-end;margin-top:12px' });
    var box = el('div', { style: 'padding:18px 20px;min-width:min(720px,92vw)' }, [
      el('h2', { text: title }), el('div', { class: 'sub', text: sub }), logEl, acts
    ]);
    UI.openModal(box, false);
    return {
      log: function(t, kind){
        var d = el('div', { class: 'orch-line' + (kind ? ' ' + kind : ''), text: t });
        logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
      },
      acts: acts, close: function(){ UI.closeModal(); }
    };
  }
  function ask(title, sub, ph, cb){
    var ta = el('textarea', { class: 'f-in', rows: '4', placeholder: ph || '' });
    ta.style.width = '100%';
    var ok = el('button', { class: 'btn btn-primary', text: '开始' });
    var no = el('button', { class: 'btn btn-sec', text: '取消' });
    var box = el('div', { style: 'padding:18px 20px;min-width:min(560px,92vw)' }, [
      el('h2', { text: title }), el('div', { class: 'sub', text: sub }), ta,
      el('div', { class: 'f-actions', style: 'justify-content:flex-end;margin-top:12px' }, [no, ok])
    ]);
    UI.openModal(box, false);
    no.addEventListener('click', function(){ UI.closeModal(); });
    ok.addEventListener('click', function(){
      var v = ta.value.trim();
      if (!v){ UI.toast('先写点什么', true); return; }
      UI.closeModal(); cb(v);
    });
    setTimeout(function(){ try { ta.focus(); } catch(e){} }, 50);
  }
  /* 没有会话就先建一个（编排要落库/落盘，必须有 sid） */
  function ensureSid(title){
    if (S.sid && curSession()) return S.sid;
    var id = uuid(), now = Date.now();
    var s = { id: id, title: title || '编排', createdAt: now, updatedAt: now, pinned: false,
      model: S.cfg.currentModel || '', systemPrompt: '', params: {}, workspace: '', msgCount: 0, temp: false };
    S.sessions.unshift(s);
    S.sid = id; S.msgs = [];
    try { DB.putSession(s); } catch(e){}
    try { renderSessions(); } catch(e){}
    try { var t = document.getElementById('tb-title'); if (t) t.textContent = s.title; } catch(e){}
    return id;
  }
  function addToInput(txt){
    var box = document.getElementById('input');
    if (!box) return;
    box.value = (box.value ? box.value + '\n\n' : '') + txt;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
  }

  /* ---------- 1. 流水线：方案 → 执行 → 验证 → 交付 ---------- */
  var HINT = {
    plan: '只做设计：文件清单、每个文件的职责与关键接口/数据形状、验收标准。不要写完整实现。',
    build: '按上面的设计实现，交完整文件内容（用 ```write 围栏）。',
    verify: '基于设计与实现，列出可照做的验证步骤、逐条断言（输入→期望），并指出明显缺陷。',
    deliver: '汇总成果：完成了什么、怎么用、有哪些限制、还有什么待办。不要复述全文。'
  };
  function pipeline(){
    ask('多智能体流水线', '四个角色依次干活，后一个看得到前一个的产出。', '例如：做一个能记事的待办页面', function(goal){
      ensureSid('流水线：' + cut(goal, 16));
      var m = modal('流水线：' + cut(goal, 40), '方案 → 执行 → 验证 → 交付');
      var ctx = '', chain = Promise.resolve();
      var steps = [['plan', '方案'], ['build', '执行'], ['verify', '验证'], ['deliver', '交付']];
      steps.forEach(function(st, i){
        chain = chain.then(function(){
          m.log('▶ ' + (i + 1) + '/4 ' + st[1] + '（' + st[0] + '）…');
          var task = '目标：' + goal + (ctx ? '\n\n前序产出：\n' + cut(ctx, 3000) : '') + '\n\n' + (HINT[st[0]] || '');
          var gap = i ? new Promise(function(r){ setTimeout(r, 1500); }) : Promise.resolve();
          return gap.then(function(){ return SUB.run(task, st[0], 0); }).then(function(out){
            ctx += '\n\n【' + st[0] + '】\n' + out;
            m.log('✔ ' + st[0] + '：' + cut(out, 500), 'ok');
          });
        }).catch(function(e){ m.log('✘ ' + st[0] + '：' + (e && e.message || e), 'bad'); });
      });
      chain.then(function(){
        var ins = el('button', { class: 'btn btn-sec', text: '把结论放进输入框' });
        ins.addEventListener('click', function(){ addToInput(cut(ctx, 8000)); m.close(); });
        var cp = el('button', { class: 'btn btn-ghost', text: '复制' });
        cp.addEventListener('click', function(){
          try { if (window.chrome && chrome.webview) chrome.webview.postMessage({ t: 'copy', text: ctx }); } catch(e){}
          UI.toast('已复制');
        });
        m.acts.appendChild(cp); m.acts.appendChild(ins);
        m.log('—— 结束 ——');
      });
    });
  }

  /* ---------- 2. 辩论：三视角并行 + 裁判 ---------- */
  function debate(){
    ask('多智能体辩论', '三个视角各自论证，再由审查角色合并共识与分歧。', '例如：这个页面该不该拆成组件？', function(q){
      ensureSid('辩论：' + cut(q, 16));
      var m = modal('辩论：' + cut(q, 40), 'plan / build / verify 并行 → 裁判合并');
      var views = [
        ['plan', '从事实与证据角度：先列已知/未知，再论证。'],
        ['build', '从实现与代价角度：给出可执行方案与成本。'],
        ['verify', '从风险与反例角度：找漏洞、边界条件、反例。']
      ];
      var ps = views.map(function(v){
        return SUB.run('问题：' + q + '\n' + v[1] + '\n结论 5 行以内，给出你方最强的三条论据。', v[0], 0)
          .then(function(out){ m.log('◆ ' + v[0] + '：' + cut(out, 300)); return '【' + v[0] + '】\n' + out; })
          .catch(function(e){ return '【' + v[0] + '】（失败：' + (e && e.message || e) + '）'; });
      });
      Promise.all(ps).then(function(arr){
        m.log('▶ 裁判合并…');
        return NET.chatOnce([
          { role: 'system', content: '你是裁判。合并多方论证：共识、分歧（各自最强理由）、结论与前提条件。不要复述全文。' },
          { role: 'user', content: '问题：' + q + '\n\n各方观点：\n' + cut(arr.join('\n\n'), 8000) }
        ], { maxTokens: 2400, timeout: 0 });
      }).then(function(msg){
        var txt = (msg && msg.content) || '（无输出）';
        m.log('✔ 裁判：\n' + txt, 'ok');
        var ins = el('button', { class: 'btn btn-sec', text: '放进输入框' });
        ins.addEventListener('click', function(){ addToInput(txt); m.close(); });
        m.acts.appendChild(ins);
      }).catch(function(e){ m.log('✘ ' + (e && e.message || e), 'bad'); });
    });
  }

  /* ---------- 3. 工作流：生成 → 运行 → 自检重写 → 存盘 ---------- */
  function extractHtml(t){
    var t2 = String(t || '');
    var mm = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(t2);
    if (mm && /<[a-z!]/i.test(mm[1])) return mm[1].trim();
    var i = t2.search(/<!doctype html|<html/i);
    return i >= 0 ? t2.slice(i).trim() : '';
  }
  function flow(){
    ask('工作流 · 生成页面并自检', '生成 → 沙箱运行 → 有报错就带着报错重写（最多 2 次）→ 存入工作区', '例如：做一个能拖拽排序的看板', function(goal){
      ensureSid('工作流：' + cut(goal, 16));
      var m = modal('工作流', '节点 1 生成 · 2 运行 · 3 判定 · 4 存盘');
      var code = '', tries = 0, lastErr = '';
      function gen(err){
        m.log('▶ 节点 1 生成' + (tries ? '（第 ' + tries + ' 次重写）' : ''));
        return NET.chatOnce([
          { role: 'system', content: '你是前端实现者。只输出一个完整可运行的单文件 HTML（内联 CSS/JS），不要解释。' },
          { role: 'user', content: goal + (err ? '\n\n上次沙箱报错：\n' + cut(err, 2000) + '\n修好后输出完整 HTML。' : '') }
        ], { maxTokens: 6000, timeout: 240000 }).then(function(msg){
          var txt = (msg && msg.content) || '';
          code = extractHtml(txt);
          if (!code) throw new Error('模型没给出 HTML（回复 ' + txt.length + ' 字符：' + cut(txt, 120).replace(/\n/g, ' ') + '）');
          m.log('✔ 生成 ' + code.length + ' 字符', 'ok');
        });
      }
      function runNode(){
        m.log('▶ 节点 2 沙箱运行');
        return RUNNER.runCapture('html', code, false).then(function(r){
          if (r.ok){ m.log('✔ 运行通过（' + r.ms + 'ms）', 'ok'); return true; }
          lastErr = (r.error || '') + '\n' + (r.output || '');
          m.log('✘ 运行失败：' + cut(lastErr, 300), 'bad');
          return false;
        });
      }
      function save(){
        var sid = ensureSid('工作流产物');
        var name = 'flow-' + Date.now().toString(36) + '.html';
        m.log('▶ 节点 4 存盘');
        return WORK.vfsWrite(sid, name, code).then(function(rec){
          m.log('✔ 已存入工作区：' + rec.path, 'ok');
          try { RUNNER.setTab('ws'); RUNNER.open(); } catch(e){}
          try { RUNNER.renderWs(); } catch(e){}
          var pv = el('button', { class: 'btn btn-sec', text: '预览结果' });
          pv.addEventListener('click', function(){ RUNNER.setTab('view'); RUNNER.open(); });
          m.acts.appendChild(pv);
          return rec;
        });
      }
      (function next(){
        gen(tries ? lastErr : '').then(runNode).then(function(ok){
          if (ok) return save();
          if (tries >= 2){ m.log('✘ 两次重写仍失败，停止（产物未存盘）', 'bad'); return null; }
          tries++; return next();
        }).catch(function(e){ m.log('✘ ' + (e && e.message || e), 'bad'); });
      })();
    });
  }
  return { pipeline: pipeline, debate: debate, flow: flow };
})();

/* v0.6.0：配方（自定义模式）的增删 + 顶栏刷新 */
function addPersona(j){
  var id = 'p' + Date.now().toString(36);
  var list = (S.cfg.personas || []).slice();
  list.push({ id: id, name: j.name || ('模式' + (list.length + 1)), base: ['chat','work','agent'].indexOf(j.base) >= 0 ? j.base : 'work', prompt: j.prompt || '' });
  setCfg({ personas: list });
  MODE.mountUI();
  return id;
}
function delPersona(id){
  setCfg({ personas: (S.cfg.personas || []).filter(function(x){ return x.id !== id; }), persona: S.cfg.persona === id ? '' : S.cfg.persona });
  MODE.mountUI();
}

/* v0.7.0：跨模式交接 —— 带上下文与产物换模式，落成新会话（原会话不动） */
var HANDOFF = (function(){
  function summaryOf(msgs){
    var out = [];
    var start = Math.max(0, (msgs || []).length - 10);
    for (var i = start; i < (msgs || []).length; i++){
      var m = msgs[i];
      if (!m || m.role === 'tool') continue;
      var t = String(m.content || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      out.push((m.role === 'user' ? '用户：' : '助手：') + t.slice(0, 300));
    }
    return out.join('\n');
  }
  function artifactsOf(sid){
    return DB.allWorkfs().then(function(rows){
      return (rows || []).filter(function(f){ return f.sid === sid; }).map(function(f){ return f.path; }).slice(0, 12);
    }).catch(function(){ return []; });
  }
  function to(targetMode){
    var cs = curSession();
    if (!cs && !S.msgs.length){ UI.toast('当前没有可交接的对话', true); return; }
    var text = summaryOf(S.msgs);
    if (!text){ UI.toast('对话还是空的，没什么可交接', true); return; }
    var oldMode = S.cfg.mode, oldTitle = (cs && cs.title) || '未命名';
    var sid = uuid();
    artifactsOf(cs && cs.id).then(function(files){
      var sys = '【交接】本会话来自 ' + oldMode.toUpperCase() + ' 模式会话「' + oldTitle + '」，由用户主动交接。\n' +
        '目标模式：' + targetMode.toUpperCase() + '。\n' +
        (files.length ? '原会话产物（虚拟工作区）：' + files.join('、') + '\n' : '') +
        '已压缩的前情（按时间）：\n' + text.slice(0, 3000);
      var sess = { id: sid, title: '交接·' + targetMode + ' · ' + oldTitle, ts: Date.now(), pinned: false,
        workspace: (cs && cs.workspace) || S.pendWs || '', msgCount: 1, systemPrompt: sys };
      return DB.putSession(sess).then(function(){
        return DB.putMessage({ id: uuid(), sid: sid, role: 'user', status: 'ok', ts: Date.now(), attachments: [],
          content: '（交接自 ' + oldMode.toUpperCase() + '）请先复述你理解的待办与已有产物，再开始做。' }).then(function(){
          setCfg({ mode: targetMode, persona: '' });
          S.sessions.unshift(sess);
          selectSession(sid);
          UI.toast('已交接给 ' + targetMode.toUpperCase() + '（原会话保留）');
        });
      });
    }).catch(function(e){ UI.toast('交接失败：' + (e && e.message || e), true); });
  }
  return { to: to, summaryOf: summaryOf };
})();

/* v1.28.3：母智能体的阶段流程 + 并行派活纪律（Work / Agent 都注入） */
var STAGE_PROTOCOL = '阶段流程：clarify 理解需求 → criteria 成功标准 → plan 方案 → build 执行 → verify 验证 → fix 修正 → deliver 交付。\n'
  + '叙事要求：每个阶段用 1-2 句人话说明当前判断、动作和结果；不要在回复里只堆工具卡。\n'
  + '门禁（不可跳过）：没有 verify 的结论不许写「完成」「已测试」；有写入时 deliver 必须给「改动清单 + 验证结果 + 未验证项」。\n'
  + '合并：小事可把 clarify+criteria+plan 压成一句；fix 修到通过为止，但不要空转。\n'
  + '派活：' + '```agent 角色 任务' + '；一条回复里写多个 agent 围栏会并发执行（上限 4），只有互不依赖的才拆。\n'
  + '拆分：按文件/子任务拆 build，按检查面拆 verify；子智能体只回结论，合并由你自己做，别把「合并」也派出去。';
/* v0.5.0：子智能体（母智能体派活）—— 独立上下文、独立循环、只回最终答复
   与主对话的关系：母（当前会话）用 ```sub 名字 任务 派活；子在自己的消息数组里跑完，只把答案回灌成一条工具结果。
   子不能再派子（MAX_DEPTH=1），避免无限套娃与 token 爆炸。 */
var SUB = (function(){
  /* v1.1.0：母子智能体隔离
     设计要点：
     1) 权限隔离（ACL）：角色固定白名单，调度器在解析围栏时拦截越权调用，并把拦截原因回注给子智能体；
     2) 上下文隔离：子智能体只活在自己的 msgs 数组里，不挂 DOM、不写 IndexedDB，结束即回收；
     3) 单向摘要：只把 [subagent-result: role] 摘要回填母上下文，中间探索细节不外泄；
     4) 层级上限 2：母(0) → 子(1) → 孙(2)，只有带 agent 权限的角色能再派活。 */
  var MAX_DEPTH = 2, MAX_TURNS_HARD = 6, TAG = '[subagent-result: ';

  /* 内置角色：ACL 写死，用户自定义 agent（EXT kind:'agent'）可另加 */
  var ROLES = [
  { id: 'clarify', name: 'clarify', kind: 'agent', builtin: true, title: '理解需求',
    desc: '弄清要什么结果、给谁用、有哪些约束；关键歧义先提问',
    tools: ['fs-list', 'fs-read'], writes: false, maxTurns: 2,
    body: '你是「理解需求」角色。目标：把「用户想要什么」变成一句可验收的话。\n' +
      '做法：复述你理解的目标；列出已读到的约束与你的假设；只对影响正确性的歧义提问（最多 3 个），其余按最合理假设推进并标注。\n' +
      '输出：① 目标（一句话，含对象与产出物）② 约束/假设（分两行）③ 待确认问题（没有写「无」）。禁则：不写方案、不写代码、不重复用户原话。' },
  { id: 'criteria', name: 'criteria', kind: 'agent', builtin: true, title: '确认成功标准',
    desc: '把「做好了」具体化：功能、格式、质量、截止时间、验收方式',
    tools: ['fs-read', 'fs-list'], writes: false, maxTurns: 2,
    body: '你是「确认成功标准」角色。目标：把「做好了」变成能逐条判定的清单。\n' +
      '做法：每条标准都必须能被「做到/没做到」判死，并标注验证手段（看文件/跑命令/肉眼检查）。\n' +
      '输出：清单表，分「必须」与「加分」两段；每条格式：标准 → 判定方法 → 证据来源。禁则：不写实现步骤、不写「体验好」这类无法判定的词。' },
  { id: 'plan', name: 'plan', kind: 'agent', builtin: true, title: '制定方案',
    desc: '拆分任务、判断依赖/工具/风险，选执行路径',
    tools: ['fs-list', 'fs-read', 'skill'], writes: false, maxTurns: 3,
    body: '你是「制定方案」角色。目标：给出一条能被执行、可回退的路径。\n' +
      '做法：拆成有序步骤，每步写清「做什么 → 产出什么 → 怎么算完成」；标出依赖、需要的工具、风险与回退办法。\n' +
      '输出：① 步骤表（含验收点）② 依赖与风险 ③ 若失败先退哪一步。够用就停，禁止过度设计，禁止在方案里写大段代码。' },
  { id: 'build', name: 'build', kind: 'agent', builtin: true, title: '执行与协作',
    desc: '按步骤做；不确定/权限不足/不可逆操作先停下问',
    tools: ['fs-list', 'fs-read', 'fs-write', 'patch', 'skill', 'web', 'search'], writes: true, maxTurns: 5,
    body: '你是「执行与协作」角色。目标：按方案产出真实可用的结果。\n' +
      '做法：先读再改，改动最小化；写文件用 ' + '```write 相对路径' + '（体为完整内容），暂存到 _sub/build/，不直接改仓库。\n' +
      '遇到不确定、权限不足、可能不可逆的操作：停下，说明要确认什么，不要硬做也不要假装做完。\n' +
      '输出：① 做了什么（对应方案的哪一步）② 产物路径 ③ 卡点/假设（如有）。禁则：不复述代码全文，不夸大完成度。' },
  { id: 'verify', name: 'verify', kind: 'agent', builtin: true, title: '验证结果',
    desc: '检查是否符合需求；开发任务还要测功能/边界/环境',
    tools: ['fs-list', 'fs-read', 'skill'], writes: false, maxTurns: 3,
    body: '你是「验证结果」角色。目标：给出可复核的判定，而不是感觉。\n' +
      '做法：逐条对照成功标准；开发任务补功能、边界、环境三类检查；能跑就跑，跑不了说明为什么。\n' +
      '输出：① 对照表（标准 → 符合/不符/无法判断 → 证据）② 验证步骤与断言（输入 → 期望 → 实际）③ 缺陷按严重度排序。\n' +
      '禁则：没真跑过一律写「未验证」，不许写成通过；不许用「应该可以」代替结论。' },
  { id: 'fix', name: 'fix', kind: 'agent', builtin: true, title: '修正与完善',
    desc: '按验证结果修复，必要时复查直到达标',
    tools: ['fs-list', 'fs-read', 'fs-write', 'patch', 'skill'], writes: true, maxTurns: 4,
    body: '你是「修正与完善」角色。目标：只修验证中不通过的项，让它们通过。\n' +
      '做法：按严重度从高到低修；只改必要处，不顺手重写、不扩大改动面；写完用 ' + '```write' + ' 暂存到 _sub/fix/ 并复查。\n' +
      '输出：① 改了哪些文件、为什么 ② 复查结果（通过/仍未通过）③ 未解决的问题与建议。两轮修不好就停，交回母智能体。' },
  { id: 'deliver', name: 'deliver', kind: 'agent', builtin: true, title: '交付与说明',
    desc: '给成果 + 怎么用、有哪些限制、还有什么待办',
    tools: ['fs-list', 'fs-read'], writes: false, maxTurns: 2,
    body: '你是「交付与说明」角色。目标：让用户拿到就能用，且知道边界。\n' +
      '输出四段，写完就停：① 完成了什么（对应哪条成功标准）② 怎么用（一条可照做的步骤）③ 限制与已知缺陷 ④ 待办。\n' +
      '禁则：不复述全文、不写客套话、不把「未验证」说成「已验证」。' }
];
var SENSITIVE = ['fs-read', 'fs-list', 'fs-write', 'fs-edit', 'patch', 'cmd', 'git',
                   'web', 'search', 'get', 'skill', 'write', 'agent', 'sub', 'suball'];

  /* v1.28.2：不再分小模式 —— 一律 auto，全部角色都能派 */
  function am(){ return 'auto'; }
  function inScope(p, a){
    if (a === 'write') return false;
    if (a !== 'read') return true;
    var t = (p.tools || []).concat(aclOf(p));
    for (var i = 0; i < t.length; i++)
      if (t[i] === 'fs-write' || t[i] === 'fs-edit' || t[i] === 'patch' || t[i] === 'cmd' || t[i] === 'git' || t[i] === 'write') return false;
    return !p.writes;
  }
  function profiles(mode){
  if (mode === 'chat') return []; // v0.3.90：Chat 不派子智能体，纯对话 + 流式就是它该有的样子
    var a = am(), out = [];
    ROLES.forEach(function(r){ if (inScope(r, a)) out.push(r); });
    EXT.all().forEach(function(it){
      if (it.kind === 'agent' && it.on !== false && (it.modes || ['work']).indexOf(mode) >= 0 && inScope(it, a)) out.push(it);
    });
    return out;
  }
  function covered(p, mode){
    var a = am();
    if (!inScope(p, a)) return false;
    if (p.builtin) return true;
    return (p.modes || ['work']).indexOf(mode || S.cfg.mode) >= 0;
  }
  function find(name, mode){
    var allow = PICK.agents();
    if (allow && allow.indexOf(name) < 0) return null;   /* v0.4.0c：本轮勾了智能体就只认这几个 */
    var l = profiles(mode || S.cfg.mode), i;
    for (i = 0; i < l.length; i++) if (l[i].name === name || l[i].id === name) return l[i];
    return null;
  }
function wsOf(sid){ var c = sid ? (typeof sessionById === 'function' ? sessionById(sid) : null) : curSession(); return (c && c.workspace) || ''; } // v0.3.46：允许指定会话的工作区
  function aclOf(p){
    var out = [], i, t = p.tools || [];
    for (i = 0; i < t.length; i++) if (SENSITIVE.indexOf(t[i]) >= 0) out.push(t[i]);
    if ((p.writes || out.indexOf('fs-write') >= 0) && out.indexOf('write') < 0) out.push('write');
    return out;
  }
  function prompt(mode){
    var md = mode || S.cfg.mode;
    if (md === 'chat') return '';   /* v1.28.2：Chat 没有工具，别再把子智能体清单塞给它 */
    var l = profiles(md), i, out = [];
    var allow = PICK.agents();      /* v0.4.0c：勾了智能体就只列这几个 */
    if (allow) l = l.filter(function(x){ return allow.indexOf(x.name) >= 0; });
    if (!l.length) return '';
    out.push('子智能体（可以派活；每个子智能体独立上下文、只回摘要，格式 ' + '```' + 'agent 角色 任务）：');
    for (i = 0; i < l.length; i++){
      var a = aclOf(l[i]);
      out.push('```agent ' + l[i].name + ' —— ' + (l[i].desc || l[i].title || '') +
        (a.length ? '（可用：' + a.join('/') + '）' : '（无工具，纯推理）'));
    }
    return out.join('\n');
  }
  /* 扫描围栏：默认扫全部敏感操作，便于区分「允许」与「越权拦截」 */
  function scanChild(content, names){
    var list = names && names.length ? names : SENSITIVE;
    var re = /```([a-z][a-z0-9-]{1,24})(?:[ \t]*\r?\n|[ \t]+)([\s\S]*?)```/g, m, out = [];
    while ((m = re.exec(content || ''))){
      if (list.indexOf(m[1]) < 0) continue;
      var nl = m[2].indexOf('\n');
      var argTxt = (nl >= 0 ? m[2].slice(0, nl) : m[2]).trim();
      var bodyTxt = nl >= 0 ? m[2].slice(nl + 1) : '';
      if ((m[1] === 'write' || m[1] === 'fs-write') && !bodyTxt.trim()){
        var rest2 = content.slice(m.index + m[0].length);
        var inner = rest2.match(/^\s*```[a-zA-Z0-9+#-]*[ \t]*\r?\n/);
        if (inner){
          var tail2 = rest2.slice(inner[0].length);
          var end2 = tail2.indexOf('\n```');
          if (end2 < 0) end2 = tail2.length;
          bodyTxt = tail2.slice(0, end2);
          re.lastIndex = m.index + m[0].length + inner[0].length + end2;
        }
      }
      out.push({ op: m[1], arg: argTxt, body: bodyTxt });
    }
    return out;
  }

  /* 暂存落盘：_sub/<子名>/<相对路径>，绝不覆盖用户文件 */
  function stageFiles(name, list, wsOverride){
    var cs = curSession();
    var ws = wsOverride || (cs && cs.workspace) || '';
    if (!list || !list.length) return Promise.resolve('');
    if (!ws) return Promise.resolve('\n\n【暂存改动 ' + list.length + ' 个，但当前会话没有绑定工作区，未落盘】');
    var lines = [], chain = Promise.resolve();
    list.forEach(function(it){
      var tgt = '_sub/' + name + '/' + it.rel;
      chain = chain.then(function(){
        return NET.fs('write', tgt, it.text, ws, false).then(function(){
          lines.push('- ' + tgt + '（' + it.text.length + ' 字符）');
        }, function(e){ lines.push('- ' + tgt + ' 写入失败：' + ((e && e.message) || e)); });
      });
    });
    return chain.then(function(){
      return '\n\n【暂存改动】' + lines.length + ' 个（未合并，归 ' + name + '）\n' + lines.join('\n') +
        '\n母智能体可用 fs-read 审阅，确认后用 fs-write / fs-edit 合并到真实路径。';
    });
  }

function run(task, name, depth, sid){ // v0.3.46：第四个参数指定所属会话，后台工具链不该用当前显示会话的工作区
    depth = depth || 0;
    return new Promise(function(resolve, reject){
      if (depth >= MAX_DEPTH) return reject(new Error('子智能体层级到上限（' + MAX_DEPTH + ' 层）'));
      var p = find(name);
      if (!p) return reject(new Error('没有这个子智能体：' + name + '（已有：' +
        profiles(S.cfg.mode).map(function(x){ return x.name; }).join(', ') + '）'));
      var t = String(task || '').trim();
      if (!t) return reject(new Error('任务为空'));
      var acl = aclOf(p), canWrite = acl.indexOf('write') >= 0, canSpawn = acl.indexOf('agent') >= 0;
      var ws = wsOf(sid);

      var sysEd = (S.cfg.sysEdits || {})['sub:' + (p.id || p.name)];
    var sys = (sysEd != null && sysEd !== '') ? sysEd : (p.body || p.prompt || ('你是子智能体「' + p.name + '」。独立完成任务，只回结论。'));
      if (acl.length){
        sys += '\n可用围栏（首行参数，体为内容）：' + acl.map(function(n){ return '```' + n; }).join('、') + '。';
      } else {
        sys += '\n你没有工具，只能推理。';
      }
      if (canWrite){
        sys += '\n写文件用 ```write 相对路径（体为完整文件内容）；会暂存到 _sub/' + p.name + '/，不直接改仓库。';
      }
      if (!canSpawn) sys += '\n不要再派子智能体（无权限）。';
      if (!ws) sys += '\n（当前会话没有绑定工作区，fs-list/fs-read 会失败。）';

      var msgs = [{ role: 'system', content: sys }, { role: 'user', content: t }];
      var turns = 0, max = Math.max(1, Math.min(p.maxTurns || 3, MAX_TURNS_HARD));
      var staged = [], stagedBytes = 0, intercepts = 0;

      function stageOne(c){
        var rel = String(c.arg || '').trim().split(/\s+/)[0].replace(/\\/g, '/').replace(/^\/+/, '');
        if (!rel || rel.indexOf('..') >= 0) return '（非法路径：' + c.arg + '）';
        var bodyTxt = String(c.body || '');
        var fm = bodyTxt.match(/^[ \t]*```[a-zA-Z0-9+#-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/);
        if (fm) bodyTxt = fm[1];
        if (staged.length >= 6 || stagedBytes + bodyTxt.length > 300000)
          return '（超出暂存上限 6 个文件/300KB：' + rel + '）';
        staged.push({ rel: rel, text: bodyTxt }); stagedBytes += bodyTxt.length;
        return '已暂存 _sub/' + p.name + '/' + rel + '（' + bodyTxt.length + ' 字符，待母智能体审阅）';
      }

      function exec(c){
        var op = c.op;
        var _pd = PICK.deny(op === 'write' ? 'fs-write' : op);  /* v0.4.0c：子智能体也受本轮工具白名单约束 */
        if (_pd) return Promise.resolve('[拦截] ' + _pd);
        if (acl.indexOf(op) < 0 && !(op === 'fs-write' && canWrite)){
          intercepts++;
          return Promise.resolve('[拦截] 角色「' + p.name + '」没有 ' + op + ' 权限（允许：' +
            (acl.join('/') || '无') + '）—— 换个做法，或把需要做的事写进结论交给母智能体。');
        }
        if (op === 'write' || op === 'fs-write') return Promise.resolve(stageOne(c));
        if (op === 'fs-edit') return Promise.resolve('（子智能体不做局部编辑：请用 ```write 交完整文件）');
        if (op === 'patch'){
          var stamp = 'patch-' + (staged.length + 1) + '.patch';
          var body = String(c.body || c.arg || '');
          if (staged.length >= 6 || stagedBytes + body.length > 300000) return Promise.resolve('（超出暂存上限）');
          staged.push({ rel: 'patches/' + stamp, text: body }); stagedBytes += body.length;
          return Promise.resolve('补丁已暂存 _sub/' + p.name + '/patches/' + stamp + '（待母智能体审阅）');
        }
        if (op === 'cmd' || op === 'git') return Promise.resolve('[拦截] 子智能体不能执行命令（ACL 禁用）。把命令写进结论，交给母智能体执行。');
        if (op === 'agent' || op === 'sub'){
          if (!canSpawn) return Promise.resolve('[拦截] 角色「' + p.name + '」不能再派子智能体。');
          var role = String(c.arg || '').trim().split(/\s+/)[0];
          var subTask = (String(c.arg || '').replace(role, '') + (c.body ? '\n' + c.body : '')).trim();
          if (!role) return Promise.resolve('（缺少角色名）');
          return run(subTask, role, depth + 1).then(function(txt){ return String(txt).slice(0, 6000); },
            function(e){ return '（下级失败：' + (e && e.message || e) + '）'; });
        }
        if (op === 'skill'){
          var sn = String(c.arg || '').trim().split(/\s+/)[0];
          return Promise.resolve(EXT.skillText(sn) || '（没有这个技能：' + sn + '）');
        }
        if (op === 'fs-list'){
          if (!ws) return Promise.resolve('（未绑定工作区）');
          return NET.fs('list', c.arg || '', null, ws).then(function(r){
            var es = (r && r.entries) || [];
            return '目录 ' + (c.arg || '.') + '（' + es.length + ' 项）\n' +
              es.slice(0, 200).map(function(e){ return (e.d ? '[目录] ' : '[文件] ') + e.n + (e.d ? '' : ' ' + sizeFmt(e.s || 0)); }).join('\n');
          }, function(e){ return '列目录失败：' + (e && e.message || e); });
        }
        if (op === 'fs-read'){
          if (!ws) return Promise.resolve('（未绑定工作区）');
          return NET.fs('read', c.arg, null, ws).then(function(r){
            var txt = String((r && r.text) || '');
            if (txt.length > 4000) txt = txt.slice(0, 4000) + '\n…（截断）';
            return '文件 ' + c.arg + '（' + ((r && r.lines) || 0) + ' 行）\n```\n' + txt + '\n```';
          }, function(e){ return '读文件失败：' + (e && e.message || e); });
        }
        if (EXT.hasTool(op)) return EXT.runTool(op, String(c.arg || '')).catch(function(e){ return '工具失败：' + (e && e.message || e); });
        var u = NET.safeUrl(c.arg);
        if (!u && op !== 'search') return Promise.resolve('（参数不是合法 URL）'); /* v0.3.5：search 的词不是 URL，别被守卫拦死 */
        if (op === 'web') return NET.fetchPageText(u, 4000).then(function(x){ return String(x || '').slice(0, 4000); });
        if (op === 'search') return NET.searchWeb(c.arg, null, true).then(function(r){
      /* v0.3.2：searchWeb 返回 {block,n,items:[{t,u}]}，原来当数组用会 TypeError */
      if (!r || !r.block) return '（没有搜到结果；检查 设置 → 连接与模型 → 联网搜索）';
      var items = (r.items || []).slice(0, 8);
      return (items.length ? items.map(function(x){ return '- ' + (x.t || '') + ' ' + (x.u || ''); }).join('\n') + '\n\n' : '') + String(r.block).slice(0, 4000);
    });
        return Promise.resolve('（不支持的操作：' + op + '）');
      }

      (function loop(){
        turns++;
      /* v1.17：空回复自动重试一次（免费模型常被瞬时限流，直接判死会让流水线断在中间） */
      (function ask(n){
        /* v1.17：推理型模型会把预算全花在 reasoning 上（finish=length、content=null），每次重试翻倍 */
        return NET.chatOnce(msgs, { maxTokens: (p.maxTokens || 2400) * (n + 1), timeout: 0, temperature: 0.2 })
          .then(function(r){
            var c0 = String((r && r.content) || '').trim();
            if (c0 || n >= 2) return r;
            return new Promise(function(res){ setTimeout(res, (n + 1) * 3500); }).then(function(){ return ask(n + 1); });
          });
      })(0)
      .then(function(r){
          var content = String((r && r.content) || '').trim();
          if (!content) return reject(new Error('子智能体无响应（模型返回空，可能被限流）'));
            msgs.push({ role: 'assistant', content: content });
            var calls = scanChild(content, acl.concat(['write', 'agent', 'sub', 'cmd', 'git', 'patch']).filter(function(v, i, a){ return a.indexOf(v) === i; }));
            if (!calls.length || turns >= max){
              return stageFiles(p.name, staged).then(function(note){
                resolve(TAG + p.name + ']\n' + content + (note || ''));
              }, function(){ resolve(TAG + p.name + ']\n' + content); });
            }
            Promise.all(calls.slice(0, 4).map(exec)).then(function(outs){
              msgs.push({ role: 'user', content: '[工具结果]\n' + outs.join('\n---\n') + '\n（继续；完成就直接给结论）' });
              loop();
            }, function(e){ reject(e); });
          }, function(e){ reject(e); });
      })();
    });
  }

  /* 并行派活：最多 3 个并发，单个失败不影响其他 */
  /* v1.28.3：回来一句「本轮到了哪一步、下一步该谁」*/
  var STAGE_SEQ = ['clarify', 'criteria', 'plan', 'build', 'verify', 'fix', 'deliver'];
  function stageHint(names){
    var best = -1;
    for (var i = 0; i < names.length; i++){ var k = STAGE_SEQ.indexOf(String(names[i] || '')); if (k > best) best = k; }
    if (best < 0) return '';
    var nxt = STAGE_SEQ[best + 1];
    return nxt ? '[阶段] 本轮完成：' + names.join(' / ') + '；下一步：' + nxt
         + '（可拆成多个 ```agent ' + nxt + ' … 并行）'
      : '[阶段] 本轮完成：' + names.join(' / ') + '；流程已到最后一环。';
  }
  function runAll(items, depth){
    return new Promise(function(resolve){
      if (!items.length) return resolve([]);
      var results = new Array(items.length), started = 0, done = 0;
      function worker(){
        if (started >= items.length) return;
        var idx = started++, it = items[idx], t0 = Date.now();
        run(it.task, it.name, depth || 0).then(function(txt){
          results[idx] = { name: it.name, ok: true, text: String(txt), ms: Date.now() - t0 };
        }, function(e){
          results[idx] = { name: it.name, ok: false, text: String((e && e.message) || e), ms: Date.now() - t0 };
        }).then(function(){
          done++;
          if (done === items.length) resolve(results); else worker();
        });
      }
      for (var k = 0; k < Math.min(4, items.length); k++) worker();   // v1.28.3：同种角色也能并行 4 个
    });
  }

  return { profiles: profiles, prompt: prompt, run: run, runAll: runAll, stageHint: stageHint, find: find,
           stageFiles: stageFiles, scanChild: scanChild, aclOf: aclOf, ROLES: ROLES, MAX_DEPTH: MAX_DEPTH, covered: covered, mode: am };
})();

var WORK = (function(){
  /* v2.2：循环状态按会话隔离 */
  var stMap = {};
  function stOf(sid){ sid = sid || S.sid; return stMap[sid] || (stMap[sid] = { turns: 0, cancel: false, t0: 0, errStreak: 0, lastErr: '' }); }
  /* v1.29.4 重写：目标 / 工具 / 路由 / 纪律 / 输出 五段，保留全部工具与既有约定 */
  var PROTOCOL = 'Work 协议：在页面沙箱里完成短任务；沙箱不联网、不写磁盘（除 vfs）。\n' +
    '工具（围栏首行是参数）：\n' +
    '```browser URL —— 应用内浏览器打开网页（要登录态、要看页面本身时用）。\n' +
    '```web URL —— 抓网页正文（纯文本，超长截断）；SPA、登录墙、强反爬常只给空壳，那就换 search。\n' +
    '```search 查询词 —— 联网检索，回标题+链接+摘要。\n' +
    '```nav JSON —— 航海图：{"type":"bearing","heading":45,"trueBearing":120,"target":"灯塔A"}；\n' +
    '　　还有 {"type":"aspect","heading":0,"relBearing":45,"distance":"3.2 n mile"} 和 {"type":"rel","items":[["左目标",-110],["右目标",75]]}。\n' +
    '　　只给角度，图和舷角换算由应用算，不要自己画 SVG。\n' +
    '```chart JSON —— 图表：{"type":"bar|line|pie|timeline","title":"标题","data":[["标签",数值]]}。\n' +
    '```svg —— 需要自由绘制时写完整 SVG，会直接内联显示。\n' +
    '```shot 说明 —— 截取右侧「网页」里当前的页面并直接贴进回复（先在网页标签打开目标页）。\n' +
    '```time —— 当前本地时间 / ISO / 时间戳，无参数。\n' +
    '```calc 算式 —— 纯数字四则运算（+ - * / ( ) % ^），不要带变量名。\n' +
    '```json 路径 —— 体为 JSON 文本，按点路径取值（如 data.0.name）；路径留空则格式化输出。\n' +
    '```http 方法 URL —— 直接发 HTTP 请求；下面几行可写 Header: 值，再写一行 --- 后是请求体。\n' +
    '```crawl URL —— 批量抓取：沿页面里的「下一章/下一页」链接连续抓 N 页，逐页存进工作区 crawl/ 目录；参数行后另起一行写 max=N（默认 20，上限 200）。爬小说/章节列表用它，不要用 web 一页页抓。\n' +
    '```get URL —— 抓任意文件（pdf/docx/xlsx/pptx/图片/mp3/mp4/zip/md/json）；文档抽正文 4000 字回灌，图片会作为图片给你看。\n' +
    '```run 类型(html/svg/js/css/c) —— 沙箱内跑代码，回控制台与报错；沙箱无网，别在 run 里写抓取代码。\n' +
    '```vfs-write 相对路径 —— 体为完整文件内容，写进本会话工作区（单文件 ≤1MB）。\n' +
    '```vfs-list —— 列工作区。\n' +
    '```vfs-read 相对路径 —— 读文本文件原文；上传附件的提取文本在 attachments/ 下（.md/.txt），超过约 6KB 截断；图片/PDF/Office 原文件只回元数据，不能按文本读。\n' +
    '```patch 相对路径 —— 体为 unified diff（@@ 简版）；小改用 patch，比整文件重写省 token。\n' +
    '```preview 相对路径 —— 在右侧面板打开产物自检。\n' +
    '```play URL —— 应用内播放窗口打开视频；视频站禁止被 iframe 内嵌，别把播放器塞进 html 产物。\n' +
    '```download URL 或 BV —— 保存视频/音频到「下载/SoloChat」；说「爬/下载/保存视频」一律用它，别用 web 抓视频页。\n' +
    '路由：问「是什么/查一下/看看」→ web/search 取真实内容，结论直接写在回复里，不要包装成 html 产物；\n' +
    '只有明确要文件/页面/导出/下载时才落盘 vfs-write，并在回复末尾列清单。\n' +
    'B 站：榜单用 ```web https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all&ps=1 取 bvid，再 download；首页是 JS 渲染，别浪费轮次。\n' +
    '纪律：绝不回答「我无法访问网络」——先调工具，只有工具真的失败才回报原因（附失败输出要点）。\n' +
    '输出：结论在前；有产物给「文件清单 + 怎么打开/运行」；有失败给「失败原因 + 建议下一步」。';
  function scan(content){ /* 扫描 run/vfs-* 围栏（参数=体首行）；容忍 \r\n */
    var re = /```(run|preview|patch|web|crawl|shot|search|play|download|get|browser|time|calc|json|http|skill|suball|sub|agent|vfs-(?:write|list|read))(?:[ \t]*\r?\n|[ \t]+)([\s\S]*?)```/g, out = [], m;
    while ((m = re.exec(content || ''))){
      var nl = m[2].indexOf('\n');
      out.push({ op: m[1], arg: (nl >= 0 ? m[2].slice(0, nl) : m[2]).trim(), body: nl >= 0 ? m[2].slice(nl + 1) : '' });
    }
    /* v0.4.0：用户扩展工具 —— 围栏名动态，扫到名字匹配启用清单的才收 */
    var cu = EXT.toolsFor(S.cfg.mode);
    if (cu.length){
      var re2 = /```([a-z][a-z0-9-]{1,24})(?:[ \t]*\r?\n|[ \t]+)([\s\S]*?)```/g, m2;
      while ((m2 = re2.exec(content || ""))){
        var hitExt = false;
        for (var ci = 0; ci < cu.length; ci++){ if (cu[ci].name === m2[1]) hitExt = true; }
        if (!hitExt) continue;
        var nl2 = m2[2].indexOf(String.fromCharCode(10));
        out.push({ op: m2[1], arg: (nl2 >= 0 ? m2[2].slice(0, nl2) : m2[2]).trim(), body: nl2 >= 0 ? m2[2].slice(nl2 + 1) : "" });
      }
    }
    return out;
  }
  function note(content, sid, tools, imgs){ /* v2.2：可指定会话；后台会话只落库，不动当前视图
                                        v0.2.1：Work 工具结果 role='tool'（不再冒充「你」发言），tools 供 UI 画卡片
                                        v0.2.9：imgs = data URL 数组，作为图片内容发给多模态模型 */
    sid = sid || S.sid;
    var um = { id: uuid(), sid: sid, role: 'tool', content: content, status: 'ok', ts: Date.now(), attachments: [], tools: tools || [] };
    if (imgs && imgs.length) um.imgs = imgs.slice(0, 4);
    DB.putMessage(um);
    if (sid === S.sid){ S.msgs.push(um); UI.appendMsgNode(um); } // v2.4：追加而非整列表重建（滚动/图片抖动主因）
    return um;
  }
  function normPath(p){ /* VFS 路径规范化：统一 / 、禁 .. 、禁绝对路径 */
    p = String(p || '').trim().replace(/\\/g, '/');
    if (!p || p[0] === '/' || /^[a-zA-Z]:/.test(p) || p.split('/').indexOf('..') >= 0) return null;
    return p;
  }
  /* v3.0 #14：极简 unified diff 应用器（支持 @@ 定位、上下文行、增删；\ 结尾行忽略） */
  function applyUnified(base, diff){
    var src = String(base == null ? '' : base).replace(/\r\n/g, '\n').split('\n');
    var lines = String(diff || '').replace(/\r\n/g, '\n').split('\n');
    var out = [], pos = 0, i = 0, hit = 0;
    while (i < lines.length && /^(---|\+\+\+|diff |index )/.test(lines[i])) i++;
    while (i < lines.length){
      var ln = lines[i];
      var hm = /^@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/.exec(ln);
      if (hm){
        var oldStart = Math.max(0, (+hm[1]) - 1);
        if (oldStart < pos) throw new Error('hunk 顺序错乱');
        while (pos < oldStart && pos < src.length) out.push(src[pos++]);
        hit++; i++; continue;
      }
      if (ln.charAt(0) === '\\'){ i++; continue; }
      if (ln === ''){
        if (src[pos] === ''){ out.push(''); pos++; }
        i++; continue;
      }
      var tag = ln.charAt(0), body = ln.slice(1);
      if (tag === ' '){
        if (src[pos] !== body) throw new Error('上下文不匹配（原第 ' + (pos + 1) + ' 行）');
        out.push(src[pos++]);
      } else if (tag === '-'){
        if (src[pos] !== body) throw new Error('待删除行不匹配（原第 ' + (pos + 1) + ' 行）');
        pos++;
      } else if (tag === '+'){
        out.push(body);
      } else {
        /* 没有前缀的裸行：当作上下文 */
        if (src[pos] === ln){ out.push(src[pos++]); }
        else throw new Error('无法识别的行：' + ln.slice(0, 40));
      }
      i++;
    }
    while (pos < src.length) out.push(src[pos++]);
    if (!hit) throw new Error('缺少 @@ 定位行');
    return out.join('\n');
  }
  /* VFS 写入：配额校验 → IndexedDB（id = sid + '|' + path，覆盖写） */
  function vfsWrite(sid, path, body){
    var p = normPath(path);
    if (!p) return Promise.reject(new Error('非法路径（禁绝对路径与 ..）：' + path));
    var size = new Blob([body]).size;
    if (size > LIMITS.VFS_FILE_MAX) return Promise.reject(new Error('文件超过单文件上限 1MB'));
    return DB.workfsBySid(sid).then(function(fs){
      var total = 0, old = null, i;
      for (i = 0; i < fs.length; i++){
        /* v1.1.22：二进制原文件只是 attachmentId 引用，不占文本 VFS 配额 */
        total += (fs[i].binary ? 0 : (fs[i].size || 0));
        if (fs[i].path === p) old = fs[i];
      }
      if (!old && fs.length >= LIMITS.VFS_FILES_MAX) return Promise.reject(new Error('文件数已达上限 200'));
      if (total - (old && !old.binary ? old.size || 0 : 0) + size > LIMITS.VFS_TOTAL_MAX)
        return Promise.reject(new Error('会话总量已达上限 20MB'));
      /* v3.0 #15：同路径保留最近 5 个历史版本（只存文本内容，内存/磁盘代价可控） */
      var vers = (old && old.vers ? old.vers.slice() : []);
      if (old && old.content !== body){
        vers.push({ ts: Date.now(), content: String(old.content || '').slice(0, LIMITS.VFS_FILE_MAX) });
        if (vers.length > 5) vers = vers.slice(vers.length - 5);
      }
      return DB.workfsPut({ id: sid + '|' + p, sid: sid, path: p, content: body, size: size, ts: Date.now(), vers: vers })
        .then(function(){ return { path: p, size: size }; });
    });
  }
  function fmtRun(r, kind, cut){
    var head = '[run-result] ' + kind + (r.ok ? ' 成功' : ' 失败') + '（' + r.ms + 'ms' + (r.cut || cut ? '，输出已截断' : '') + '）';
    var out = String(r.output || '').slice(0, LIMITS.WORK_OUT_CHARS);
    return head + (out ? '\n```\n' + out + '\n```' : '') + (r.error ? '\n错误：' + String(r.error).slice(0, 500) : '');
  }
  /* v2.7：产物自动落盘——模型没用 ```vfs-write 时，把回复里的 html/svg/js/css/md 代码块
     自动写入虚拟工作区（文件名 index.html / style.css / script.js / 图-N.svg / 笔记-N.md，
     同名且内容不同则加序号），保证「用户要求的文档」不会只留在聊天里。 */
  var AUTO_EXT = { html: 'html', svg: 'svg', js: 'js', css: 'css', md: 'md' };
  /* v0.2.2：只有用户这轮明确要「文件/页面/导出」时才自动落盘，避免「让他爬个视频，他回你一堆 html/md」 */
  var ARTIFACT_HINT = /文件|网页|页面|网站|html|svg|css|markdown|\.md|导出|保存|下载|工作区|预览|打包|压缩|zip|卡片|可视化|演示|报告|文档|游戏/i;
  function wantsArtifact(sid, ts){
    return DB.msgsBySid(sid).then(function(list){
      var last = null;
      for (var i = 0; i < list.length; i++){
        var m = list[i];
        if (m.role === 'user' && (!ts || m.ts <= ts) && !/^\[(fs|run)-result\]/.test((m.content || '').trim())) last = m;
      }
      return !!(last && ARTIFACT_HINT.test(last.content || ''));
    }, function(){ return true; }); /* 读不到就按旧行为（照常落盘） */
  }
  function autoVfs(msg){
    if (!msg || msg.status !== 'ok' || !msg.content) return;
    /* v1.13：回复里带完整 HTML 文档时无条件落盘（用户很可能就是要个能跑的东西） */
    if (/<!doctype html|<html[\s>]/i.test(msg.content)){ autoVfsSave(msg); return; }
    wantsArtifact(msg.sid, msg.ts).then(function(yes){ if (yes) autoVfsSave(msg); });
  }
  function autoVfsSave(msg){
    var re = /```(html|svg|js|javascript|css|md|markdown)[ \t]*\r?\n([\s\S]*?)```/gi, m, jobs = [];
    while ((m = re.exec(msg.content))){
      var lang = (m[1] || '').toLowerCase();
      if (lang === 'javascript') lang = 'js';
      if (lang === 'markdown') lang = 'md';
      var body = m[2];
      if (body.trim().length < 10) continue; /* 太短视为示例片段，不落盘 */
      /* v2.8：js/css 只在像完整产物时才落盘（≥200 字符），避免讲解用的小片段刷满工作区 */
      if ((lang === 'js' || lang === 'css') && body.trim().length < 200) continue;
      var fullDoc = /^\s*(<!doctype html|<html)/i.test(body) || /<html[\s>]/i.test(body.slice(0, 400));
      jobs.push({ lang: lang, body: body, full: fullDoc });
    }
    if (!jobs.length) return;
    var sid = msg.sid;
    DB.workfsBySid(sid).then(function(fs){
      var byPath = {}, byContent = {}, i;
      for (i = 0; i < fs.length; i++){ byPath[fs[i].path] = fs[i].content; byContent[fs[i].content] = fs[i].path; }
      var chain = Promise.resolve(), added = 0;
      jobs.forEach(function(j){
        if (byContent[j.body] != null) return; /* 内容已在工作区 */
        var stem = j.lang === 'html' ? 'index' : (j.lang === 'css' ? 'style' : (j.lang === 'js' ? 'script' : (j.lang === 'svg' ? '图' : '笔记')));
        var path = stem + '.' + AUTO_EXT[j.lang], n = 2;
        while (byPath[path] != null && byPath[path] !== j.body){ path = stem + '-' + n + '.' + AUTO_EXT[j.lang]; n++; }
        if (byPath[path] === j.body) return; /* 同名同内容，跳过 */
        byPath[path] = j.body; added++;
        chain = chain.then(function(){
          return vfsWrite(sid, path, j.body).then(function(r){
            if (sid === S.sid && RUNNER.renderWs) RUNNER.renderWs();
            RUNNER.previewRefreshIf(sid, r.path);
          }, function(){});
        });
      });
      if (added && sid === S.sid) UI.toast('已自动保存 ' + added + ' 个产物到工作区');
    });
  }
  function handleTurn(msg){
    var w0 = stOf(msg && msg.sid);
    if (w0.cancel || !msg || msg.status !== 'ok') return;
    /* v0.9.5：本轮有提问卡 → 停下来等用户回答，绝不自己往下跑 */
    if (/```ask\b/.test(String(msg.content || ''))){ w0.waitAsk = true; return; }
  if (S.cfg.mode !== 'work' && !w0.turns) return; // v0.3.3：已在跑的工具链不受切模式影响，只有首次进入要求 Work
    autoVfs(msg); /* v2.7：先落盘产物（模型没用 vfs-write 也不丢文件） */
    var calls = scan(msg.content);
    if (!calls.length) return;
    if (!w0.turns){ w0.errStreak = 0; w0.lastErr = ''; w0.healed = 0; }
    if (LIMITS.WORK_MAX_TURNS > 0 && w0.turns >= LIMITS.WORK_MAX_TURNS){ UI.toast('已达 Work 轮次上限（' + LIMITS.WORK_MAX_TURNS + '），请人工查看产物', true); return; }
    runCalls(calls, msg.sid);
  }
  function runCalls(calls, sid0){
    UI.holdBusy(1, sid0);
    var parts = [], events = [], imgs = [], done = 0, w0 = stOf(sid0);
      /* v1.28.3：一条回复里的多个 agent/sub 先聚成一批并行跑，剩下的工具照原样串行 */
      (function hoistSubs(){
        var subs = [], rest = [];
        for (var i = 0; i < calls.length; i++){
          var c0 = calls[i];
          if (c0.op === 'agent' || c0.op === 'sub'){
            if (c0.items){ for (var q = 0; q < c0.items.length; q++) subs.push(c0.items[q]); continue; }
            var nm = String(c0.arg || '').trim().split(/\s+/)[0];
            var tk = (String(c0.arg || '').replace(nm, '') + (c0.body ? '\n' + c0.body : '')).trim();
            if (nm) subs.push({ name: nm, task: tk });
          } else rest.push(c0);
        }
        if (subs.length > 1){ rest.unshift({ op: 'suball', items: subs }); calls = rest; }
      })();
    /* v0.2.1：一次工具结果 = 一条 role='tool' 消息；文本给模型，events 给 UI 画一行行卡片 */
    function add(text, ev){ parts.push(text); if (ev) events.push(ev); }
  function addImg(dataUrl){ if (dataUrl && imgs.length < 4) imgs.push(dataUrl); }
    function finish(extra){
      UI.holdBusy(-1, sid0);
      var body = parts.join('\n\n');
      if (extra) body += '\n\n' + extra;
      if (!/^\[(run-result|vfs|web|search|preview|play|download|get)\]/.test(body)) body = '[run-result]\n' + body;
      note(body.slice(0, LIMITS.WORK_RESULT_CHARS), sid0, events, imgs);
    }
    (function next(){
      if (w0.cancel){ UI.holdBusy(-1, sid0); return; } // v0.3.0：取消也要归还 busy，否则 S.pend 永久 >0
      if (done >= calls.length){
        w0.turns++;
        finish();
        UI.startStreamFor(sid0); // 结果回灌后自动续跑一轮（目标会话，v2.2）
        return;
      }
      var c = calls[done++];
      /* v0.4.0：扩展系统 —— 关闭的内置工具直接拒绝；技能懒加载；自定义工具走 EXT.runTool */
      if (EXT.isKnownBuiltin(c.op) && !EXT.isOn(c.op)){
        add('[' + c.op + '] 该工具已在「设置 → 扩展」里关闭', { op: c.op, ok: false, brief: '已关闭' });
        next(); return;
      }
      var _pdw = PICK.deny(c.op);
      if (_pdw){ add('[拦截] ' + _pdw, { op: c.op, ok: false, brief: '本轮未允许' }); next(); return; }
      if (EXT.hasSmall(c.op)){                 /* v0.4.1：time/calc/json/http 纯本地小工具 */
        var _tw0 = Date.now();
        EXT.runSmall(c.op, c.arg, c.body).then(function(txt){
          add('[' + c.op + '] ' + txt, { op: c.op, ok: true, ms: Date.now() - _tw0, brief: c.op });
          w0.errStreak = 0;
        }, function(e){
          add('[' + c.op + '] 失败：' + ((e && e.message) || e), { op: c.op, ok: false, brief: '失败' });
        }).then(next);
        return;
      }
      if (c.op === 'skill'){
        var skName = String(c.arg || '').trim().split(/\s+/)[0];
        var sk = EXT.skillText(skName);
        add(sk ? '[skill] ' + skName + '\n```\n' + sk.slice(0, 6000) + '\n```'
               : '[skill] 没有这个技能：' + skName + '（已有：' + (EXT.skillNames(S.cfg.mode).join(', ') || '无') + '）',
            { op: 'skill', ok: !!sk, brief: skName });
        next(); return;
      }
      if (c.op === 'suball'){
        var items = (c.items && c.items.length) ? c.items.slice() : [];
        if (!items.length){
      var rawLines = String((c.arg ? c.arg + '\n' : '') + (c.body || '')).split(/\r?\n/); // v0.3.45：arg 是体首行，body 非空时不能把它丢掉（suball 首条任务曾被吞）
          for (var sli = 0; sli < rawLines.length; sli++){
            var ln = rawLines[sli].trim(); if (!ln) continue;
            var mm2 = ln.match(/^([a-z][a-z0-9-]{1,24})\s*[|:：]\s*(.+)$/) || ln.match(/^([a-z][a-z0-9-]{1,24})\s+(.+)$/);
            if (mm2) items.push({ name: mm2[1], task: mm2[2] });
          }
        }
        if (!items.length){ add('[suball] 没解析出任务（每行：名字 | 任务）', { op: 'suball', ok: false, brief: '解析失败' }); next(); return; }
        var t0a = Date.now();
        SUB.runAll(items, 0).then(function(rs){
          var outTxt = rs.map(function(r){ return '【' + r.name + '】' + (r.ok ? '' : '（失败）') + '\n' + String(r.text).slice(0, 3000); }).join('\n\n');
          var allOk = true; for (var ri = 0; ri < rs.length; ri++) if (!rs[ri].ok) allOk = false;
          var hintA = SUB.stageHint(rs.map(function(r){ return r.name; }));
          add('[suball] ' + rs.length + ' 个并行完成（' + (Date.now() - t0a) + 'ms）\n' + outTxt + (hintA ? '\n' + hintA : ''),
            { op: 'suball', ok: allOk, ms: Date.now() - t0a, brief: rs.map(function(r){ return r.name; }).join(' + ') });
        }, function(e){
          add('[suball] 失败：' + (e && e.message || e), { op: 'suball', ok: false, brief: '失败' });
        }).then(next);
        return;
      }
      if (c.op === 'sub' || c.op === 'agent'){
        var subName = String(c.arg || '').trim().split(/\s+/)[0];
        var subTask = (String(c.arg || '').replace(subName, '') + (c.body ? '\n' + c.body : '')).trim();
        var t0s = Date.now();
        SUB.run(subTask, subName, 0).then(function(txt){
          var hintS = SUB.stageHint([subName]);
          add('[sub] ' + subName + '\n```\n' + String(txt).slice(0, 6000) + '\n```' + (hintS ? '\n' + hintS : ''), { op: 'sub', ok: true, ms: Date.now() - t0s, brief: subName });
        }, function(e){
          add('[sub] ' + subName + ' 失败：' + (e && e.message || e), { op: 'sub', ok: false, brief: '失败' });
        }).then(next);
        return;
      }
      var extTool = EXT.hasTool(c.op);
      if (extTool){
        var t0x = Date.now();
        EXT.runTool(c.op, String(c.arg || '') + (c.body ? '\n' + c.body : '')).then(function(out){
          var txt = String(out == null ? '' : out);
          add('[' + c.op + '] ' + (txt.length > 4000 ? txt.slice(0, 4000) + '\n…（已截断）' : txt || '（无输出）'),
            { op: c.op, ok: true, ms: Date.now() - t0x, brief: extTool.title || c.op });
        }, function(e){
          add('[' + c.op + '] 扩展工具执行失败：' + (e && e.message || e), { op: c.op, ok: false, brief: '执行失败' });
        }).then(next);
        return;
      }
      if (c.op === 'time' || c.op === 'calc' || c.op === 'json' || c.op === 'http'){
        NET.simpleOp(c.op, c.arg, c.body).then(
          function(t){ add('[' + c.op + ']\n' + t, { op: c.op, ok: true, brief: t.split('\n')[0].slice(0, 40) }); w0.errStreak = 0; },
          function(e){ add('[' + c.op + '] 失败：' + ((e && e.message) || e), { op: c.op, ok: false, brief: '失败' }); }
        ).then(next);
        return;
      }
      if (c.op === 'shot'){   /* v1.0.1：截图 → 直接贴进回复 */
        NET.shot().then(function(url){
          try {
            var _mm = (S.msgs || []).filter(function(x){ return x.sid === sid0 && x.role === 'assistant'; }).pop();
            if (_mm){ _mm.content = String(_mm.content || '') + '\n\n![' + (c.arg || '截图') + '](' + url + ')'; UI.repaintMsg(_mm.id); }
            else { UI.toast('截图完成，但没找到可插入的消息'); }
          } catch (e) {}
          add('[shot] 已截图（' + (c.arg || '当前页面') + '）', { op: 'shot', ok: true, brief: '已贴图' });
          next();
        }, function(e){
          add('[shot] 失败：' + ((e && e.message) || e), { op: 'shot', ok: false, brief: '失败' });
          next();
        });
        return;
      }
      /* ---- v0.7.0：批量抓取（起点 URL → 沿翻页抓 N 页 → 落虚拟工作区） ---- */
      if (c.op === 'crawl'){
        var cu = NET.safeUrl(String(c.arg || '').trim());
        if (!cu){ add('[crawl] 地址无效（需 http/https 绝对地址）', { op: 'crawl', ok: false, brief: '地址无效' }); next(); return; }
        var cmax = 20, cm = /max\s*=\s*(\d+)/i.exec(String(c.body || '') + ' ' + String(c.arg || ''));
        if (cm) cmax = Math.min(200, Math.max(1, parseInt(cm[1], 10)));
        add('[crawl] 开始：' + cu + '（最多 ' + cmax + ' 页）', { op: 'crawl', ok: true, brief: '开始抓取' });
        NET.crawl(cu, { max: cmax }).then(function(r){
          var chain = Promise.resolve(), saved = 0;
          r.pages.forEach(function(pg, i){
            chain = chain.then(function(){
              var nm = ('0000' + (i + 1)).slice(-4) + '_' + String(pg.title || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) + '.txt';
              return vfsWrite(sid0, 'crawl/' + nm, (pg.title ? pg.title + '\n\n' : '') + pg.text)
                .then(function(){ saved++; }, function(){});
            });
          });
          return chain.then(function(){
            var msg = '[crawl] 完成：抓到 ' + r.pages.length + ' 页，落盘 ' + saved + ' 个文件，失败 ' + r.fails.length + ' 页';
            if (r.fails.length) msg += '\n' + r.fails.slice(0, 5).map(function(f){ return '  - ' + f.url + '：' + f.err; }).join('\n');
            add(msg, { op: 'crawl', ok: r.fails.length === 0, brief: r.pages.length + ' 页' });
            if (r.pages.length) w0.errStreak = 0;
            if (sid0 === S.sid && RUNNER.renderWs) RUNNER.renderWs();
          });
        }).then(next);
        return;
      }
      /* ---- v0.2.1：联网抓取（页面侧真实请求，走宿主桥/代理，不受沙箱限制） ---- */
      if (c.op === 'web'){
        var u = NET.safeUrl(c.arg);
        if (!u){
          add('[web] 地址无效（需 http/https 绝对地址）：' + (c.arg || '（空）'), { op: 'web', ok: false, brief: '地址无效' });
          next(); return;
        }
        if (NET.isBinaryUrl(u)){
          add('[web] 跳过（图片/媒体/二进制资源，web 只抓文本）：' + u + '；要保存视频用 download，要看起来用 play',
            { op: 'web', url: u, ok: false, brief: '二进制资源，已跳过' });
          next(); return;
        }
        var t0 = Date.now();
        NET.fetchPageText(u).then(function(txt){
          var ms = Date.now() - t0;
          if (!txt){
            add('[web] 抓取失败：' + u + '（可能被反爬/需要登录/网络不通；可改用 search 拿摘要）',
              { op: 'web', url: u, ok: false, ms: ms, brief: '抓取失败（反爬/登录墙/断网）' });
          } else {
            var cut = txt.slice(0, LIMITS.WORK_WEB_CHARS);
            add('[web] ' + u + '（成功，' + txt.length + ' 字' + (txt.length > cut.length ? '，已截断' : '') + '）\n```\n' + cut + '\n```',
              { op: 'web', url: u, ok: true, ms: ms, len: txt.length });
            w0.errStreak = 0;
          }
        }).then(next);
        return;
      }
      /* ---- v0.2.1：联网搜索（复用设置里的搜索服务商） ---- */
      if (c.op === 'search'){
        var q = String(c.arg || '').trim();
        if (!q){ add('[search] 缺少查询词', { op: 'search', ok: false, brief: '缺少查询词' }); next(); return; }
        var ts0 = Date.now();
        NET.searchWeb(q, null, true).then(function(r){
          var ms = Date.now() - ts0;
          if (!r || !r.block){
            add('[search] 未返回结果：' + q + '（检查 设置 → 连接与模型 → 联网搜索 的服务商与密钥）',
              { op: 'search', q: q, ok: false, ms: ms, brief: '未配置搜索服务或无结果' });
          } else {
            add('[search] ' + q + '（' + (r.n || 0) + ' 条，' + (ms / 1000).toFixed(1) + 's）\n\n' + r.block,
              { op: 'search', q: q, ok: true, ms: ms, n: r.n || 0 });
            w0.errStreak = 0;
          }
        }).then(next);
        return;
      }
      if (c.op === 'vfs-write'){
        vfsWrite(sid0, c.arg, c.body).then(
          function(r){ add('[vfs] 已写入 ' + r.path + '（' + sizeFmt(r.size) + '）', { op: 'write', path: r.path, size: sizeFmt(r.size), ok: true }); w0.errStreak = 0;
            if (sid0 === S.sid && RUNNER.renderWs) RUNNER.renderWs(); // 运行面板「工作区」区即时刷新（v2.1）
            RUNNER.previewRefreshIf(sid0, r.path); }, // v2.5：正在预览该文件 → 自动刷新
          function(e){ add('[vfs] 写入失败：' + (e && e.message || '未知错误'), { op: 'write', ok: false, brief: (e && e.message || '未知错误') }); }
        ).then(next);
        return;
      }
      if (c.op === 'patch'){ /* v3.0 #14：补丁式写入 */
        DB.workfsBySid(sid0).then(function(fs){
          var base = null;
          for (var i = 0; i < fs.length; i++) if (fs[i].path === c.arg) base = fs[i].content;
          if (base == null) return Promise.reject(new Error('目标文件不存在：' + c.arg + '（先用 vfs-write 创建）'));
          var next2;
          try { next2 = applyUnified(base, c.body); }
          catch (e) { return Promise.reject(new Error('补丁无法应用：' + e.message)); }
          return vfsWrite(sid0, c.arg, next2).then(function(r){
            if (sid0 === S.sid && RUNNER.renderWs) RUNNER.renderWs();
            RUNNER.previewRefreshIf(sid0, r.path);
            w0.errStreak = 0;
            add('[vfs] 已打补丁 ' + r.path + '（' + sizeFmt(r.size) + '）', { op: 'patch', path: r.path, size: sizeFmt(r.size), ok: true });
          });
        }).catch(function(e){ add('[vfs] 打补丁失败：' + (e && e.message || e), { op: 'patch', ok: false, brief: (e && e.message || String(e)) }); })
          .then(next);
        return;
      }
      if (c.op === 'vfs-list'){
        DB.workfsBySid(sid0).then(function(fs){
          fs.sort(function(a, b){ return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
          var lines = fs.map(function(f){ return f.path + '（' + sizeFmt(f.size || 0) + (f.binary ? '，原文件/二进制' : '') + '）'; });
          add('[vfs] 工作区文件（' + fs.length + ' 项）' + (lines.length ? '\n```\n' + lines.join('\n') + '\n```' : '（空）'), { op: 'list', n: fs.length, ok: true });
        }).then(next);
        return;
      }
      /* v1.1.21：读工作区文件（附件提取文本 / 产物原文） */
      if (c.op === 'vfs-read'){
        var rp = normPath(c.arg);
        if (!rp){ add('[vfs] 读取失败：路径无效（用相对路径，不许 ..）', { op: 'read', ok: false, brief: '路径无效' }); next(); return; }
        DB.workfsBySid(sid0).then(function(fs){
          var f = null;
          for (var i = 0; i < fs.length; i++) if (fs[i].path === rp) f = fs[i];
          if (!f){ add('[vfs] 文件不存在：' + rp + '（先用 vfs-list 看工作区路径）', { op: 'read', path: rp, ok: false, brief: '文件不存在' }); return; }
          if (f.binary){
            add('[vfs] ' + f.path + '（' + sizeFmt(f.size || 0) + '，原文件/二进制，不能按文本读取）\n文本内容请读同名的 .md（文档提取文本）或在右侧工作区预览/下载原文件。',
              { op: 'read', path: f.path, ok: true, binary: true });
            return;
          }
          var txt = String(f.content || '');
          var cut = txt.slice(0, LIMITS.WORK_WEB_CHARS);
          add('[vfs] ' + f.path + '（' + sizeFmt(f.size || 0) + (txt.length > cut.length ? '，已截断，共 ' + txt.length + ' 字' : '，全文') + '）\n```\n' + cut + '\n```',
            { op: 'read', path: f.path, ok: true });
        }).then(next);
        return;
      }
      /* ---- v0.2.8：任意 URL → 磁盘（图片/PDF/Office/压缩包/音视频都能存；文档顺手抽文本）---- */
      if (c.op === 'get'){
        var gline = String(c.arg || '').trim().split('\n')[0].trim();
        var gurl = (gline.split(/\s+/)[0] || '');
        if (!/^https?:\/\//i.test(gurl)){
          add('[get] 首行需要文件直链（http/https）：' + (gline || '（空）'), { op: 'get', ok: false, brief: '缺少地址' });
          next(); return;
        }
        var tg0 = Date.now(), lastT = 0;
        NET.fileGet(gurl, '', function(pr){
          var now = Date.now(); if (now - lastT < 1200) return; lastT = now;
          UI.toast('抓取中 ' + (pr.got / 1048576).toFixed(1) + ' / ' + (pr.total ? (pr.total / 1048576).toFixed(1) : '?') + ' MB');
        }).then(function(r){
          var head = '[get] 已保存：' + r.path + '（' + sizeFmt(r.size || 0) + '，' + (r.ext || '') + (r.mime ? ' / ' + r.mime : '') + '）';
          var meta = { op: 'get', path: r.path, size: sizeFmt(r.size || 0), ms: Date.now() - tg0, ok: true };
          /* v0.2.9：图片 → data URL 随结果附上，模型直接看图 */
          if (r.img && r.b64){
            var durl = 'data:' + (r.mime || 'image/png') + ';base64,' + r.b64;
            addImg(durl);
            add(head + '\n（图片已附在本条结果里，请直接看图片内容作答，不要猜）', meta);
            next(); return;
          }
          if (!r.b64){ add(head, meta); next(); return; }
          return NET.fileText(r).then(function(txt){
            txt = String(txt || '').replace(/\r/g, '').trim();
            add(txt ? head + '\n\n' + '```' + '\n' + txt.slice(0, 4000) + (txt.length > 4000 ? '\n…（已截断，共 ' + txt.length + ' 字）' : '') + '\n' + '```' : head + '\n（该文件没有可提取的文本层）', meta);
          }, function(e){
            add(head + '\n（文本提取失败：' + (e && e.message || e) + '）', meta);
          }).then(next);
        }, function(e){
          add('[get] 抓取失败：' + (e && e.message || e), { op: 'get', ok: false, brief: (e && e.message || String(e)).slice(0, 60) });
          next();
        });
        return;
      }
      /* ---- v0.2.4：把视频下载成 mp4 落到磁盘（宿主持有 Referer/UA；网页版无此能力） ---- */
      if (c.op === 'download'){
        var darg = String(c.arg || '').trim();
        var dhead = (darg.split('\n')[0] || '').trim();
        var dm = /BV[0-9A-Za-z]{10}/.exec(dhead);
        var dbvid = dm ? dm[0] : '';
        var durl = /^https?:\/\//i.test(dhead) ? dhead : '';
        if (!dbvid && !durl){
          add('[download] 首行需要视频页 URL 或 BV 号：' + (dhead || '（空）'), { op: 'download', ok: false, brief: '缺少地址' });
          next(); return;
        }
        var td0 = Date.now(), lastToast = 0;
        NET.mediaDownload({
          bvid: dbvid, url: durl, qn: 80,
          onProgress: function(pr){
            var now = Date.now();
            if (now - lastToast < 1500) return;
            lastToast = now;
            UI.toast('下载中 ' + (pr.got / 1048576).toFixed(1) + ' / ' + (pr.total ? (pr.total / 1048576).toFixed(1) : '?') + ' MB');
          }
        }).then(function(r){
          add('[download] 已保存：' + r.path + '（' + sizeFmt(r.size || 0) + (r.quality ? '，' + r.quality : '') + '）',
            { op: 'download', path: r.path, size: sizeFmt(r.size || 0), ms: Date.now() - td0, ok: true });
          UI.toast('视频已下载：' + r.path);
        }, function(e){
          add('[download] 下载失败：' + (e && e.message || e), { op: 'download', ok: false, brief: (e && e.message || String(e)).slice(0, 60) });
        }).then(next);
        return;
      }
      /* ---- v1.28.1：内置浏览器窗口（任意网页，带 cookie/登录态） ---- */
      if (c.op === 'browser'){
        var bu = NET.safeUrl(String(c.arg || '').trim() || String(c.body || '').trim());
        if (!bu){ add('[browser] 地址无效（需 http/https 绝对地址）：' + (c.arg || '（空）'), { op: 'browser', ok: false, brief: '地址无效' }); next(); return; }
        /* v1.1.13：工具打开网页优先进右侧「网页」侧栏，只有侧栏不可用才退回独立播放窗口 */
        var bo = false;
        try { bo = (typeof RUNNER !== 'undefined' && RUNNER.openWeb && RUNNER.openWeb(bu)); } catch (e) { bo = false; }
        if (!bo) bo = NET.openExternal(bu, 'window');
        add('[browser] ' + (bo ? '已在右侧侧栏打开：' : '打开失败：') + bu, { op: 'browser', url: bu, ok: !!bo });
        next(); return;
      }
      /* ---- v0.2.3：在应用内播放窗口打开视频/网页（顶层 WebView2，带 Referer 与登录态） ---- */
      if (c.op === 'play'){
        var pu = NET.safeUrl(c.arg);
        if (!pu){ add('[play] 地址无效（需 http/https 绝对地址）：' + (c.arg || '（空）'), { op: 'play', ok: false, brief: '地址无效' }); next(); return; }
        var opened2 = NET.openExternal(pu, 'window');
        add('[play] 已在播放窗口打开：' + pu, { op: 'play', url: pu, ok: !!opened2 });
        next(); return;
      }
      if (c.op === 'preview'){ /* v2.6：AI 打开右侧内置侧边栏浏览器预览 VFS 文件 */
        var pp = String(c.arg || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
        if (!pp || pp.indexOf('..') >= 0){ add('[preview] 路径无效（需工作区相对路径）：' + (c.arg || '（空）'), { op: 'preview', ok: false, brief: '路径无效' }); next(); return; }
        if (sid0 !== S.sid){ add('[preview] 已就绪：' + pp + '（后台会话，切回本会话可预览）', { op: 'preview', path: pp, ok: true }); next(); return; }
        RUNNER.previewTo(sid0, pp, true);
        add('[preview] 已在运行面板打开：' + pp, { op: 'preview', path: pp, ok: true });
        next();
        return;
      }
      /* op === 'run' */
      var kind = crKind(c.arg);
      if (!kind){ add('[run-result] 不支持的类型：' + (c.arg || '（空）') + '（可用 html/svg/js/css/c）', { op: 'run', ok: false, brief: '不支持的类型' }); next(); return; }
      RUNNER.runCapture(kind, c.body, sid0 === S.sid).then(function(r){
        var brief = String(r.output || r.error || '').split('\n')[0].slice(0, 90);
        add(fmtRun(r, kind), { op: 'run', kind: kind, ok: !!r.ok, ms: r.ms, brief: brief });
        if (!r.ok){
          var key = String(r.error || r.output || '').replace(/\d+/g, 'N').slice(0, 120); // 错误归一（数字泛化）
          if (key && key === w0.lastErr) w0.errStreak++; else { w0.lastErr = key; w0.errStreak = 1; }
        } else w0.errStreak = 0;
      }).then(function(){
        if (LIMITS.WORK_SAME_ERR > 0 && w0.errStreak >= LIMITS.WORK_SAME_ERR){
          /* v3.0 #16：先在第二次同型错误时做一次「带错误上下文的自愈」，仍失败才停 */
          if (!w0.healed){
            w0.healed = 1;
            w0.turns++;
            finish('（同型错误已连续 ' + w0.errStreak + ' 次：请对照上方报错逐条修正后再运行，不要重复原写法）');
            UI.startStreamFor(sid0);
            return;
          }
          w0.turns++;
          finish('（同型错误已连续 ' + w0.errStreak + ' 次，含 1 次自愈重试仍失败，停止自动修复，请人工查看上方输出）');
          UI.toast('Work：同型错误连续 ' + w0.errStreak + ' 次，已停止自动修复', true);
          return; // 不续跑
        }
        next();
      });
    })();
  }
  return {
    handleTurn: handleTurn, scan: scan, applyUnified: applyUnified,
    reset: function(sid){ stMap[sid || S.sid] = { turns: 0, cancel: false, t0: 0, errStreak: 0, lastErr: '' }; }, // v2.2：按会话
    stop: function(sid){ stOf(sid).cancel = true; },                                                          // v2.2：按会话
    protocol: PROTOCOL, vfsWrite: vfsWrite
  };
})();

