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
NET.bridge.init();
Vault.avail = NET.bridge.ok; // F4：有宿主桥才启用 DPAPI 保险库
if (Vault.avail) Vault.hydrate(S.cfg).then(function(){ saveCfg(); }); // 迁移：把旧 localStorage 明文密钥入保险库并脱敏重写
UI.init();
try { window.NET = NET; } catch (e) {} // Soul：记忆巩固/落盘要用 NET.chatOnce / NET.mem
try { if (window.SOUL && SOUL.hydrate) SOUL.hydrate(); } catch (e) {} // S7：宿主内把磁盘记忆读回（文件优先）
try { if (window.SOUL && SOUL.tick){ setTimeout(function(){ SOUL.tick(); }, 4000); setInterval(function(){ SOUL.tick(); }, 60000); } } catch (e) {} // S6：到点提醒（页面开着才跑）
MODE.mountUI(); // v0.6.0：自定义模式按钮
UI.DUAL.init(); // v1.4：双开视图
if (!Vault.avail) UI.toast('未连接宿主：API Key 将明文存于浏览器 localStorage，建议使用桌面版', true);
DB.open()
  .then(function(){ UI.reloadSessions(true); }) // 每次启动进入新建会话（草稿态，发送首条消息才落库）；不再做任何自动删除
  .catch(function(){ UI.toast('本地数据库打开失败，历史记录将不可用', true); });
})();