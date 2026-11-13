/* v0.4.2：语音输入 / 合成（浏览器原生 Web Speech API；零依赖，不可用明确报错） */
(function(){
  'use strict';
  function cfg(){ return (typeof S !== 'undefined' && S.cfg) ? S.cfg : {}; }
  function prof(){
    try { if (window.SOUL && SOUL.profile) return SOUL.profile(); } catch (e) {}
    return (cfg().soulProfile) || {};
  }
  function clean(t){
    return String(t || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/^[#>*\-+]\s*/gm, '')
      .replace(/[*_~]{1,3}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function speakSupported(){ return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); }
  function listenSupported(){ return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  function voices(){
    if (!window.speechSynthesis) return [];
    try { return speechSynthesis.getVoices() || []; } catch (e) { return []; }
  }
  function speak(text){
    return new Promise(function(res, rej){
      if (!speakSupported()) return rej(new Error('当前环境不支持语音合成'));
      var t = clean(text);
      if (!t) return rej(new Error('没有可朗读的文字'));
      var p = prof() || {}, v = p.voice || {};
      var rate = Number(v.rate || cfg().ttsRate || 1);
      if (!isFinite(rate) || rate <= 0) rate = 1;
      rate = Math.max(0.5, Math.min(2, rate));
      var u = new SpeechSynthesisUtterance(t.slice(0, 6000));
      u.lang = p.sttLang || cfg().sttLang || 'zh-CN';
      u.rate = rate;
      var want = String(v.name || cfg().ttsVoice || '').trim();
      if (want){
        var list = voices();
        for (var i = 0; i < list.length; i++){
          if (list[i].name === want || list[i].voiceURI === want){ u.voice = list[i]; if (list[i].lang) u.lang = list[i].lang; break; }
        }
      }
      var done = false;
      u.onend = function(){ if (done) return; done = true; res(true); };
      u.onerror = function(e){ if (done) return; done = true; rej(new Error('语音合成失败：' + ((e && e.error) || '未知'))); };
      try { speechSynthesis.cancel(); } catch (e) {}
      try { speechSynthesis.speak(u); }
      catch (e) { if (!done){ done = true; rej(e); } }
    });
  }
  function stop(){
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
    try { if (window._SC_STT_REC && window._SC_STT_REC.abort) window._SC_STT_REC.abort(); } catch (e) {}
  }
  function listen(cb){
    return new Promise(function(res, rej){
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return rej(new Error('当前环境不支持语音识别'));
      var p = prof() || {};
      var rec;
      try { rec = new SR(); } catch (e) { return rej(e); }
      window._SC_STT_REC = rec;
      rec.lang = p.sttLang || cfg().sttLang || 'zh-CN';
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      var done = false, text = '';
      rec.onresult = function(ev){
        try {
          for (var i = ev.resultIndex; i < ev.results.length; i++){
            var r = ev.results[i];
            if (r.isFinal) text += (r[0] && r[0].transcript) || '';
          }
          if (!text && ev.results && ev.results[0] && ev.results[0][0]) text = ev.results[0][0].transcript || '';
        } catch (e) {}
      };
      rec.onerror = function(e){
        if (done) return; done = true;
        var m = (e && e.error) || '未知';
        if (m === 'not-allowed' || m === 'service-not-allowed') m = '麦克风权限被拒绝';
        else if (m === 'no-speech') m = '没有听到声音';
        else if (m === 'network') m = '语音服务网络不可用';
        rej(new Error(m));
      };
      rec.onend = function(){
        if (done) return; done = true;
        window._SC_STT_REC = null;
        text = String(text || '').trim();
        if (!text) return rej(new Error('没有识别到文字，再说一次试试'));
        try { if (cb) cb(text); } catch (e) {}
        res(text);
      };
      try { rec.start(); } catch (e) { if (!done){ done = true; rej(e); } }
    });
  }
  function speakLast(){
    var list = (typeof S !== 'undefined' && S.msgs) ? S.msgs : [];
    for (var i = list.length - 1; i >= 0; i--){
      var m = list[i];
      if (m && m.role === 'assistant' && m.status !== 'error' && String(m.content || '').trim()) return speak(m.content);
    }
    return Promise.reject(new Error('还没有可朗读的回复'));
  }
  window.VOICE = { speak: speak, stop: stop, voices: voices, listen: listen, speakLast: speakLast,
    speakSupported: speakSupported, listenSupported: listenSupported, clean: clean };
})();
