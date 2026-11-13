/* v0.4.2：生成视频（最小可用、可配置；同步返回 url 或 {id,status} 轮询）
   只负责请求与解析；不生成假视频，失败/超时明确报错。 */
(function(){
  'use strict';
  var POLL_MAX = 60, POLL_MS = 3000;
  function cfg(){ return (typeof S !== 'undefined' && S.cfg) ? S.cfg : {}; }
  function profile(){
    try { if (window.SOUL && SOUL.profile) return SOUL.profile(); } catch (e) {}
    return (cfg().soulProfile) || {};
  }
  function baseRaw(){
    var c = cfg(), p = profile(), a = p.abilities || {};
    return String(c.videoBase || a.videoBase || '').trim();
  }
  function normBase(raw){
    var b = String(raw || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    /* 已带 /v1、/v2、/v1beta 的保留；否则补 /v1 */
    if (/\/v\d+[a-z]*$/i.test(b)) return b;
    return b + '/v1';
  }
  function available(){ return !!baseRaw(); }
  function key(){ var c = cfg(); return String(c.videoKey || c.apiKey || '').trim(); }
  function authHeaders(){
    var h = { 'Content-Type': 'application/json' };
    var k = key();
    if (k) h.Authorization = 'Bearer ' + k;
    return h;
  }
  function fetchJson(url, opt){
    return fetch(url, opt).then(function(res){
      return res.text().then(function(txt){
        var j = null;
        try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!res.ok){
          var msg = (j && (j.error && (j.error.message || j.error) || j.message)) || txt || '';
          throw new Error('HTTP ' + res.status + (msg ? '：' + String(msg).slice(0, 300) : ''));
        }
        if (!j) throw new Error('接口没有返回 JSON：' + String(txt || '').slice(0, 200));
        return j;
      });
    });
  }
  function urlOf(j){
    if (!j || typeof j !== 'object') return '';
    if (typeof j.url === 'string' && j.url) return j.url;
    if (typeof j.video_url === 'string' && j.video_url) return j.video_url;
    if (Array.isArray(j.data) && j.data[0]){
      var d0 = j.data[0];
      if (typeof d0 === 'string') return d0;
      if (d0 && typeof d0.url === 'string') return d0.url;
    }
    if (j.output){
      if (typeof j.output === 'string') return j.output;
      if (Array.isArray(j.output) && typeof j.output[0] === 'string') return j.output[0];
      if (j.output && typeof j.output.url === 'string') return j.output.url;
    }
    if (j.result && typeof j.result.url === 'string') return j.result.url;
    return '';
  }
  function statusOf(j){
    return String((j && (j.status || j.state || (j.data && j.data[0] && j.data[0].status))) || '').toLowerCase();
  }
  function poll(base, id, opt){
    var tries = 0;
    var url = base + '/videos/' + encodeURIComponent(id);
    function frame(msg){ try { if (opt && opt.onFrame) opt.onFrame(msg); } catch (e) {} }
    function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
    function step(){
      if (tries >= POLL_MAX) return Promise.reject(new Error('视频生成超时（' + POLL_MAX + ' 次轮询仍未完成）'));
      tries++;
      return fetchJson(url, { method: 'GET', headers: authHeaders() }).then(function(j){
        var u = urlOf(j), st = statusOf(j);
        frame((st || '处理中') + ' · ' + tries + '/' + POLL_MAX);
        if (u) return u;
        if (st === 'failed' || st === 'error' || st === 'cancelled' || st === 'canceled'){
          var em = (j && (j.error && (j.error.message || j.error) || j.message)) || st;
          throw new Error('视频生成失败：' + String(em).slice(0, 300));
        }
        if (tries >= POLL_MAX) throw new Error('视频生成超时（' + POLL_MAX + ' 次轮询仍未完成）');
        return wait(POLL_MS).then(step);
      });
    }
    return step();
  }
  function generate(opt){
    opt = opt || {};
    var prompt = String(opt.prompt || '').trim();
    if (!prompt) return Promise.reject(new Error('缺少提示词'));
    var raw = baseRaw();
    if (!raw) return Promise.reject(new Error('还没有配置视频接口 Base URL'));
    var base = normBase(raw);
    var body = {
      model: String(opt.model || cfg().videoModel || (profile().abilities || {}).videoModel || '').trim(),
      prompt: prompt,
      size: String(opt.size || cfg().videoSize || '1280x720'),
      seconds: Number(opt.seconds || cfg().videoSeconds || 5)
    };
    if (!body.model) return Promise.reject(new Error('还没有配置视频模型'));
    try { if (opt.onFrame) opt.onFrame('已提交'); } catch (e) {}
    return fetchJson(base + '/videos/generations', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body)
    }).then(function(j){
      var u = urlOf(j);
      if (u) return u;
      var st = statusOf(j);
      if (st === 'failed' || st === 'error') throw new Error('视频生成失败：' + String((j && (j.error && (j.error.message || j.error) || j.message)) || st).slice(0, 300));
      if (j && j.id) return poll(base, j.id, opt);
      throw new Error('接口没有返回 url 或 id，无法继续');
    }).then(function(u){
      try { if (opt && opt.onDone) opt.onDone(u); } catch (e) {}
      return u;
    }, function(e){
      try { if (opt && opt.onError) opt.onError(e); } catch (e2) {}
      throw e;
    });
  }
  window.VIDEO = { available: available, generate: generate, base: baseRaw, normBase: normBase, urlOf: urlOf, statusOf: statusOf };
})();
