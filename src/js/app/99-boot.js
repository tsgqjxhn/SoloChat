/* 调试钩子（仅当 localStorage['sc.debug']==='1'）：便于自动化测试 Work 沙箱的纯函数 */
try {
try { document.title = 'SoloChat ' + APP_VER; } catch (e) {} // v0.3.27：标题栏直接显示当前构建版本，便于确认装的是哪个包
  try { window._S = S; window._UI = UI; window._DB = DB; window._NET = NET; } catch(e){}
  if (localStorage.getItem('sc.debug') === '1'){
    window.SC_WORK = WORK;
    window.SC_DBG = { EXT: EXT, SUB: SUB, MODE: MODE, PICK: PICK, label: modelLabel, modelCaps: NET.modelCaps, md: MD, busy: UI.holdBusy, stage: STAGE_PROTOCOL, net: NET, openSettings: UI.openSettings, setCfg: setCfg, cfg: function(){ return S.cfg; }, ocr: OCR,
      ws: function(){ var c = curSession(); return (c && c.workspace) || ''; },
      bindWs: function(path){ var c = curSession(); if (!c) return ''; c.workspace = path; DB.putSession(c); return c.workspace; },
      sid: function(){ return S.sid; },
   hint: function(a, b){ UI.routeHint(a, b); },
   hideHint: function(){ UI.hideRouteHint(); },
   fs: NET.fs,
   snaps: function(){ return SC_SNAPS; },
  chatMd: function(msgs, s){ return chatToMarkdown(msgs, s); }, // v0.3.35：便于自测
  ver: APP_VER, // v0.3.16：唯一来源
   diag: function(){ return DIAG; },
   FS: FS, DB: DB,
   search: function(q){ return NET.searchWeb(q, null, true); },
   src: function(){ return RUNNER.srcs(); },
   addSrc: function(a, b, c, d){ RUNNER.addSources(a, b, c, d); },
   renderSrc: function(){ RUNNER.renderSrc(); },
      cfg: function(){ return S.cfg; },
      setCfg: function(o){ setCfg(o); } };
  }
} catch (e) {}
loadCfg();
document.body.classList.toggle('sb-collapsed', S.cfg.sbHidden !== false); // v1.3：按钮 / Ctrl+B 控制，不再悬浮呼出
/* Android 0.3.0：窄屏默认收起侧栏，左上角 ☰ 呼出；桌面布局不受影响 */
(function(){
  try {
    if (!window.matchMedia || !matchMedia('(max-width:860px), (max-height:520px) and (pointer:coarse)').matches) return;
    document.body.classList.add('m-phone', 'sb-collapsed');
    var b = document.createElement('button');
    b.id = 'm-menu'; b.type = 'button'; b.setAttribute('aria-label', '会话列表'); b.textContent = '☰';
    b.addEventListener('click', function(e){ e.stopPropagation(); document.body.classList.toggle('sb-collapsed'); });
    document.body.appendChild(b);
    var sbq = document.getElementById('sb-q');
    if (sbq) sbq.placeholder = '搜索会话'; /* 手机无 Ctrl+K，去掉桌面快捷键提示 */
    document.addEventListener('click', function(e){
      if (document.body.classList.contains('sb-collapsed')) return;
      if (e.target.closest && (e.target.closest('#sidebar') || e.target === b)) return;
      document.body.classList.add('sb-collapsed');
    });
    var sl = document.getElementById('session-list');
    if (sl) sl.addEventListener('click', function(){ document.body.classList.add('sb-collapsed'); });
    var ip = document.getElementById('input');
    if (ip) ip.placeholder = '输入消息…';
  } catch (e) {}
})();
/* Android 0.3.0：接收系统分享（文字填输入框，图片进附件栏） */
window.__scShare = function(o){
  try {
    window.__lastShare = o;
    if (typeof o === 'string') o = JSON.parse(o);
    if (!o) return;
    if (o.text){
      var i = document.getElementById('input');
      if (i){ i.value = String(o.text); try { UI.autosize(); } catch (e) {} i.focus(); }
    }
    if (o.dataUrl){
      try {
        var m = /^data:([^;,]+);base64,(.*)$/.exec(String(o.dataUrl));
        if (m){
          var bin = atob(m[2]);
          var arr = new Uint8Array(bin.length);
          for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
          var f = new File([arr], o.name || 'share.jpg', { type: m[1] || 'image/jpeg' });
          UI.addFiles([f]);
        }
      } catch (e2) {}
    }
  } catch (e) {}
};
NET.bridge.init();
Vault.avail = NET.bridge.ok; // F4：有宿主桥才启用 DPAPI 保险库
if (Vault.avail) Vault.hydrate(S.cfg).then(function(){
  var fx = [];
  try { fx = sanitizePresetKeys(S.cfg); } catch (e) {}
  saveCfg();
  if (fx.length) try { UI.toast('已清理 ' + fx.length + ' 个配置中不属于该供应商的 Key，请重新填写', true); } catch (e2) {}
});
UI.init();
/* v0.5.8：浏览器模式没有保险库，启动即校验；宿主模式下面在 hydrate 后已校验 */
try {
  if (!Vault.avail){
    var fx0 = sanitizePresetKeys(S.cfg);
    if (fx0.length){ saveCfg(); UI.toast('已清理 ' + fx0.length + ' 个配置中不属于该供应商的 Key，请重新填写', true); }
  }
} catch (e) {}
try { window.NET = NET; } catch (e) {} // Soul：记忆巩固/落盘要用 NET.chatOnce / NET.mem
/* Android：把主应用的连接配置同步给原生截图问答，避免两套 Key */
try {
  if (window.__SC_ANDROID__ && window.AndroidBridge && S.cfg.apiKey){
    AndroidBridge.post(JSON.stringify({ t: 'cfg', base: S.cfg.baseURL || '', key: S.cfg.apiKey, model: S.cfg.currentModel || S.cfg.defaultModel || '' }));
  }
} catch (e) {}
try { if (window.SOUL && SOUL.hydrate) SOUL.hydrate(); } catch (e) {} // S7：宿主内把磁盘记忆读回（文件优先）
try { if (window.SOUL && SOUL.tick){ setTimeout(function(){ SOUL.tick(); }, 4000); setInterval(function(){ SOUL.tick(); }, 60000); } } catch (e) {} // S6：到点提醒（页面开着才跑）
try { if (window.SOUL && SOUL.maybeDream) setTimeout(function(){ SOUL.maybeDream(); }, 12000); } catch (e) {} // S4：每日自动巩固
MODE.mountUI(); // v0.6.0：自定义模式按钮
UI.DUAL.init(); // v1.4：双开视图
if (!Vault.avail) UI.toast('未连接宿主：API Key 将明文存于浏览器 localStorage，建议使用桌面版', true);
DB.open()
  .then(function(){ UI.reloadSessions(true); }) // 每次启动进入新建会话（草稿态，发送首条消息才落库）；不再做任何自动删除
  .catch(function(){ UI.toast('本地数据库打开失败，历史记录将不可用', true); });
})();