(function(){
  'use strict';
  function normBase(u){
    try { u = String(u || '').trim().replace(/\/+$/, ''); } catch(e){ u = ''; }
    if (!u) return '';
    return u.replace(/\/chat\/completions$/i, '').replace(/\/responses$/i, '');
  }
  function cfg(){
    try { if (typeof S !== 'undefined' && S && S.cfg) return S.cfg; } catch(e){}
    try { if (typeof window !== 'undefined' && window._S && window._S.cfg) return window._S.cfg; } catch(e){}
    return {};
  }
  function getBase(){
    var c = cfg();
    var imgBase = c.imgBase ? String(c.imgBase).trim() : '';
    if (imgBase) return normBase(imgBase);
    var b = c.baseURL ? String(c.baseURL).trim() : '';
    if (!b) return '';
    return normBase(b);
  }
  function getUrl(){
    var base = getBase();
    if (!base) return '';
    // ensure /v1 if it doesn't look like it has a version
    if (!/\/v\d+$/i.test(base) && !/\/v\d+\//i.test(base)) base += '/v1';
    return base + '/images/generations';
  }
  function b64ToBlob(b64){
    try {
      b64 = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
      var bin = atob(b64);
      var len = bin.length;
      var arr = new Uint8Array(len);
      for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'image/png' });
    } catch(e){ return null; }
  }
  function downloadUrl(u){
    if (!u) return Promise.resolve(null);
    // direct fetch for binary; NET.raw returns text and corrupts binaries
    try {
      return fetch(u).then(function(r){ return r.ok ? r.blob() : null; }).catch(function(){ return null; });
    } catch(e){ return Promise.resolve(null); }
  }
  var IMG = {
    available: function(){
      try {
        if (!getBase()) return false;
        var c = cfg();
        var key = c.apiKey ? String(c.apiKey).trim() : '';
        if (key) return true;
        try {
          var h = typeof authHeaders === 'function' ? authHeaders() : {};
          if (h && (h.Authorization || h['x-api-key'] || h['api-key'])) return true;
        } catch(e2){}
        return false;
      } catch(e){ return false; }
    },
    generate: function(opt){
      opt = opt || {};
      var url = getUrl();
      if (!url) { try { opt.onError && opt.onError(new Error('未配置生图地址')); } catch(e){} return; }
      var headers = typeof authHeaders === 'function' ? authHeaders() : {};
      try { if (typeof hostHeaders === 'function') hostHeaders(headers, url); } catch(e){}
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      var c = cfg();
      var partial = (opt.partial == null) ? (c.imgPartial != null ? c.imgPartial : 2) : opt.partial;
      if (partial < 0) partial = 0; if (partial > 3) partial = 3;
      var body = {
        model: opt.model || c.imgModel || 'gpt-image-1',
        prompt: opt.prompt || '',
        n: opt.n || 1,
        size: opt.size || c.imgSize || '1024x1024',
        response_format: 'b64_json',
        stream: true,
        partial_images: partial
      };
      var buf = '';
      var doneFinal = false;
      var partialCount = 0;
      var aborted = false;
      var handle = null;
      function onChunk(t){
        if (aborted || doneFinal) return;
        buf += String(t || '');
        // parse SSE
        var parts = buf.split(/\r?\n\r?\n/);
        buf = parts.pop() || '';
        for (var i = 0; i < parts.length; i++){
          var p = parts[i];
          // extract data lines
          var dataLines = [];
          var lines = p.split(/\r?\n/);
          for (var j = 0; j < lines.length; j++){
            var l = lines[j];
            if (l.indexOf('data:') === 0){
              var ds = l.slice(5).trim();
              if (ds === '[DONE]') continue;
              dataLines.push(ds);
            } else if (/^event:/i.test(l)){
              // keep
            }
          }
          if (!dataLines.length) continue;
          var rawData = dataLines.join('\n');
          var j2;
          try { j2 = JSON.parse(rawData); } catch(e){ continue; }
          // check event types
          var typ = j2.type || '';
          // partial
          if (typ === 'image_generation.partial_image' || typ === 'response.image_generation_call.partial_image' || typ.indexOf('partial_image') >= 0){
            var pb = j2.b64_json || j2.partial_image_b64 || (j2.image && (j2.image.b64_json || j2.image.partial_image_b64));
            if (!pb && j2.data && typeof j2.data === 'object'){
              pb = j2.data.b64_json || j2.data.partial_image_b64;
            }
            if (pb){
              partialCount++;
              var idx = (j2.index != null) ? j2.index : (j2.partial_image_index != null ? j2.partial_image_index : partialCount - 1);
              var b2 = b64ToBlob(pb);
              if (b2 && typeof opt.onPartial === 'function') try { opt.onPartial(b2, idx); } catch(e){}
              if (typ.indexOf('completed') >= 0 || typ === 'image_generation.completed'){
                // also final?
              }
              continue;
            }
          }
          // completed
          if (typ === 'image_generation.completed' || typ === 'response.image_generation_call.completed'){
            var fb = j2.b64_json || (j2.image && j2.image.b64_json) || (j2.data && j2.data.b64_json);
            if (!fb && j2.images && j2.images[0]) fb = j2.images[0].b64_json || j2.images[0].b64;
            if (fb){
              doneFinal = true;
              var bf = b64ToBlob(fb);
              try { opt.onFinal && opt.onFinal(bf); } catch(e){}
              done(200);
              return;
            }
          }
          // any b64_json -> final
          if (j2.b64_json && !doneFinal){
            // if it's in a partial context? spec says "任何带 `b64_json` 的 data 行都当最终图"
            doneFinal = true;
            var bf2 = b64ToBlob(j2.b64_json);
            try { opt.onFinal && opt.onFinal(bf2); } catch(e){}
            done(200);
            return;
          }
          if (j2.data && Array.isArray(j2.data)){
            for (var k = 0; k < j2.data.length; k++){
              var d = j2.data[k];
              if (d.b64_json && !doneFinal){
                doneFinal = true;
                var bf3 = b64ToBlob(d.b64_json);
                try { opt.onFinal && opt.onFinal(bf3); } catch(e){}
                done(200);
                return;
              }
            }
          }
        }
      }
      function done(status){
        try { if (handle && handle.abort) { /* don't call again */ } } catch(e){}
        // done called
      }
      function doStream(){
        if (typeof NET !== 'undefined' && NET.rawStream){
          handle = NET.rawStream({
            url: url,
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body),
            onChunk: onChunk,
            onDone: function(status){
              if (doneFinal) return;
              // if non-SSE or ended without final, try fallback
              if (status >= 400){
                doFallback();
                return;
              }
              // check if we got any json with data array (non-sse response)
              if (buf){
                try {
                  var bj = JSON.parse(buf);
                  if (bj.data && bj.data[0]){
                    var fbj = bj.data[0].b64_json;
                    if (fbj){ doneFinal = true; var bfj = b64ToBlob(fbj); try { opt.onFinal && opt.onFinal(bfj); } catch(e){} return; }
                    if (bj.data[0].url){
                      downloadUrl(bj.data[0].url).then(function(bl){ if (!doneFinal){ doneFinal = true; try { opt.onFinal && opt.onFinal(bl); } catch(e){} } });
                      return;
                    }
                  }
                } catch(e){}
              }
              if (!doneFinal) doFallback();
            },
            onError: function(e){
              if (doneFinal) return;
              // try fallback on error
              doFallback(e);
            }
          });
        } else {
          doFallback();
        }
      }
      function doFallback(prevErr){
        // try non-stream
        var b2 = JSON.parse(JSON.stringify(body));
        delete b2.stream;
        delete b2.partial_images;
        var h2 = JSON.parse(JSON.stringify(headers));
        if (typeof NET !== 'undefined' && NET.raw){
          NET.raw({ url: url, method: 'POST', headers: h2, body: JSON.stringify(b2), timeout: 300000 })
            .then(function(r){
              if (!r) { try { opt.onError && opt.onError(prevErr || new Error('请求失败')); } catch(e){} return; }
              if (r.status === 400 || r.status === 404){ try { opt.onError && opt.onError(new Error('HTTP ' + r.status)); } catch(e){} return; }
              if (r.status < 200 || r.status >= 300){ try { opt.onError && opt.onError(new Error('HTTP ' + r.status)); } catch(e){} return; }
              var ct = (r.headers && (r.headers['content-type'] || r.headers['Content-Type'])) || '';
              if (ct.indexOf('text/event-stream') >= 0){ try { opt.onError && opt.onError(prevErr || new Error('非预期流式响应')); } catch(e){} return; }
              var j;
              try { j = JSON.parse(r.text); } catch(e){ try { opt.onError && opt.onError(new Error('响应解析失败')); } catch(e2){} return; }
              if (j.error){ var em = j.error.message || j.error.code || '上游错误'; try { opt.onError && opt.onError(new Error(em)); } catch(e){} return; }
              if (j.data && j.data[0]){
                var fb = j.data[0].b64_json;
                if (fb){ doneFinal = true; var bfb = b64ToBlob(fb); try { opt.onFinal && opt.onFinal(bfb); } catch(e){} return; }
                if (j.data[0].url){
                  downloadUrl(j.data[0].url).then(function(bl){ if (!doneFinal){ doneFinal = true; try { opt.onFinal && opt.onFinal(bl); } catch(e){} } });
                  return;
                }
              }
              try { opt.onError && opt.onError(prevErr || new Error('无图片数据')); } catch(e){}
            }).catch(function(e){ try { opt.onError && opt.onError(e); } catch(e2){} });
        } else {
          fetch(url, { method: 'POST', headers: h2, body: JSON.stringify(b2) })
            .then(function(res){ if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .then(function(j){
              if (j.data && j.data[0]){
                var fb = j.data[0].b64_json;
                if (fb){ doneFinal = true; var bfb = b64ToBlob(fb); try { opt.onFinal && opt.onFinal(bfb); } catch(e){} return; }
                if (j.data[0].url){
                  return downloadUrl(j.data[0].url).then(function(bl){ if (!doneFinal){ doneFinal = true; try { opt.onFinal && opt.onFinal(bl); } catch(e){} } });
                }
              }
              throw new Error('无图片数据');
            }).catch(function(e){ try { opt.onError && opt.onError(e); } catch(e2){} });
        }
      }
      doStream();
      return {
        abort: function(){
          aborted = true;
          try { if (handle && handle.abort) handle.abort(); } catch(e){}
        }
      };
    }
  };
  try { window.IMG = IMG; } catch(e){}
  try { if (typeof module !== 'undefined') module.exports = IMG; } catch(e){}
})();
