var SC_SNAPS = {};
try { SC_SNAPS = JSON.parse(localStorage.getItem('sc.snaps') || '{}') || {}; } catch (e) { SC_SNAPS = {}; }
function saveSnaps(){ try { localStorage.setItem('sc.snaps', JSON.stringify(SC_SNAPS)); } catch (e) {} }
/* v0.4.0a：快照键 = 会话 + 工作区 + 路径，避免跨会话互相覆盖 */
function snapKey(sid, ws, path){ return (sid || '') + '|' + (ws || '') + '|' + path; }
function snapGet(sid, ws, path){ var v = SC_SNAPS[snapKey(sid, ws, path)] || SC_SNAPS[path]; return Array.isArray(v) ? ((v[v.length - 1] || {}).s || '') : (v || ''); }
function snapAny(path){ if (SC_SNAPS[path]) return true; for (var k in SC_SNAPS) if (k.slice(-1 - path.length) === '|' + path) return true; return false; }
function snapCount(path){ var n = 0; for (var k in SC_SNAPS){ if (k.slice(-1 - path.length) !== '|' + path) continue; var v = SC_SNAPS[k]; n = Math.max(n, Array.isArray(v) ? v.length : 1); } return n; } // v0.3.17：可回退次数


/* v1.1.0：图形围栏 —— svg / chart / nav 在消息里直接出图（不再当代码块） */
var GRAPH = (function(){
  function esc(x){ return String(x == null ? '' : x).replace(/[&<>"]/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
  var D2R = Math.PI / 180;

  function safeSvg(code){
    /* v1.1.7：SVG 由模型生成，不能只靠正则删 <script>/on*="..."。
       实测 `<animate onbegin=...>`、不带引号的 onload、自闭合 script 都能绕过旧清洗。
       这里改用 DOMParser 解析后按节点/属性白名单清洗；解析失败直接放弃（fail closed）。 */
    var t = String(code || '');
    try {
      var doc = new DOMParser().parseFromString(t, 'text/html');
      var BAD = /^(script|foreignobject|iframe|object|embed|link|meta|base|form|input|button|textarea|select|option|animate|animatetransform|animatemotion|set)$/i;
      function clean(node){
        for (var i = node.childNodes.length - 1; i >= 0; i--){
          var ch = node.childNodes[i];
          if (ch.nodeType !== 1) continue;
          if (BAD.test(ch.nodeName)){ node.removeChild(ch); continue; }
          if (ch.nodeName.toLowerCase() === 'style'){
            if (/(@import|expression\s*\(|behavior\s*:|url\s*\(\s*['"]?\s*(javascript|vbscript|data:text\/html))/i.test(ch.textContent || ''))
              node.removeChild(ch);
            continue;
          }
          for (var j = ch.attributes.length - 1; j >= 0; j--){
            var a = ch.attributes[j], an = a.name.toLowerCase(), av = String(a.value || '');
            if (an.indexOf('on') === 0){ ch.removeAttribute(a.name); continue; }
            if ((an === 'href' || an === 'xlink:href' || an === 'src') &&
                !/^(#|https?:\/\/|data:image\/(png|jpe?g|gif|webp|avif);base64,)/i.test(av)){
              ch.removeAttribute(a.name); continue;
            }
            if (an === 'style' && /(expression\s*\(|url\s*\(\s*['"]?\s*(javascript|vbscript|data:text\/html))/i.test(av))
              ch.removeAttribute(a.name);
          }
          clean(ch);
        }
      }
      clean(doc.body);
      return doc.body.innerHTML;
    } catch (e) { return ''; }
  }

  function shell(kind, inner, src){
    return '<div class="gfx gfx-' + kind + '">' + inner + '</div>' +
      '<details class="gfx-src"><summary>查看源码</summary><pre>' + esc(src) + '</pre></details>';
  }

  function niceMax(v){
    v = v || 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var m = v / p;
    var step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
    return step * p;
  }

  /* ---- 图表 ---- */
  function chart(sp){
    var d = sp.data || [], type = sp.type || 'bar', title = esc(sp.title || '');
    if (!d.length) return '';
    if (type === 'pie'){
      var W = 680, H = 250, cx = 140, cy = 130, r = 88, ir = 52;
      var tot = d.reduce(function(a, b){ return a + (+b[1] || 0); }, 0) || 1;
      var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" font-size="12">';
      if (title) s += '<text x="0" y="15" font-size="13" font-weight="600" fill="var(--ink)">' + title + '</text>';
      var a0 = -Math.PI / 2;
      d.forEach(function(it, i){
        var a1 = a0 + Math.PI * 2 * (+it[1] || 0) / tot;
        var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        var xi1 = cx + ir * Math.cos(a1), yi1 = cy + ir * Math.sin(a1);
        var xi0 = cx + ir * Math.cos(a0), yi0 = cy + ir * Math.sin(a0);
        var la = (a1 - a0) > Math.PI ? 1 : 0;
        s += '<path d="M' + x0 + ' ' + y0 + ' A' + r + ' ' + r + ' 0 ' + la + ' 1 ' + x1 + ' ' + y1 +
             ' L' + xi1 + ' ' + yi1 + ' A' + ir + ' ' + ir + ' 0 ' + la + ' 0 ' + xi0 + ' ' + yi0 + ' Z" fill="var(--g' + ((i % 5) + 1) + ')"/>';
        a0 = a1;
      });
      d.forEach(function(it, i){
        var y = 62 + i * 25;
        s += '<rect x="290" y="' + (y - 9) + '" width="10" height="10" rx="2" fill="var(--g' + ((i % 5) + 1) + ')"/>';
        s += '<text x="308" y="' + y + '" fill="var(--body)">' + esc(it[0]) + '　' + Math.round((+it[1] || 0) / tot * 100) + '%</text>';
      });
      return s + '</svg>';
    }
    if (type === 'timeline'){
      var W2 = 680, T = 66, L = 34, n = d.length, iw = W2 - L * 2;
      var s2 = '<svg viewBox="0 0 ' + W2 + ' 150" font-size="12">';
      if (title) s2 += '<text x="0" y="15" font-size="13" font-weight="600" fill="var(--ink)">' + title + '</text>';
      s2 += '<line x1="' + L + '" y1="' + T + '" x2="' + (W2 - L) + '" y2="' + T + '" stroke="var(--hairline)" stroke-width="2"/>';
      d.forEach(function(it, i){
        var x = n === 1 ? W2 / 2 : L + iw * i / (n - 1);
        s2 += '<circle cx="' + x + '" cy="' + T + '" r="6" fill="var(--canvas)" stroke="var(--primary)" stroke-width="2.4"/>';
        s2 += '<text x="' + x + '" y="' + (T - 18) + '" text-anchor="middle" fill="var(--ink)" font-weight="600">' + esc(it[0]) + '</text>';
        s2 += '<text x="' + x + '" y="' + (T + 26) + '" text-anchor="middle" fill="var(--muted)">' + esc(it[1]) + '</text>';
      });
      return s2 + '</svg>';
    }
    var W3 = 680, H3 = 240, LL = 48, RR = 12, TT = 30, BB = 40;
    var iw3 = W3 - LL - RR, ih3 = H3 - TT - BB;
    var max = Math.max.apply(null, d.map(function(x){ return +x[1] || 0; }));
    var top = niceMax(max), n3 = d.length;
    var s3 = '<svg viewBox="0 0 ' + W3 + ' ' + H3 + '" font-size="12">';
    if (title) s3 += '<text x="0" y="14" font-size="13" font-weight="600" fill="var(--ink)">' + title + '</text>';
    for (var g = 0; g <= 4; g++){
      var gy = TT + ih3 - ih3 * g / 4;
      s3 += '<line x1="' + LL + '" y1="' + gy + '" x2="' + (W3 - RR) + '" y2="' + gy + '" stroke="var(--hairline)"/>';
      s3 += '<text x="' + (LL - 7) + '" y="' + (gy + 4) + '" text-anchor="end" fill="var(--muted)">' + Math.round(top * g / 4) + '</text>';
    }
    if (type === 'line'){
      var px = function(i){ return LL + (n3 === 1 ? iw3 / 2 : iw3 * i / (n3 - 1)); };
      var py = function(v){ return TT + ih3 - ih3 * v / top; };
      var pts = d.map(function(it, i){ return px(i) + ',' + py(+it[1] || 0); }).join(' ');
      s3 += '<polyline points="' + pts + '" fill="none" stroke="var(--g2)" stroke-width="2.4" stroke-linejoin="round"/>';
      d.forEach(function(it, i){
        s3 += '<circle cx="' + px(i) + '" cy="' + py(+it[1] || 0) + '" r="3.6" fill="var(--g2)"/>';
        s3 += '<text x="' + px(i) + '" y="' + (TT + ih3 + 19) + '" text-anchor="middle" fill="var(--muted)">' + esc(it[0]) + '</text>';
      });
    } else {
      var bw = Math.min(58, iw3 / n3 * 0.55), gap = iw3 / n3;
      d.forEach(function(it, i){
        var h = ih3 * (+it[1] || 0) / top;
        var x = LL + gap * i + (gap - bw) / 2, y = TT + ih3 - h;
        s3 += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="4" fill="var(--g1)"/>';
        s3 += '<text x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle" fill="var(--body)">' + esc(it[1]) + '</text>';
        s3 += '<text x="' + (x + bw / 2) + '" y="' + (TT + ih3 + 19) + '" text-anchor="middle" fill="var(--muted)">' + esc(it[0]) + '</text>';
      });
    }
    return s3 + '</svg>';
  }

  /* ---- 航海图 ---- */
  function pt(cx, cy, r, brg){ var a = (brg - 90) * D2R; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function arcPath(cx, cy, r, b0, b1){
    var s0 = pt(cx, cy, r, b0), e0 = pt(cx, cy, r, b1);
    var dd = ((b1 - b0) % 360 + 360) % 360, la = dd > 180 ? 1 : 0;
    return 'M' + s0[0] + ' ' + s0[1] + ' A' + r + ' ' + r + ' 0 ' + la + ' 1 ' + e0[0] + ' ' + e0[1];
  }
  function shipIcon(cx, cy, hd, size){
    var z = size || 15;
    return '<g transform="translate(' + cx + ',' + cy + ') rotate(' + hd + ')">' +
      '<path d="M0 ' + (-z * 1.6) + ' L' + z * 0.62 + ' ' + z * 0.9 + ' L0 ' + z * 0.45 + ' L' + (-z * 0.62) + ' ' + z * 0.9 + ' Z" fill="var(--ink)"/>' +
      '<circle cx="0" cy="0" r="2.2" fill="var(--canvas)"/></g>';
  }
  function compassRing(cx, cy, r){
    var o = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--hairline)" stroke-dasharray="3 4"/>';
    for (var a = 0; a < 360; a += 30){
      var p1 = pt(cx, cy, r - 7, a), p2 = pt(cx, cy, r, a);
      o += '<line x1="' + p1[0] + '" y1="' + p1[1] + '" x2="' + p2[0] + '" y2="' + p2[1] + '" stroke="var(--hairline)"/>';
    }
    return o;
  }

  function nav(sp){
    var type = sp.type || 'bearing';
    if (type === 'bearing' || type === 'aspect'){
      var W = 680, H = 330, cx = 200, cy = 175, R = 118;
      var hd = +sp.heading || 0;
      var tb = type === 'bearing' ? (+sp.trueBearing || 0) : ((hd + (+sp.relBearing || 0)) % 360);
      var rel = ((tb - hd) % 360 + 360) % 360;
      var side = rel <= 180 ? '右' : '左', relAbs = rel <= 180 ? rel : 360 - rel;
      var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" font-size="12">';
      s += compassRing(cx, cy, R);
      var nn = pt(cx, cy, R + 16, 0);
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + nn[0] + '" y2="' + nn[1] + '" stroke="var(--muted)" stroke-dasharray="5 4"/>';
      s += '<text x="' + nn[0] + '" y="' + (nn[1] - 6) + '" text-anchor="middle" fill="var(--muted)" font-weight="600">N</text>';
      var b = pt(cx, cy, R + 8, hd);
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="var(--primary)" stroke-width="2.4"/>';
      s += '<text x="' + b[0] + '" y="' + (b[1] + 16) + '" text-anchor="middle" fill="var(--primary)" font-weight="600">船首 ' + hd + '°</text>';
      var gg = pt(cx, cy, R + 12, tb);
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + gg[0] + '" y2="' + gg[1] + '" stroke="var(--g5)" stroke-width="2.4"' + (type === 'aspect' ? ' stroke-dasharray="7 4"' : '') + '/>';
      s += '<circle cx="' + gg[0] + '" cy="' + gg[1] + '" r="5" fill="var(--g5)"/>';
      s += '<text x="' + gg[0] + '" y="' + (gg[1] - 10) + '" text-anchor="middle" fill="var(--g5)" font-weight="600">' + esc(sp.target || '目标') + '</text>';
      s += '<path d="' + arcPath(cx, cy, 64, hd, tb) + '" fill="none" stroke="var(--g5)" stroke-width="1.8"/>';
      var mm = pt(cx, cy, 84, hd + rel / 2);
      s += '<text x="' + mm[0] + '" y="' + mm[1] + '" text-anchor="middle" fill="var(--g5)" font-weight="600">' + relAbs + '°</text>';
      s += shipIcon(cx, cy, hd, 15);
      if (type === 'aspect'){
        var lp = pt(cx, cy, 13, hd - 90), rp = pt(cx, cy, 13, hd + 90);
        s += '<circle cx="' + lp[0] + '" cy="' + lp[1] + '" r="4.5" fill="#c64545"/>';
        s += '<circle cx="' + rp[0] + '" cy="' + rp[1] + '" r="4.5" fill="#4a9d5f"/>';
      }
      var tx = 372;
      s += '<text x="' + tx + '" y="78" fill="var(--ink)" font-size="14" font-weight="600">' + esc(sp.situation || (type === 'bearing' ? '真方位 / 舷角' : '相遇局面')) + '</text>';
      s += '<text x="' + tx + '" y="112" fill="var(--body)">' + (type === 'bearing' ? '船首向：' + hd + '°' : '我船航向：' + hd + '°') + '</text>';
      if (type === 'bearing'){
        s += '<text x="' + tx + '" y="138" fill="var(--body)">真方位：' + tb + '°</text>';
        s += '<text x="' + tx + '" y="164" fill="var(--g5)" font-weight="600">舷角：' + side + ' ' + relAbs + '°</text>';
        s += '<text x="' + tx + '" y="190" fill="var(--muted)" font-size="11.5">舷角 = 真方位 − 船首向 = ' + tb + '° − ' + hd + '°</text>';
      } else {
        s += '<text x="' + tx + '" y="138" fill="var(--body)">目标舷角：' + (+sp.relBearing || 0) + '°（' + ((+sp.relBearing || 0) <= 180 ? '右舷' : '左舷') + '）</text>';
        s += '<text x="' + tx + '" y="164" fill="var(--body)">目标真方位：' + tb + '°</text>';
        if (sp.distance) s += '<text x="' + tx + '" y="190" fill="var(--body)">距离：' + esc(sp.distance) + '</text>';
        s += '<text x="' + tx + '" y="220" fill="var(--muted)" font-size="11.5">真方位 = 航向 + 舷角 = ' + hd + '° + ' + (+sp.relBearing || 0) + '°</text>';
      }
      return s + '</svg>';
    }
    if (type === 'rel'){
      var W2 = 680, H2 = 350, cx2 = 340, cy2 = 195, R2 = 135;
      var items = sp.items || [];
      var s2 = '<svg viewBox="0 0 ' + W2 + ' ' + H2 + '" font-size="12">';
      s2 += compassRing(cx2, cy2, R2);
      var bb = pt(cx2, cy2, R2 + 12, 0);
      s2 += '<line x1="' + cx2 + '" y1="' + cy2 + '" x2="' + bb[0] + '" y2="' + bb[1] + '" stroke="var(--primary)" stroke-width="2.4"/>';
      s2 += '<text x="' + bb[0] + '" y="' + (bb[1] - 8) + '" text-anchor="middle" fill="var(--primary)" font-weight="600">船首 000°</text>';
      s2 += shipIcon(cx2, cy2, 0, 15);
      items.forEach(function(it){
        var ang = +it[1] || 0, col = ang < 0 ? '#c64545' : '#4a9d5f';
        var p = pt(cx2, cy2, R2 + 4, ang);
        s2 += '<line x1="' + cx2 + '" y1="' + cy2 + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="' + col + '" stroke-width="2"/>';
        s2 += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4.5" fill="' + col + '"/>';
        s2 += '<text x="' + p[0] + '" y="' + (p[1] - 10) + '" text-anchor="middle" fill="' + col + '" font-weight="600">' + esc(it[0]) + '</text>';
        s2 += '<text x="' + p[0] + '" y="' + (p[1] + 16) + '" text-anchor="middle" fill="' + col + '" font-size="11.5">' + (ang < 0 ? '左 ' + (-ang) : '右 ' + ang) + '°</text>';
        s2 += '<path d="' + arcPath(cx2, cy2, 50, 0, ang) + '" fill="none" stroke="' + col + '" stroke-width="1.4" opacity=".6"/>';
      });
      return s2 + '</svg>';
    }
    return '';
  }

  function unesc(t){
    return String(t || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  function render(lang, code){
    try {
      code = unesc(code);
      if (lang === 'svg'){
        var raw = String(code || '').trim();
        if (!/^<svg[\s>]/i.test(raw)) return '';
        return shell('svg', safeSvg(raw), raw);
      }
      var sp = JSON.parse(String(code || ''));
      var out = lang === 'nav' ? nav(sp) : chart(sp);
      if (!out) return '';
      return shell(lang, out, String(code || '').trim());
    } catch (e) {
      return '';
    }
  }

  return { render: render, chart: chart, nav: nav, safeSvg: safeSvg };
})();

var MD = (function(){
  /* v2.1：轻量 LaTeX 子集 → HTML（零依赖）。目标是把常见公式渲染成可读文本，不是完整排版引擎。
     支持：\frac \sqrt \text、上下标 _{}/^{}、常用符号名、\left/\right、字距、\\ 换行。 */
  var TEX = {
    circ: '°', degree: '°', times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '*', star: '⋆',
    rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔',
    approx: '≈', sim: '∼', simeq: '≃', neq: '≠', ne: '≠', le: '≤', leq: '≤', ge: '≥', geq: '≥',
    infty: '∞', sum: '∑', prod: '∏', int: '∫', oint: '∮', partial: '∂', nabla: '∇', propto: '∝',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ',
    tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    lt: '&lt;', gt: '&gt;', therefore: '∴', because: '∵', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
    cup: '∪', cap: '∩', prime: '′', ldots: '…', cdots: '⋯', equiv: '≡', propto2: '∝', perp: '⊥', angle: '∠',
    vec: '', bar: '', hat: '', tilde: ''
  };
  /* 教材式公式：LaTeX 子集 → MathML（浏览器原生排版，分式上下叠、根号、上下标、括号自适应）。
     不再把 \frac 压成 a⁄b。未知命令按原文显示，绝不吞内容。 */
  var TEX_GREEK = { alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ϵ', varepsilon:'ε', zeta:'ζ', eta:'η', theta:'θ', vartheta:'ϑ', iota:'ι', kappa:'κ', lambda:'λ', mu:'μ', nu:'ν', xi:'ξ', omicron:'ο', pi:'π', varpi:'ϖ', rho:'ρ', varrho:'ϱ', sigma:'σ', varsigma:'ς', tau:'τ', upsilon:'υ', phi:'ϕ', varphi:'φ', chi:'χ', psi:'ψ', omega:'ω', Gamma:'Γ', Delta:'Δ', Theta:'Θ', Lambda:'Λ', Xi:'Ξ', Pi:'Π', Sigma:'Σ', Upsilon:'Υ', Phi:'Φ', Psi:'Ψ', Omega:'Ω' };
  var TEX_SYM = { cdot:'·', times:'×', div:'÷', pm:'±', mp:'∓', le:'≤', leq:'≤', ge:'≥', geq:'≥', ne:'≠', neq:'≠', approx:'≈', equiv:'≡', propto:'∝', infty:'∞', partial:'∂', nabla:'∇', sum:'∑', prod:'∏', int:'∫', iint:'∬', oint:'∮', to:'→', rightarrow:'→', leftarrow:'←', Rightarrow:'⇒', Leftarrow:'⇐', leftrightarrow:'↔', Leftrightarrow:'⇔', in:'∈', notin:'∉', subset:'⊂', subseteq:'⊆', supset:'⊃', cup:'∪', cap:'∩', forall:'∀', exists:'∃', angle:'∠', perp:'⊥', parallel:'∥', sim:'∼', simeq:'≃', ldots:'…', cdots:'⋯', dots:'…', '%':'%', '$':'$', _:'_', '{':'{', '}':'}', '&':'&', '#':'#' };
  var TEX_FUN = { sin:1, cos:1, tan:1, cot:1, sec:1, csc:1, arcsin:1, arccos:1, arctan:1, sinh:1, cosh:1, tanh:1, log:1, ln:1, lg:1, exp:1, lim:1, max:1, min:1, sup:1, inf:1, det:1, dim:1, ker:1, deg:1, gcd:1, mod:1 };
  function tex(src, display){
    var s = String(src == null ? '' : src);
    s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    s = s.replace(/\\begin\{[^}]*\}/g, '').replace(/\\end\{[^}]*\}/g, '').replace(/&/g, '');
    var i = 0;
    function esc(t){ return String(t).replace(/[&<>]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]; }); }
    function ws(){ while (i < s.length && /\s/.test(s.charAt(i))) i++; }
    function rawGroup(){
      ws(); if (s.charAt(i) !== '{') return '';
      i++; var depth = 1, out = '';
      while (i < s.length){
        var c = s.charAt(i++);
        if (c === '{'){ depth++; out += c; }
        else if (c === '}'){ depth--; if (!depth) break; out += c; }
        else out += c;
      }
      return out;
    }
    function atomGroup(){
      ws();
      if (s.charAt(i) === '{'){ i++; var g = expr(); if (s.charAt(i) === '}') i++; return '<mrow>' + g + '</mrow>'; }
      return atom();
    }
    function cmd(){
      i++; // backslash
      if (i >= s.length) return '';
      var ch = s.charAt(i);
      if (!/[a-zA-Z]/.test(ch)){
        i++;
        if (ch === ',' || ch === ';' || ch === ':' || ch === '!') return '<mspace width="0.17em"/>';
        if (ch === ' ') return '<mspace width="0.25em"/>';
        if (ch === '\\') return '<mspace linebreak="newline"/>';
        if (ch === '%' || ch === '$' || ch === '_' || ch === '{' || ch === '}' || ch === '#') return '<mo>' + esc(ch) + '</mo>';
        return '<mo>' + esc(ch) + '</mo>';
      }
      var name = '';
      while (i < s.length && /[a-zA-Z]/.test(s.charAt(i))) name += s.charAt(i++);
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac'){
        var num = atomGroup(), den = atomGroup();
        return '<mfrac>' + num + den + '</mfrac>';
      }
      if (name === 'sqrt'){
        var idx = '';
        ws();
        if (s.charAt(i) === '['){ i++; while (i < s.length && s.charAt(i) !== ']') idx += s.charAt(i++); if (s.charAt(i) === ']') i++; }
        var body = atomGroup();
        return idx ? '<mroot>' + body + '<mrow>' + tex(idx, false).replace(/<\/?math[^>]*>/g, '') + '</mrow></mroot>' : '<msqrt>' + body + '</msqrt>';
      }
      if (name === 'left' || name === 'right'){
        ws();
        var d = s.charAt(i++);
        if (d === '\\') d = s.charAt(i++);
        if (d === '.' || d === '') return '';
        return '<mo>' + esc(d) + '</mo>';
      }
      if (name === 'big' || name === 'Big' || name === 'bigg' || name === 'Bigg' || name === 'bigl' || name === 'Bigl' || name === 'bigr' || name === 'Bigr'){
        ws(); var d2 = s.charAt(i++); return '<mo>' + esc(d2) + '</mo>';
      }
      if (name === 'text' || name === 'mathrm' || name === 'mbox' || name === 'operatorname'){
        var t = rawGroup(); return '<mtext>' + esc(t) + '</mtext>';
      }
      if (name === 'mathbf'){ var t2 = rawGroup(); return '<mtext mathvariant="bold">' + esc(t2) + '</mtext>'; }
      if (name === 'mathit'){ var t3 = rawGroup(); return '<mtext mathvariant="italic">' + esc(t3) + '</mtext>'; }
      if (name === 'mathbb'){ var t4 = rawGroup(); return '<mtext mathvariant="double-struck">' + esc(t4) + '</mtext>'; }
      if (name === 'overline' || name === 'bar'){ var b1 = atomGroup(); return '<mover>' + b1 + '<mo>‾</mo></mover>'; }
      if (name === 'hat'){ var b2 = atomGroup(); return '<mover>' + b2 + '<mo>^</mo></mover>'; }
      if (name === 'vec'){ var b3 = atomGroup(); return '<mover>' + b3 + '<mo>→</mo></mover>'; }
      if (name === 'dot'){ var b4 = atomGroup(); return '<mover>' + b4 + '<mo>˙</mo></mover>'; }
      if (name === 'quad') return '<mspace width="1em"/>';
      if (name === 'qquad') return '<mspace width="2em"/>';
      if (name === 'displaystyle' || name === 'limits' || name === 'nolimits') return '';
      if (name === 'middle'){ ws(); var d3 = s.charAt(i++); return d3 ? '<mo>' + esc(d3) + '</mo>' : ''; }
      if (TEX_FUN[name]) return '<mi mathvariant="normal">' + esc(name) + '</mi><mo>&#x2061;</mo>';
      if (TEX_GREEK[name]) return '<mi>' + TEX_GREEK[name] + '</mi>';
      if (Object.prototype.hasOwnProperty.call(TEX_SYM, name)) return '<mo>' + esc(TEX_SYM[name]) + '</mo>';
      return '<mtext>\\' + esc(name) + '</mtext>';
    }
    function atom(){
      ws();
      if (i >= s.length) return '';
      var c = s.charAt(i);
      if (c === '{'){ i++; var g = expr(); if (s.charAt(i) === '}') i++; return '<mrow>' + g + '</mrow>'; }
      if (c === '\\') return cmd();
      if (/[0-9]/.test(c)){
        var n = '';
        while (i < s.length && /[0-9.]/.test(s.charAt(i))) n += s.charAt(i++);
        return '<mn>' + esc(n) + '</mn>';
      }
      if (/[a-zA-Z]/.test(c)){ i++; return '<mi>' + esc(c) + '</mi>'; }
      i++;
      var map = { '-':'−', '*':'∗', "'":'′' };
      return '<mo>' + esc(map[c] || c) + '</mo>';
    }
    function node(){
      var base = atom();
      var sub = '', sup = '';
      for (;;){
        ws();
        if (s.charAt(i) === '^'){ i++; sup = atomGroup(); }
        else if (s.charAt(i) === '_'){ i++; sub = atomGroup(); }
        else break;
      }
      var big = /<mo>[∑∏∫∬∮]<\/mo>/.test(base) || /mathvariant="normal">(lim|max|min|sup|inf)</.test(base);
      if (sub && sup) return big ? '<munderover>' + base + sub + sup + '</munderover>' : '<msubsup>' + base + sub + sup + '</msubsup>';
      if (sub) return big ? '<munder>' + base + sub + '</munder>' : '<msub>' + base + sub + '</msub>';
      if (sup) return big ? '<mover>' + base + sup + '</mover>' : '<msup>' + base + sup + '</msup>';
      return base;
    }
    function expr(){
      var out = '';
      while (i < s.length && s.charAt(i) !== '}') out += node();
      return out;
    }
    var body = expr();
    return '<math xmlns="http://www.w3.org/1998/Math/MathML" display="' + (display ? 'block' : 'inline') + '">' + body + '</math>';
  }
  /* v2.3：回答内嵌媒体（直连 https，按扩展名判类型）。src 已被 esc() 转义，属性安全。
     preload=metadata + loading=lazy：不预下整段视频/整张大图；referrerpolicy=no-referrer 少泄露来源。 */
  var IMG_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?\S*)?$/i;
  var VID_RE = /\.(mp4|webm|ogv|mov|m4v)(\?\S*)?$/i;
  function longBlock(text){
    var n = String(text || '').length;
    var kind = /^data:/i.test(text) ? '内嵌数据' : '长内容';
    return '<details class="long-block"><summary>' + kind + ' · ' + n + ' 字符 · 点击展开</summary><pre>' + text + '</pre></details>';
  }
  function shortUrl(u){
    var s = String(u || '').replace(/^https?:\/\//i, '');
    var label = s.length > 56 ? s.slice(0, 53) + '…' : s;
    return '<a class="md-link" href="' + u + '" target="_blank" rel="noopener noreferrer" title="' + u + '">' + label + '</a>';
  }
  function mediaTag(u, alt){
    alt = alt || '';
    if (VID_RE.test(u))
      return '<a class="md-media" href="' + u + '" target="_blank" rel="noopener noreferrer" title="在浏览器中打开该视频">' +
             '<video src="' + u + '" controls preload="metadata" playsinline></video>' +
             (alt ? '<span class="md-cap">' + alt + '</span>' : '') + '</a>';
    return '<a class="md-media" href="' + u + '" target="_blank" rel="noopener noreferrer" title="在浏览器中打开原图">' +
           '<img src="' + u + '" alt="' + alt + '" loading="lazy" referrerpolicy="no-referrer">' +
           (alt ? '<span class="md-cap">' + alt + '</span>' : '') + '</a>';
  }
  /* P1：代码高亮（9 种语言，单次正则；>60KB 跳过）。c.code 已 esc()，先还原 4 实体再分词。 */
  var HL = (function(){
    var KW = {
      js: 'break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|of|static|get|set',
      ts: 'break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|of|static|get|set|type|interface|enum|implements|namespace|abstract|readonly|declare|keyof|infer|unknown|never|any',
      py: 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None',
      java: 'abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|true|false|null',
      cs: 'abstract|as|base|bool|break|byte|case|catch|char|checked|class|const|continue|decimal|default|delegate|do|double|else|enum|event|explicit|extern|false|finally|fixed|float|for|foreach|goto|if|implicit|in|int|interface|internal|is|lock|long|namespace|new|null|object|operator|out|override|params|private|protected|public|readonly|ref|return|sbyte|sealed|short|sizeof|stackalloc|static|string|struct|switch|this|throw|true|try|typeof|uint|ulong|unchecked|unsafe|ushort|using|var|virtual|void|volatile|while|async|await',
      go: 'break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|true|false|nil|iota',
      rs: 'as|async|await|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while',
      sh: 'if|then|else|elif|fi|for|while|do|done|in|case|esac|function|select|until|return|local|export|readonly|declare|typeset',
      sql: 'select|from|where|and|or|not|in|is|null|as|on|join|left|right|inner|outer|full|cross|group|by|order|having|limit|offset|insert|into|values|update|set|delete|create|table|alter|drop|index|view|primary|key|foreign|references|unique|default|check|constraint|union|all|distinct|between|like|exists|case|when|then|else|end|asc|desc'
    };
    var LANG = { javascript: 'js', typescript: 'ts', python: 'py', csharp: 'cs', bash: 'sh', shell: 'sh' };
    function unesc4(s){ return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }
    function escH(s){ return String(s).replace(/[&<>]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]; }); }
    function run(lang, code){
      if (!lang || code.length > 60000) return null;
      var lk = String(lang).toLowerCase();
      lk = LANG[lk] || lk;
      var kws = KW[lk]; if (!kws) return null;
      var src = unesc4(code), re, parts = [], last = 0, i, m, kwRe;
      if (lk === 'py') re = /(#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
      else if (lk === 'sql') re = /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\b\d+(?:\.\d+)?\b)/g;
      else re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
      kwRe = new RegExp('\\b(' + kws + ')\\b', lk === 'sql' ? 'gi' : 'g');
      while ((m = re.exec(src))){
        if (m.index > last) parts.push({ t: src.slice(last, m.index), k: 0 });
        var v = m[0], cls = 'hl-n';
        if (/^(#|\/\/|\/\*|--)/.test(v)) cls = 'hl-c';
        else if (/^["'`]/.test(v)) cls = 'hl-s';
        parts.push({ t: v, k: 1, c: cls });
        last = re.lastIndex;
      }
      if (last < src.length) parts.push({ t: src.slice(last), k: 0 });
      var out = '';
      for (i = 0; i < parts.length; i++){
        if (parts[i].k){ out += '<span class="' + parts[i].c + '">' + escH(parts[i].t) + '</span>'; continue; }
        out += escH(parts[i].t).replace(kwRe, function(w){ return '<span class="hl-k">' + w + '</span>'; });
      }
      return out;
    }
    return { run: run };
  })();

  function render(src, opts){
    var noMedia = opts ? opts.noMedia : false; // false 全量 / 'stream' 只放行 blob:data: / true 全禁
    var streamMode = noMedia === 'stream';
    src = esc(src == null ? '' : String(src));
    /* C3：未闭合围栏先生成一个临时闭合，避免流式期代码块闪成裸文本 */
    if (((src.match(/```/g) || []).length % 2) === 1) src += '\n```';

    /* 1. 抽出围栏代码块；占位符用私用区哨兵 */
    var codes = [];
    /* v1.14：围栏首行可以带参数（```vfs-write index.html / ```fs-read src/a.js / ```run js）。
       以前正则只认「```lang + 换行」，带参数的围栏整块漏判，原文连 ``` 一起糊在正文里。 */
    var TOOL_LANG = /^(crawl|run|vfs-write|vfs-list|vfs-read|patch|preview|web|search|play|download|get|browser|skill|agent|sub|suball|python|fs-[a-z-]+)$/i;
    src = src.replace(/```([A-Za-z0-9+#-]*)[ \t]*([^\n]*)\n([\s\S]*?)```/g, function(m, lang, arg, code){
      var a = String(arg || '').trim(), body = code.replace(/\n+$/, '');
      if (a && TOOL_LANG.test(lang)) body = a + '\n' + body;   /* 参数并进体首行，工具卡片照旧读首行 */
      codes.push({ lang: lang, code: body });
      return '\uE000' + (codes.length - 1) + '\uE000';
    });

    /* 2. 抽出行内代码 */
    var inls = [];
    src = src.replace(/`([^`\n]+)`/g, function(m, c){
      inls.push(c);
      return '\uE001' + (inls.length - 1) + '\uE001';
    });

    /* 2.5 抽出块级公式 \[...\] / $$...$$（先于块解析；代码/行内代码已占位，故其中公式不受影响） */
    var maths = [];
    src = src.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, function(m, a, b){
      maths.push(a != null ? a : b);
      return '\uE002' + (maths.length - 1) + '\uE002';
    });

    /* 2.6 P1：抽出脚注定义 [^id]: ...（不作为普通段落） */
    var fnDefs = {}, fnOrder = [];
    src = src.replace(/^\[\^([^\]\n]+)\]:[ \t]*(.+)$/gm, function(m, id, body){
      if (!Object.prototype.hasOwnProperty.call(fnDefs, id)){ fnDefs[id] = body.trim(); fnOrder.push(id); }
      return '';
    });

    /* 3. 行内标记：图片→粗体→斜体→链接→公式→脚注引用（图片必须先在链接之前，否则 ![]() 被链接规则吃掉） */
    function inl(s){
      /* v2.6：行内裸媒体直链也内嵌。边界只认空白/全角括号（不含半角 "("），
         故 ![](url) / [文字](url) 的 URL 不会被先吃掉，后续规则照常处理；
         尾部标点剥离后再判扩展名，判中则把标点接回。 */
      if (!noMedia) s = s.replace(/(^|[\s（])(https?:\/\/[^\s<）)]+)/g, function(m, pre, u){
        var trail = '';
        var t = u.replace(/[.,，。;；:：!！]+$/, function(x){ trail = x; return ''; });
        if (IMG_RE.test(t) || VID_RE.test(t)) return pre + mediaTag(t, '') + trail;
        return m;
      });
      /* v1.1.9：裸长链接压成“域名/路径…”胶囊，点击仍走原地址（宿主会把它开进右侧侧栏） */
      s = s.replace(/(^|[\s（])(https?:\/\/[^\s<）)]{60,})/g, function(m, pre, u){
        var trail = '';
        var t = u.replace(/[.,，。;；:：!！]+$/, function(x){ trail = x; return ''; });
        return pre + (t.length >= 60 ? shortUrl(t) : t) + trail;
      });
      s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, function(m, alt, u){
        if (noMedia && !(streamMode && /^(blob:|data:)/i.test(u))) return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + (alt || u) + '</a>'; // 流式期：远程图先当链接，本地 blob 直接出图
        return mediaTag(u, alt);
      });
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function(m, t, u){
        /* v2.6：模型常把图片写成 [文字](图链) 而非 ![说明](图链)——按扩展名判媒体则内嵌（mediaTag 自带锚点可点开原图） */
        if ((!noMedia || (streamMode && /^(blob:|data:)/i.test(u))) && (IMG_RE.test(u) || VID_RE.test(u))) return mediaTag(u, t);
        return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
      });
      /* 公式：块级占位符 → 行内；\(...\)；谨慎的 $...$（含数学特征才认，避免误伤货币） */
      s = s.replace(/\uE002(\d+)\uE002/g, function(m, i){ return '<span class="math">' + tex(maths[+i], false) + '</span>'; });
      s = s.replace(/\\\(([\s\S]*?)\\\)/g, function(m, x){ return '<span class="math">' + tex(x, false) + '</span>'; });
      s = s.replace(/\$([^\s$][^$\n]*?)\$(?!\d)/g, function(m, x){
        return /[\\^_={}]|[a-zA-Z]\s*[_^]|\d\s*[_^]/.test(x) ? '<span class="math">' + tex(x, false) + '</span>' : m;
      });
      /* P1：脚注引用 [^id] */
      s = s.replace(/\[\^([^\]\n]+)\]/g, function(m, id){
        var idx = -1, k;
        for (k = 0; k < fnOrder.length; k++) if (fnOrder[k] === id){ idx = k; break; }
        if (idx < 0) return m;
        return '<sup class="fnref"><a href="#fn-' + (idx + 1) + '">' + (idx + 1) + '</a></sup>';
      });
      s = s.replace(/\uE001(\d+)\uE001/g, function(m, i){ return '<code>' + inls[+i] + '</code>'; });
      return s;
    }

    /* 4. 块级解析（标题/列表/引用/表格/分割线） */
    var lines = src.split('\n'), html = '', i = 0;
    function splitRow(line){
      var t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      return t.split('|').map(function(c){ return c.trim(); });
    }
    while (i < lines.length){
      var line = lines[i];
      var _lt = line.trim();
      /* v1.1.9：超长裸 Base64 / data URI / 长链接默认折叠，避免一条消息刷满整屏 */
      if (_lt.length >= 200 && /^data:[^\s]+$/i.test(_lt)){
        html += longBlock(_lt); i++; continue;
      }
      if (/^[A-Za-z0-9+/=_-]{60,}$/.test(_lt)){
        var _buf = [], _j = i;
        while (_j < lines.length && /^[A-Za-z0-9+/=_-]{60,}$/.test(lines[_j].trim())){ _buf.push(lines[_j].trim()); _j++; }
        if (_buf.join('').length >= 400){ html += longBlock(_buf.join('')); i = _j; continue; }
      }
      if (/^https?:\/\/\S{60,}$/i.test(_lt)){
        html += '<p>' + shortUrl(_lt) + '</p>'; i++; continue;
      }

      var cm = /^\uE000(\d+)\uE000$/.exec(line.trim()); /* 代码块占位符独占一行 */
      if (cm){ var c = codes[+cm[1]];
        if (c.lang === 'ask'){ html += askCard(c); i++; continue; } /* v1.29.3：反问卡片（各模式都有） */
        /* v1.1.0：图形围栏直接出图（svg / chart / nav），失败则落回代码块 */
        if (c.lang === 'svg' || c.lang === 'chart' || c.lang === 'nav'){
          var _gfx = GRAPH.render(c.lang, c.code);
          if (_gfx){ html += _gfx; i++; continue; }
        }
      if (c.lang && typeof MODE !== 'undefined' && MODE.toolAllowed && !MODE.toolAllowed(c.lang)){ html += deadCard(c); i++; continue; } /* v1.28.1：本轮没有的工具 */
        if (c.lang && c.lang.indexOf('fs-') === 0){ html += fsCard(c); i++; continue; } /* 文件工具卡片（v1.1） */
        var _rk = crKind(c.lang);
        /* v3.0 #12：运行/写文件/补丁/预览围栏 → 工具卡片 */
        if (/^(run|vfs-write|vfs-list|vfs-read|patch|preview|web|crawl|search|play|download|get|browser|python)$/.test(c.lang || '')){ html += toolCard(c); i++; continue; } // v0.2.2：web/search 也是工具调用，用卡片而不是代码块
        /* v3.0 #20：代码块工具条（运行 / 复制 / 下载 / 换行） */
        /* v3.0 #25：可选行号——逐行包 span，复制时仍是纯文本；P1：9 种语言高亮 */
        var _ln = !!S.cfg.lineNo, _bc = c.code, _hl = HL.run(c.lang || '', c.code);
        if (_hl){
          if (_ln){
            var _hls = _hl.split('\n'), _open = '';
            for (var _hi = 0; _hi < _hls.length; _hi++){
              var _seg = _open + (_hls[_hi] || ' '), _mm;
              var _re1 = /<span class="(hl-[kscn])">/g; while ((_mm = _re1.exec(_seg))) _open = '<span class="' + _mm[1] + '">';
              var _closes = (_seg.match(/<\/span>/g) || []).length, _opens = (_seg.match(/<span class="hl-[kscn]">/g) || []).length;
              if (_opens > _closes) _seg += '</span>'; else _open = '';
              _hls[_hi] = _seg;
            }
            _bc = '<span class="cl">' + _hls.join('</span>\n<span class="cl">') + '</span>';
          } else _bc = _hl;
        } else if (_ln){
          _bc = '<span class="cl">' + c.code.split('\n').map(function(l){ return l || ' '; }).join('</span>\n<span class="cl">') + '</span>';
        }
        var _artLang = /^(html|svg|css|js|json|md|markdown|xml|txt|csv)$/i.test(c.lang || '');
      var _isWork = (typeof S !== 'undefined' && S.cfg && S.cfg.mode === 'work');
      var _fold = c.code.length > ((_isWork && _artLang) ? 300 : 600) || c.code.split('\n').length > 12;
      var _pre = '<pre' + (_ln ? ' class="ln"' : '') + '>' +
          '<div class="code-bar">' +
          (_rk ? '<button class="code-run" type="button" title="运行（' + (_rk === 'c' ? 'C 解释执行' : '沙箱预览') + '）" data-run="' + _rk + '"><svg class="ic"><use href="#i-play"/></svg></button>' : '') +
          '<button class="code-copy" type="button" title="复制代码"><svg class="ic"><use href="#i-copy"/></svg></button>' +
          '<button class="code-dl" type="button" title="下载为文件"><svg class="ic"><use href="#i-dl"/></svg></button>' +
          '<button class="code-wrap" type="button" title="自动换行 开/关"><svg class="ic"><use href="#i-tune"/></svg></button>' +
          '</div>' +
          (c.lang ? '<span class="lang">' + c.lang + '</span>' : '') +
          '<code>' + _bc + '</code></pre>';
        html += _fold
        ? '<details class="code-fold"><summary>' + esc(c.lang || 'code') + ' · ' +
          (c.code.length >= 1024 ? (c.code.length / 1024).toFixed(1) + ' KB' : c.code.length + ' 字符') +
          (_isWork && _artLang ? ' · 已存入右侧工作区' : ' · 点开看代码') + '</summary>' + _pre + '</details>'
        : _pre;
      i++; continue;
      }
      var mt = /^\uE002(\d+)\uE002$/.exec(line.trim()); /* 块级公式独占一行 */
      if (mt){ html += '<div class="math-blk">' + tex(maths[+mt[1]], true) + '</div>'; i++; continue; }

      if (/^\s*$/.test(line)){ i++; continue; }

      /* v2.3：独占一行的裸图片/视频直链也内嵌（模型常直接贴链接而不写 ![]()） */
      var bare = line.trim();
      if (!noMedia && /^https?:\/\/\S+$/i.test(bare) && (IMG_RE.test(bare) || VID_RE.test(bare))){
        html += '<p>' + mediaTag(bare, '') + '</p>'; i++; continue;
      }

      var h = /^(#{1,4})\s+(.+)$/.exec(line);
      if (h){ html += '<h' + h[1].length + '>' + inl(h[2]) + '</h' + h[1].length + '>'; i++; continue; }

      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)){ html += '<hr>'; i++; continue; }

      if (/^&gt;/.test(line)){ /* P1：引用块（支持嵌套，最多 3 层） */
        var ql = [];
        while (i < lines.length && /^&gt;/.test(lines[i])){ ql.push(lines[i]); i++; }
        function qDepth(s){ var d = 0, p = 0; while (d < 3 && s.substr(p, 4) === '&gt;'){ d++; p += 4; if (s.charAt(p) === ' ') p++; } return d; }
        function qStrip(s, d){ var p = 0, j; for (j = 0; j < d && s.substr(p, 4) === '&gt;'; j++){ p += 4; if (s.charAt(p) === ' ') p++; } return s.substr(p); }
        function renderQ(arr, depth){
          var out = '', qi = 0, buf = [];
          function flush(){ if (buf.length){ out += buf.map(inl).join('<br>'); buf = []; } }
          while (qi < arr.length){
            var dd = qDepth(arr[qi]);
            if (dd <= depth){ flush(); buf.push(qStrip(arr[qi], depth)); qi++; }
            else { flush(); var sub = []; while (qi < arr.length && qDepth(arr[qi]) > depth){ sub.push(arr[qi]); qi++; } out += renderQ(sub, depth + 1); }
          }
          flush();
          return '<blockquote>' + out + '</blockquote>';
        }
        html += renderQ(ql, 1);
        continue;
      }

      if (/^\s*([-*+]|\d+\.)\s+/.test(line)){ /* 列表（仅一级；P1：任务列表） */
        var ordered = /^\s*\d+\./.test(line), items = [];
        var re = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/;
        while (i < lines.length && re.test(lines[i])){ items.push(lines[i].replace(re, '')); i++; }
        html += ordered ? '<ol>' : '<ul>';
        for (var k = 0; k < items.length; k++){
          var tm = !ordered && /^\[([ xX])\]\s+/.exec(items[k]);
          if (tm){
            var done = tm[1].toLowerCase() === 'x';
            html += '<li class="md-task' + (done ? ' done' : '') + '"><input type="checkbox" disabled' + (done ? ' checked' : '') + '> ' + inl(items[k].replace(/^\[[ xX]\]\s+/, '')) + '</li>';
          } else {
            html += '<li>' + inl(items[k]) + '</li>';
          }
        }
        html += ordered ? '</ol>' : '</ul>';
        continue;
      }

      if (line.indexOf('|') >= 0 && i + 1 < lines.length &&
          /^\|?[\s:|-]+\|?$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0){ /* 表格（P1：对齐 + 横向滚动） */
        var head = splitRow(line);
        var sepCells = splitRow(lines[i + 1]), aligns = [];
        for (k = 0; k < sepCells.length; k++){
          var sc = sepCells[k];
          var l = /^:/.test(sc), rr = /:$/.test(sc);
          aligns.push(l && rr ? 'ta-c' : rr ? 'ta-r' : 'ta-l');
        }
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && !/^\s*$/.test(lines[i])){
          rows.push(splitRow(lines[i])); i++;
        }
        html += '<div class="tb-wrap"><table><thead><tr>';
        for (k = 0; k < head.length; k++) html += '<th class="' + (aligns[k] || 'ta-l') + '">' + inl(head[k]) + '</th>';
        html += '</tr></thead><tbody>';
        for (var r = 0; r < rows.length; r++){
          html += '<tr>';
          for (k = 0; k < rows[r].length; k++) html += '<td class="' + (aligns[k] || 'ta-l') + '">' + inl(rows[r][k]) + '</td>';
          html += '</tr>';
        }
        html += '</tbody></table></div>';
        continue;
      }

      /* P1：定义列表（术语 + 下一行 `: 解释`） */
      if (i + 1 < lines.length && /^:\s+/.test(lines[i + 1]) &&
          !/^(#{1,4}\s|&gt;|\s*([-*+]|\d+\.)\s|\s*(-{3,}|\*{3,})\s*$)/.test(line) &&
          !/^\uE000\d+\uE000$/.test(line.trim()) && !/^\uE002\d+\uE002$/.test(line.trim()) &&
          !/^\s*$/.test(line)){
        html += '<dl>';
        while (i < lines.length && !/^\s*$/.test(lines[i]) && i + 1 < lines.length && /^:\s+/.test(lines[i + 1])){
          var dt = lines[i]; i++;
          html += '<dt>' + inl(dt) + '</dt>';
          while (i < lines.length && /^:\s+/.test(lines[i])){ html += '<dd>' + inl(lines[i].replace(/^:\s+/, '')) + '</dd>'; i++; }
        }
        html += '</dl>';
        continue;
      }

      var para = []; /* 普通段落：连续非空行 */
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,4}\s|&gt;\s?|\s*([-*+]|\d+\.)\s|\s*(-{3,}|\*{3,})\s*$)/.test(lines[i]) &&
             !/^\uE000\d+\uE000$/.test(lines[i].trim()) &&
             !/^\uE002\d+\uE002$/.test(lines[i].trim())){
        /* P1：不要把定义列表的术语/解释吞进段落 */
        if (/^:\s+/.test(lines[i]) || (i + 1 < lines.length && /^:\s+/.test(lines[i + 1]) &&
            !/^(#{1,4}\s|&gt;|\s*([-*+]|\d+\.)\s|\s*(-{3,}|\*{3,})\s*$)/.test(lines[i]))) break;
        para.push(lines[i]); i++;
      }
      if (!para.length){ /* v0.3.5：所有分支都不认这一行（如只有 '## ' 的标题符），强制前进，否则死循环 */
        html += '<p>' + inl(lines[i]) + '</p>'; i++; continue;
      }
      html += '<p>' + para.map(inl).join('<br>') + '</p>';
    }
    /* P1：脚注列表 */
    if (fnOrder.length){
      html += '<div class="fn-list"><ol>';
      for (var fi = 0; fi < fnOrder.length; fi++)
        html += '<li id="fn-' + (fi + 1) + '">' + inl(fnDefs[fnOrder[fi]]) + '</li>';
      html += '</ol></div>';
    }
    return html;
  }
  /* fs-* 围栏→文件工具卡片（c.code 已整体转义） */
  /* v1.28.1：当前模式没有的工具围栏 —— 别让它看着像在跑 */
  function deadCard(c){
    var mn = { chat: 'Chat', work: 'Work', agent: 'Agent', soul: 'Soul' }[S.cfg.mode] || S.cfg.mode;
    return '<div class="tool-card dead"><div class="th"><span class="tag">' + esc(c.lang) + '</span>' +
      '<span>本轮不执行</span><span class="meta">' + esc(mn) + ' 模式没有这个工具</span></div>' +
      '<div class="tb"><pre><code>' + c.code + '</code></pre></div></div>'; /* c.code 已在 render 入口统一转义，不能再 esc 一次 */
  }
  function toolCard(c){
    var lang = c.lang || '', code = c.code || '';
    var head = code.split('\n')[0] || '';
    var line1 = (code.split('\n')[1] || '').slice(0, 0);
    var title = { run: '运行', 'vfs-write': '写入虚拟文件', 'vfs-list': '列目录', 'vfs-read': '读取虚拟文件', patch: '应用补丁', preview: '预览', web: '抓取网页', crawl: '批量抓取', search: '联网搜索', play: '打开播放', download: '下载视频', get: '抓取文件', browser: '打开内置浏览器', python: '运行 Python' }[lang] || lang;
    var meta = '';
    if (lang === 'vfs-write' || lang === 'patch' || lang === 'vfs-list' || lang === 'vfs-read' || lang === 'web' || lang === 'search' || lang === 'play' || lang === 'download' || lang === 'get' || lang === 'browser' || lang === 'python'){
      meta = head.trim();
    } else if (lang === 'run'){
      meta = head.trim().slice(0, 80);
    }
    var nline = code.split('\n').length;
    /* v0.2.1：写入/补丁/长代码默认折叠，只留标题行（点标题展开）——避免整篇文件把对话刷满 */
    var folded = (c.code || '').length > 600 || nline > 12;
    return '<div class="tool-card' + (lang === 'run' ? ' run' : '') + (folded ? ' collapsed' : '') + '">' +
      '<div class="th" data-tc="1">' +
      '<span class="tag">' + esc(lang) + '</span><span>' + esc(title) + '</span>' +
      (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') +
      (lang === 'web' || lang === 'search' || lang === 'play' || lang === 'download' || lang === 'get' ? '' : '<span class="meta">' + nline + ' 行</span>') + '</div>' +
      '<div class="tb"><pre><code>' + code + '</code></pre></div></div>';
  }
  function fsCard(c){
    var nl = c.code.indexOf('\n'), path = (nl >= 0 ? c.code.slice(0, nl) : c.code).trim();
    var label = { 'fs-read': '读取', 'fs-list': '列目录', 'fs-write': '写入申请', 'fs-done': '已写入', 'fs-rej': '已拒绝', 'fs-back': '已撤销' }[c.lang] || c.lang;
    var outside = /^[a-zA-Z]:[\\/]/.test(path) || /^[\\/]{1,2}/.test(path) || path.split(/[\\/]/).indexOf('..') >= 0; // 工作区外（v1.4）
    var h = '<div class="fs-card"><div class="fs-head"><span class="fs-badge' +
      (c.lang === 'fs-done' ? ' ok' : c.lang === 'fs-rej' ? ' rej' : '') + '">' + label + '</span><span class="fs-path">' + path + '</span>';
    if (c.lang === 'fs-write' && outside)
      h += '<span class="fs-badge rej" title="目标不在授权工作区文件夹内">工作区外</span>';
    if (c.lang === 'fs-write')
      h += '<button class="btn btn-primary" type="button" data-act="fs-apply" data-path="' + path + '">应用写入</button>' +
           '<button class="btn btn-sec" type="button" data-act="fs-reject" data-path="' + path + '">拒绝</button>';
           if (c.lang === 'fs-done' && snapAny(path))
             h += '<button class="btn btn-sec" type="button" data-act="fs-undo" data-path="' + path + '" title="把文件恢复成本次写入前的内容">撤销这次写入</button>';
    h += '</div>';
    if (c.lang === 'fs-write'){
      h += '<div class="fs-diff" data-fspath="' + path + '"></div>';
      if (outside) h += '<div class="hunk">⚠ 目标在授权工作区之外：应用前会再次弹出「位置 + 操作内容」确认框（宿主仍会拦截系统目录）。</div>';
    }
    return h + '</div>';
  }
  
/* v1.29.3：```ask 围栏 → 提问卡片（问题 + 可选项 + 自由回答） */
function askCard(c){
  var body = String(c.code || '');
  var lines = body.split('\n'), q = (lines[0] || '').trim(), note = '', opts = [], stopOpts = false;
  for (var i = 1; i < lines.length; i++){
    var t = lines[i].trim();
    if (!t) continue;
    if (/^[-*•]\s+/.test(t)){ if (!stopOpts) opts.push(t.replace(/^[-*•]\s+/, '')); }
    else { if (opts.length) stopOpts = true; if (!note) note = t; } // v0.3.49：遇到第二个问题就停止收集选项，别把两题的选项混成一列
  }
  var askSid = (typeof S !== 'undefined' && S.sid) ? S.sid : 'draft';
  var rawKey = askSid + '|' + q.slice(0, 80) + '|' + opts.join(',');
var key = rawKey.replace(/"/g, '&quot;');
var keyAttr = encodeURIComponent(rawKey); // v0.3.61：属性里放编码值，读回来再解码，避免 HTML 实体解码后对不上
  var done = (typeof S !== 'undefined' && S._asked && S._asked[key]) || '';
  var h = '<div class="ask-card' + (done ? ' done' : '') + '" data-askkey="' + keyAttr + '">' +
    '<div class="ask-h"><span class="ask-badge">提问</span><span class="ask-q">' + q + '</span></div>';
  if (done) return h + '<div class="ask-body"><div class="ask-done">已选：' + done + '</div></div></div>';
  if (note) h += '<div class="ask-note">' + note + '</div>';
  if (opts.length){
    h += '<div class="ask-opts">';
    opts.forEach(function(o){ h += '<button type="button" class="ask-opt" data-ask-opt="' + o + '">' + o + '</button>'; });
    h += '</div>';
  }
  h += '<div class="ask-free"><input class="ask-in" type="text" placeholder="或者直接写一句回答，回车提交">' +
    '<button type="button" class="btn btn-primary" data-ask-sub="1">回答</button></div>';
  return h + '<div class="ask-body"></div></div>';
}
/* 回答提交：写进对话 → 触发新一轮（用户消息，模型接着做） */
function askAnswer(card, text){
  if (!card || !text) return;
  if (S.sending){ UI.toast('等这轮回复结束再回答，或先点停止', true); return; } // v0.3.2：发不出去还会掐断生成
var key = card.getAttribute('data-askkey') || ''; try { key = decodeURIComponent(key); } catch (e) {} // v0.3.61：与写入时的编码对齐
  S._asked = S._asked || {};
  if (Object.keys(S._asked).length > 200) S._asked = {};
  S._asked[key] = text;
  card.classList.add('done');
  var body = card.querySelector('.ask-body');
  if (body){ body.textContent = ''; var d = document.createElement('div'); d.className = 'ask-done'; d.textContent = '已选：' + text; body.appendChild(d); }
  var free = card.querySelector('.ask-free'); if (free) free.parentNode.removeChild(free);
  var opts = card.querySelector('.ask-opts'); if (opts) opts.parentNode.removeChild(opts);
  try {
    var qEl = card.querySelector('.ask-q');
    var q = qEl ? String(qEl.textContent || '').trim() : '';
    var inp = document.getElementById('input');
    if (!inp) return;
    /* v0.4.1：把「回答的是哪道题、选了什么」写清楚，模型不会再当成没选；这条消息不单独占气泡 */
    inp.value = '【回答】' + (q ? '提问「' + q + '」的选择：' : '') + text +
      '\n（这是用户点选的选项，不是新任务：按这个选择继续，别再问同一件事；没点到的部分按默认方案做并标注假设。）';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    S._hideNext = 1;
    var sb = document.getElementById('btn-send');
    try { if (sb && !sb.disabled) sb.click(); else if (typeof sendMessage === 'function') sendMessage(); }
    finally { S._hideNext = 0; }
  } catch (e) { try { console.error('ask 回答提交失败', e); } catch (e2) {} }
}
document.addEventListener('click', function(ev){
  var t = ev.target; if (!t || !t.closest) return;
  var sub = t.closest('[data-ask-sub]'), opt = t.closest('[data-ask-opt]');
  if (!sub && !opt) return;
  var card = (sub || opt).closest('.ask-card'); if (!card) return;
  ev.preventDefault(); ev.stopPropagation();
  var text = opt ? (opt.getAttribute('data-ask-opt') || '') : ((card.querySelector('.ask-in') || {}).value || '');
  askAnswer(card, String(text).trim());
}, true);
/* 回车即提交 */
document.addEventListener('keydown', function(ev){
  if (ev.key !== 'Enter') return;
  var t = ev.target; if (!t || !t.classList || !t.classList.contains('ask-in')) return;
  var card = t.closest('.ask-card'); if (!card) return;
  ev.preventDefault(); askAnswer(card, String(t.value || '').trim());
}, true);

function diff(oldT, newT){ /* 行级简易 diff：公共前后缀+中段替换（卡片预览） */
    var a = String(oldT || '').split('\n'), b = String(newT || '').split('\n'), s = 0, e = 0, i, out = [];
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    function ctx(t){ out.push('<span class="ctx">  ' + esc(t) + '</span>'); }
    for (i = Math.max(0, s - 3); i < s; i++) ctx(a[i]);
    for (i = s; i < a.length - e; i++) out.push('<span class="del">- ' + esc(a[i]) + '</span>');
    for (i = s; i < b.length - e; i++) out.push('<span class="add">+ ' + esc(b[i]) + '</span>');
    for (i = a.length - e; i < Math.min(a.length, a.length - e + 3); i++) ctx(a[i]);
    if (out.length > LIMITS.FS_DIFF_LINES) out = out.slice(0, LIMITS.FS_DIFF_LINES)
      .concat(['<span class="hunk">…（差异预览已按 ' + LIMITS.FS_DIFF_LINES + ' 行截断）</span>']);
    return out.join('');
  }
  /* v1.28.4：围栏自检 —— 未闭合 / 参数为空要说出来，别静默丢掉 */
  var TOOL_RE = /^(crawl|run|vfs-write|vfs-list|vfs-read|patch|preview|web|search|play|download|get|browser|skill|agent|sub|suball|python|fs-[a-z-]+)$/i;
  /* v1.1.10：fs-* / vfs-write / patch 的路径写在围栏下一行也是合法格式，
     旧规则把它们误报成「缺少参数」。只保留确实要求围栏同行带参数的网搜/代理类。 */
  var ARG_REQ = /^(agent|sub|web|search|get|browser|play|download|skill)$/i;
  function warn(text){
    var out = [], lines = String(text || '').split(/\r?\n/), open = null;
    function push(kind, lang, line){
      for (var k = 0; k < out.length; k++) if (out[k].kind === kind && out[k].lang === lang) return;
      out.push({ kind: kind, lang: lang, line: line });
    }
    for (var i = 0; i < lines.length; i++){
      var ln = lines[i], m = ln.match(/^```([A-Za-z0-9+#_-]*)[ \t]*([^\n]*)$/);
      if (!m) continue;
      var lang = m[1] || '', arg = String(m[2] || '').trim();
      if (!open){ open = { lang: lang, arg: arg, line: i + 1 }; continue; }
      var o = open; open = null;
      if (ARG_REQ.test(o.lang) && !o.arg) push('empty', o.lang, o.line);
    }
    if (open && TOOL_RE.test(open.lang)) push('unclosed', open.lang, open.line);
    return out;
  }
  /* v1.28.4：证据 —— 只认工具结果，不认正文里的『已完成』 */
  function evidence(text){
    var t = String(text || ''), lines = t.split(/\r?\n/), i, l;
    var gen = (t.match(/```(?:vfs-write|patch|fs-write|fs-done|fs-back)/g) || []).length;
    var saved = (t.match(/\[vfs\]\s*已写入/g) || []).length + (t.match(/\[(?:get|download)\]\s*已保存/g) || []).length +
                (t.match(/```fs-done/g) || []).length;
    var ranOk = 0, ranBad = 0, verified = 0, m;
    for (i = 0; i < lines.length; i++){
      l = lines[i];
      if (/^\[run-result\]/.test(l)){ if (/成功/.test(l)) ranOk++; else if (/失败/.test(l)) ranBad++; }
      else if ((m = /^退出码\s*(\d+)/.exec(l))) { if (+m[1]) ranBad++; else ranOk++; }
      else if (/超时/.test(l) && /^\[cmd\]/.test(l)) ranBad++;
      m = l.match(/【verify】/g); if (m) verified += m.length;
      if (/^\[sub\]\s*verify\b/.test(l)) verified++;
    }
    return { gen: gen, saved: saved, ranOk: ranOk, ranBad: ranBad, verified: verified };
  }
  return { render: render, diff: diff, warn: warn, evidence: evidence };
})();
/* ==== 运行面板注入开始 ==== */
/* C 解释器（c4 风格 int/char 子集，供沙箱运行面板） */
/* ---- 内嵌 C 解释器（c4 风格：int / char / 指针 / 数组 / 函数 子集）----
   仅 32 位整数与字符；无浮点 / 结构体 / 标准库（printf/puts/putchar/strlen 内建）。
   类型模型：{ base:'int'|'char'|'void', ptr:n, dims:[...] }。dims 表示数组剩余维度。
   字符串字面量按 UTF-8 存入内存，readCStr 按 UTF-8 解码（支持中文）。 */
function createCInterp(src) {
  'use strict';

  var TYPEEKW = { int: 1, char: 1, void: 1, unsigned: 1, signed: 1, long: 1, short: 1,
    const: 1, static: 1, extern: 1, register: 1, auto: 1, volatile: 1,
    struct: 1, union: 1, enum: 1, typedef: 1 };
  var KWORDS = { if: 1, else: 1, while: 1, for: 1, do: 1, return: 1, break: 1, continue: 1, sizeof: 1 };
  for (var _k in TYPEEKW) KWORDS[_k] = 1;

  function escChar(e) {
    switch (e) {
      case 'n': return 10; case 't': return 9; case 'r': return 13; case '0': return 0;
      case '\\': return 92; case "'": return 39; case '"': return 34; case 'a': return 7;
      case 'b': return 8; case 'f': return 12; case 'v': return 11; case '?': return 63;
      default: return e.charCodeAt(0);
    }
  }
  function utf8Bytes(s) {
    var a = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) a.push(c);
      else if (c < 0x800) a.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c <= 0xDBFF) {
        var c2 = s.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        a.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else a.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return a;
  }
  function utf8Decode(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length;) {
      var b = bytes[i++];
      if (b < 0x80) s += String.fromCharCode(b);
      else if (b < 0xE0) s += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
      else if (b < 0xF0) s += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      else {
        var cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        cp -= 0x10000; s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023));
      }
    }
    return s;
  }

  function tokenize(src) {
    src = src.replace(/^[ \t]*#[^\n]*/gm, ''); // 剥离预处理指令（保留换行以维持行号）
    var i = 0, line = 1, toks = [];
    var OPS = ['<<=', '>>=', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
      '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='];
    while (i < src.length) {
      var c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue;
      }
      if (c >= '0' && c <= '9') {
        if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
          i += 2; var hs = ''; while (i < src.length && /[0-9a-fA-F]/.test(src[i])) hs += src[i++];
          toks.push({ k: 'num', v: parseInt(hs || '0', 16) | 0, line: line }); continue;
        }
        var ds = ''; while (i < src.length && /[0-9]/.test(src[i])) ds += src[i++];
        if (src[i] === 'L' || src[i] === 'U' || src[i] === 'u' || src[i] === 'l') i++;
        toks.push({ k: 'num', v: parseInt(ds, 10) | 0, line: line }); continue;
      }
      if (c === "'") {
        i++; var v;
        if (src[i] === '\\') { i++; v = escChar(src[i++]); } else v = src.charCodeAt(i++);
        if (src[i] === "'") i++;
        toks.push({ k: 'num', v: v & 255, line: line }); continue;
      }
      if (c === '"') {
        i++; var str = '';
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\') { i++; str += String.fromCharCode(escChar(src[i++])); }
          else str += src[i++];
        }
        i++; toks.push({ k: 'str', v: str, line: line }); continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        var id = '';
        while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) id += src[i++];
        toks.push({ k: (KWORDS[id] || TYPEEKW[id]) ? 'kw' : 'id', v: id, line: line }); continue;
      }
      var m = null;
      for (var oi = 0; oi < OPS.length; oi++) if (src.startsWith(OPS[oi], i)) { m = OPS[oi]; break; }
      if (m) { toks.push({ k: 'op', v: m, line: line }); i += m.length; continue; }
      toks.push({ k: 'op', v: c, line: line }); i++;
    }
    toks.push({ k: 'eof', v: '', line: line });
    return toks;
  }

  var ASSIGN = { '=': 1, '+=': 1, '-=': 1, '*=': 1, '/=': 1, '%=': 1, '&=': 1, '|=': 1, '^=': 1, '<<=': 1, '>>=': 1 };
  var BINPREC = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];

  function T(base, ptr, dims) { return { base: base, ptr: ptr || 0, dims: dims || [] }; }
  function sizeOf(t) {
    var b = (t.ptr > 0 || t.base === 'int' || t.base === 'void') ? 4 : 1;
    if (t.dims && t.dims.length) { var p = 1; for (var i = 0; i < t.dims.length; i++) p *= t.dims[i]; return b * p; }
    return b;
  }
  function elementType(t) {
    if (t.dims && t.dims.length) return { base: t.base, ptr: t.ptr, dims: t.dims.slice(1) };
    if (t.ptr > 0) return { base: t.base, ptr: t.ptr - 1, dims: [] };
    return { base: t.base, ptr: 0, dims: [] };
  }
  function isScalarLoad(t) { return (t.ptr > 0 || t.base === 'int' || t.base === 'void'); }

  function Interp(src) {
    this.toks = tokenize(src);
    this.p = 0;
    this.globals = {};
    this.funcs = {};
    this.out = [];
    this.steps = 0;
    this.limit = 30000000;
    this.callDepth = 0;
    var MEM = 1 << 21;
    this.mem = new Uint8Array(MEM);
    this.dv = new DataView(this.mem.buffer);
    this.gp = 0;
    this.sp = MEM;
  }

  Interp.prototype.err = function (msg, ln) { var e = new Error(msg + (ln ? '（第 ' + ln + ' 行）' : '')); e.cErr = true; throw e; };
  Interp.prototype.peek = function (o) { var t = this.toks[this.p]; return o === undefined ? t : ((t.k === 'op' || t.k === 'kw') && t.v === o); };
  Interp.prototype.peekKw = function () { return this.toks[this.p].k === 'kw' ? this.toks[this.p].v : null; };
  Interp.prototype.next = function () { return this.toks[this.p++]; };
  Interp.prototype.expect = function (o) { var t = this.toks[this.p]; if ((t.k === 'op' || t.k === 'kw') && t.v === o) { this.p++; return t; } this.err("期望 '" + o + "'，实际为 '" + t.v + "'", t.line); };
  Interp.prototype.expectId = function () { var t = this.toks[this.p]; if (t.k !== 'id') this.err("期望标识符，实际为 '" + t.v + "'", t.line); this.p++; return t.v; };

  Interp.prototype.galloc = function (size) {
    size = (size + 3) & ~3;
    var a = this.gp; this.gp += size; if (this.gp >= (1 << 20)) this.err('全局区内存溢出');
    return a;
  };
  Interp.prototype.storeStr = function (s) {
    var bytes = utf8Bytes(s);
    var a = this.galloc(bytes.length + 1);
    for (var i = 0; i < bytes.length; i++) this.mem[a + i] = bytes[i];
    this.mem[a + bytes.length] = 0;
    return a;
  };
  Interp.prototype.readCStr = function (addr) {
    var bytes = [];
    for (var i = 0; i < 1 << 18; i++) { var b = this.mem[(addr + i) & (this.mem.length - 1)]; if (b === 0) break; bytes.push(b); }
    return utf8Decode(bytes);
  };

  /* ---- 类型解析 ---- */
  Interp.prototype.parseType = function () {
    var base = null, ptr = 0, saw = false;
    while (true) {
      var t = this.toks[this.p];
      if (t.k !== 'kw' || !TYPEEKW[t.v]) break;
      if (t.v === 'struct' || t.v === 'union' || t.v === 'enum' || t.v === 'typedef') this.err('暂不支持 ' + t.v + '（仅 int/char 子集）', t.line);
      if (t.v === 'char') base = 'char';
      else if (t.v === 'void') base = base || 'void';
      else if (base === null) base = 'int';
      saw = true; this.p++;
    }
    while (this.peek('*')) { ptr++; this.p++; }
    if (!saw) this.err('缺少类型');
    return T(base || 'int', ptr);
  };
  Interp.prototype.isTypeAhead = function () { var t = this.toks[this.p]; return t.k === 'kw' && TYPEEKW[t.v] ? true : false; };

  /* ---- 顶层解析 ---- */
  Interp.prototype.parse = function () {
    while (this.toks[this.p].k !== 'eof') {
      var ty = this.parseType();
      while (true) {
        var name = this.expectId();
        if (this.peek('(')) { this.parseFunc(ty, name); break; }
        this.parseVarDeclTail(ty, name, true);
        if (this.peek(',')) { this.p++; continue; }
        this.expect(';'); break;
      }
    }
  };

  Interp.prototype.parseFunc = function (retType, name) {
    this.expect('(');
    var params = [];
    if (!this.peek(')')) {
      if (this.peekKw() === 'void' && this.toks[this.p + 1].v === ')') { this.p++; }
      else {
        while (true) {
          if (this.peek('.')) this.err('暂不支持可变参数 ...');
          var pt = this.parseType();
          var pn = null;
          if (this.toks[this.p].k === 'id') pn = this.next().v;
          while (this.peek('[')) { this.p++; if (!this.peek(']')) this.parseExpr(); this.expect(']'); pt.ptr++; }
          params.push({ name: pn, type: pt });
          if (this.peek(',')) { this.p++; continue; }
          break;
        }
      }
    }
    this.expect(')');
    this.funcs[name] = { name: name, ret: retType, params: params, body: this.parseBlock() };
  };

  Interp.prototype.parseVarDeclTail = function (baseType, name, isGlobal) {
    var dims = [];
    while (this.peek('[')) {
      this.p++;
      var n = 1;
      if (!this.peek(']')) { var e = this.parseExpr(); n = this.constEval(e); }
      this.expect(']'); dims.push(n);
    }
    var type = T(baseType.base, baseType.ptr, dims.slice());
    var size = sizeOf(type);
    var v = { name: name, type: type, baseType: baseType, dims: dims, isArray: dims.length > 0, addr: 0 };
    if (isGlobal) { v.addr = this.galloc(Math.max(size, 1)); this.globals[name] = v; }
    if (this.peek('=')) {
      this.p++;
      if (this.peek('{')) this.skipInitializer();
      else {
        var init = this.parseExpr();
        if (!isGlobal) v.initExpr = init;
        else { var iv = this.constEval(init); this.wr(v.addr, iv, baseType); }
      }
    }
    return v;
  };

  Interp.prototype.skipInitializer = function () {
    this.expect('{'); var depth = 1;
    while (depth > 0 && this.toks[this.p].k !== 'eof') { var t = this.next(); if (t.v === '{') depth++; else if (t.v === '}') depth--; }
  };

  Interp.prototype.parseBlock = function () {
    this.expect('{');
    var body = [];
    while (!this.peek('}')) { if (this.toks[this.p].k === 'eof') this.err('代码块未闭合'); body.push(this.parseStmt()); }
    this.expect('}');
    return { t: 'block', body: body };
  };

  Interp.prototype.parseStmt = function () {
    var t = this.toks[this.p];
    if (t.k === 'op' && t.v === '{') return this.parseBlock();
    if (t.k === 'op' && t.v === ';') { this.p++; return { t: 'empty' }; }
    if (t.k === 'kw') {
      if (t.v === 'if') {
        this.p++; this.expect('('); var c = this.parseExpr(); this.expect(')');
        var th = this.parseStmt(), el = null;
        if (this.peekKw() === 'else') { this.p++; el = this.parseStmt(); }
        return { t: 'if', c: c, th: th, el: el };
      }
      if (t.v === 'while') { this.p++; this.expect('('); var c2 = this.parseExpr(); this.expect(')'); return { t: 'while', c: c2, b: this.parseStmt() }; }
      if (t.v === 'do') { this.p++; var b2 = this.parseStmt(); this.expect('while'); this.expect('('); var c3 = this.parseExpr(); this.expect(')'); this.expect(';'); return { t: 'do', b: b2, c: c3 }; }
      if (t.v === 'for') {
        this.p++; this.expect('(');
        var init = null;
        if (!this.peek(';')) init = this.isTypeAhead() ? this.parseDecl(false) : { t: 'expr', e: this.parseExpr() };
        this.expect(';');
        var cond = this.peek(';') ? null : this.parseExpr(); this.expect(';');
        var step = this.peek(')') ? null : this.parseExpr(); this.expect(')');
        return { t: 'for', init: init, cond: cond, step: step, b: this.parseStmt() };
      }
      if (t.v === 'return') { this.p++; var e = this.peek(';') ? null : this.parseExpr(); this.expect(';'); return { t: 'return', e: e }; }
      if (t.v === 'break') { this.p++; this.expect(';'); return { t: 'break' }; }
      if (t.v === 'continue') { this.p++; this.expect(';'); return { t: 'continue' }; }
      if (TYPEEKW[t.v]) return this.parseDecl(true);
    }
    var ex = this.parseExpr(); this.expect(';');
    return { t: 'expr', e: ex };
  };

  Interp.prototype.parseDecl = function (needsSemi) {
    var ty = this.parseType();
    var items = [];
    while (true) {
      var name = this.expectId();
      items.push(this.parseVarDeclTail(ty, name, false));
      if (this.peek(',')) { this.p++; continue; }
      break;
    }
    if (needsSemi) this.expect(';');
    return { t: 'decl', items: items };
  };

  /* ---- 表达式 ---- */
  Interp.prototype.parseExpr = function () { return this.parseAssign(); };
  Interp.prototype.parseAssign = function () {
    var l = this.parseCond();
    var t = this.toks[this.p];
    if (t.k === 'op' && ASSIGN[t.v]) { this.p++; var r = this.parseAssign(); return { t: 'assign', op: t.v, l: l, r: r }; }
    return l;
  };
  Interp.prototype.parseCond = function () {
    var c = this.parseBin(0);
    if (this.peek('?')) { this.p++; var a = this.parseAssign(); this.expect(':'); var b = this.parseCond(); return { t: 'cond', c: c, a: a, b: b }; }
    return c;
  };
  Interp.prototype.parseBin = function (lvl) {
    if (lvl >= BINPREC.length) return this.parseUnary();
    var l = this.parseBin(lvl + 1);
    while (true) {
      var t = this.toks[this.p];
      if (t.k === 'op' && BINPREC[lvl].indexOf(t.v) >= 0) { this.p++; var r = this.parseBin(lvl + 1); l = { t: 'bin', op: t.v, l: l, r: r }; }
      else return l;
    }
  };
  Interp.prototype.parseUnary = function () {
    var t = this.toks[this.p];
    if (t.k === 'kw' && t.v === 'sizeof') {
      this.p++;
      if (this.peek('(') && this.toks[this.p + 1].k === 'kw' && TYPEEKW[this.toks[this.p + 1].v]) {
        this.p++; var ty = this.parseType(); this.expect(')');
        return { t: 'num', v: sizeOf(ty) };
      }
      return { t: 'sizeof', e: this.parseUnary() };
    }
    if (t.k === 'op') {
      if (t.v === '++' || t.v === '--') { this.p++; return { t: 'pre', op: t.v, e: this.parseUnary() }; }
      if (t.v === '-' || t.v === '+' || t.v === '!' || t.v === '~' || t.v === '*' || t.v === '&') { this.p++; return { t: 'un', op: t.v, e: this.parseUnary() }; }
    }
    return this.parsePostfix();
  };
  Interp.prototype.parsePostfix = function () {
    var e = this.parsePrimary();
    while (true) {
      if (this.peek('[')) { this.p++; var idx = this.parseExpr(); this.expect(']'); e = { t: 'index', a: e, i: idx }; continue; }
      if (this.peek('(')) {
        this.p++; var args = [];
        if (!this.peek(')')) { while (true) { args.push(this.parseAssign()); if (this.peek(',')) { this.p++; continue; } break; } }
        this.expect(')');
        e = { t: 'call', f: e, args: args }; continue;
      }
      if (this.peek('++') || this.peek('--')) { var op = this.next().v; e = { t: 'post', op: op, e: e }; continue; }
      if (this.peek('.') || this.peek('->')) this.err('暂不支持结构体成员访问');
      break;
    }
    return e;
  };
  Interp.prototype.parsePrimary = function () {
    var t = this.toks[this.p];
    if (t.k === 'num') { this.p++; return { t: 'num', v: t.v }; }
    if (t.k === 'str') { this.p++; return { t: 'str', v: t.v }; }
    if (t.k === 'id') { this.p++; return { t: 'id', name: t.v }; }
    if (t.k === 'op' && t.v === '(') { this.p++; var e = this.parseExpr(); this.expect(')'); return e; }
    this.err("表达式中出现意外记号 '" + t.v + "'", t.line);
  };

  Interp.prototype.constEval = function (node) {
    var savedOut = this.out; this.out = [];
    try { var v = this.eval(node, {}).v; this.out = savedOut; return v; }
    catch (e) { this.out = savedOut; this.err('需要常量表达式'); }
  };

  /* ---- 内存读写 ---- */
  Interp.prototype.rdAddr = function (addr, ty) {
    if (isScalarLoad(ty)) return this.dv.getInt32(addr, true);
    return this.mem[addr] & 255;
  };
  Interp.prototype.wr = function (addr, v, ty) {
    if (isScalarLoad(ty)) this.dv.setInt32(addr, v | 0, true);
    else this.mem[addr] = v & 255;
  };
  Interp.prototype.varSize = function (v) { return sizeOf(v.type); };

  Interp.prototype.sameTypeDims = function (t) { return t.dims && t.dims.length > 0; };

  /* index 求值：返回 {addr, ty} 用于 lvalue；rvalue 再加载 */
  Interp.prototype.indexRef = function (node, env) {
    var base = this.eval(node.a, env);
    var idx = this.eval(node.i, env).v;
    var et = elementType(base.ty);
    var addr = (base.v + idx * sizeOf(et)) | 0;
    return { addr: addr, ty: et };
  };

  Interp.prototype.derefRef = function (node, env) {
    var e = this.eval(node.e, env);
    return { addr: e.v, ty: elementType(e.ty) };
  };

  Interp.prototype.loadRef = function (ref, env) {
    if (this.sameTypeDims(ref.ty)) return { v: ref.addr, ty: ref.ty }; // 数组行 → 退化为地址
    return { v: this.rdAddr(ref.addr, ref.ty), ty: ref.ty };
  };

  /* ---- 求值 ---- */
  Interp.prototype.eval = function (node, env) {
    if (++this.steps > this.limit) this.err('执行步数超过上限（可能存在死循环）');
    switch (node.t) {
      case 'num': return { v: node.v | 0, ty: T('int', 0) };
      case 'str': { if (node.__addr === undefined) node.__addr = this.storeStr(node.v); return { v: node.__addr, ty: T('char', 1) }; }
      case 'id': return this.evalId(node.name, env);
      case 'sizeof': {
        if (node.e.t === 'id') { var vv = env[node.e.name] || this.globals[node.e.name]; if (vv) return { v: this.varSize(vv) | 0, ty: T('int', 0) }; }
        var e = this.eval(node.e, env); return { v: sizeOf(e.ty) | 0, ty: T('int', 0) };
      }
      case 'index': return this.loadRef(this.indexRef(node, env), env);
      case 'un': return this.evalUn(node, env);
      case 'pre': return this.evalPre(node, env);
      case 'post': return this.evalPost(node, env);
      case 'bin': return this.evalBin(node, env);
      case 'cond': return this.eval(node.c, env).v ? this.eval(node.a, env) : this.eval(node.b, env);
      case 'assign': return this.evalAssign(node, env);
      case 'call': return this.evalCall(node, env);
      default: this.err('未知表达式 ' + node.t);
    }
  };

  Interp.prototype.evalId = function (name, env) {
    var v = env[name] || this.globals[name];
    if (!v) this.err("未声明的标识符 '" + name + "'");
    if (v.isArray) return { v: v.addr, ty: v.type };
    return { v: this.rdAddr(v.addr, v.type), ty: v.type };
  };

  Interp.prototype.evalUn = function (node, env) {
    if (node.op === '&') { var lv = this.lvalue(node.e, env); return { v: lv.addr, ty: T(lv.ty.base, (lv.ty.ptr || 0) + 1) }; }
    if (node.op === '*') { return this.loadRef(this.derefRef(node, env), env); }
    var v = this.eval(node.e, env).v;
    if (node.op === '-') return { v: (-v) | 0, ty: T('int', 0) };
    if (node.op === '+') return { v: v, ty: T('int', 0) };
    if (node.op === '!') return { v: v ? 0 : 1, ty: T('int', 0) };
    if (node.op === '~') return { v: (~v) | 0, ty: T('int', 0) };
  };

  Interp.prototype.evalPre = function (node, env) {
    var lv = this.lvalue(node.e, env);
    var nv = (lv.v + (node.op === '++' ? 1 : -1)) | 0;
    this.wr(lv.addr, nv, lv.ty);
    return { v: nv, ty: lv.ty };
  };
  Interp.prototype.evalPost = function (node, env) {
    var lv = this.lvalue(node.e, env);
    var old = lv.v;
    this.wr(lv.addr, (old + (node.op === '++' ? 1 : -1)) | 0, lv.ty);
    return { v: old, ty: lv.ty };
  };

  Interp.prototype.evalBin = function (node, env) {
    var op = node.op;
    if (op === '&&') return { v: (this.eval(node.l, env).v && this.eval(node.r, env).v) ? 1 : 0, ty: T('int', 0) };
    if (op === '||') return { v: (this.eval(node.l, env).v || this.eval(node.r, env).v) ? 1 : 0, ty: T('int', 0) };
    var a = this.eval(node.l, env), b = this.eval(node.r, env);
    var iv = T('int', 0);
    if ((op === '+' || op === '-') && (a.ty.ptr > 0 || b.ty.ptr > 0 || this.sameTypeDims(a.ty) || this.sameTypeDims(b.ty))) {
      var pty = (a.ty.ptr > 0 || this.sameTypeDims(a.ty)) ? a.ty : b.ty;
      var sz = sizeOf(elementType(pty));
      if (op === '+') return { v: (a.v + b.v * sz) | 0, ty: pty };
      if ((a.ty.ptr > 0) && (b.ty.ptr > 0)) return { v: ((a.v - b.v) / sz) | 0, ty: iv };
      return { v: (a.v - b.v * sz) | 0, ty: pty };
    }
    switch (op) {
      case '+': return { v: (a.v + b.v) | 0, ty: iv };
      case '-': return { v: (a.v - b.v) | 0, ty: iv };
      case '*': return { v: Math.imul(a.v, b.v) | 0, ty: iv };
      case '/': if (b.v === 0) this.err('除以零'); return { v: (a.v / b.v) | 0, ty: iv };
      case '%': if (b.v === 0) this.err('除以零'); return { v: (a.v % b.v) | 0, ty: iv };
      case '<': return { v: a.v < b.v ? 1 : 0, ty: iv };
      case '>': return { v: a.v > b.v ? 1 : 0, ty: iv };
      case '<=': return { v: a.v <= b.v ? 1 : 0, ty: iv };
      case '>=': return { v: a.v >= b.v ? 1 : 0, ty: iv };
      case '==': return { v: a.v === b.v ? 1 : 0, ty: iv };
      case '!=': return { v: a.v !== b.v ? 1 : 0, ty: iv };
      case '&': return { v: (a.v & b.v) | 0, ty: iv };
      case '|': return { v: (a.v | b.v) | 0, ty: iv };
      case '^': return { v: (a.v ^ b.v) | 0, ty: iv };
      case '<<': return { v: (a.v << b.v) | 0, ty: iv };
      case '>>': return { v: (a.v >> b.v) | 0, ty: iv };
    }
    this.err('未知运算符 ' + op);
  };

  Interp.prototype.lvalue = function (node, env) {
    if (node.t === 'id') {
      var v = env[node.name] || this.globals[node.name];
      if (!v) this.err("未声明的标识符 '" + node.name + "'");
      if (v.isArray) this.err('不能给数组名赋值');
      return { addr: v.addr, ty: v.type, v: this.rdAddr(v.addr, v.type) };
    }
    if (node.t === 'index') { var r = this.indexRef(node, env); if (this.sameTypeDims(r.ty)) this.err('不能给数组行赋值'); return { addr: r.addr, ty: r.ty, v: this.rdAddr(r.addr, r.ty) }; }
    if (node.t === 'un' && node.op === '*') { var r2 = this.derefRef(node, env); if (this.sameTypeDims(r2.ty)) this.err('不能给数组行赋值'); return { addr: r2.addr, ty: r2.ty, v: this.rdAddr(r2.addr, r2.ty) }; }
    this.err('不是可赋值的左值');
  };

  Interp.prototype.evalAssign = function (node, env) {
    var lv = this.lvalue(node.l, env);
    var rv;
    if (node.op === '=') rv = this.eval(node.r, env).v;
    else {
      var r = this.eval(node.r, env).v;
      switch (node.op) {
        case '+=': rv = (lv.v + r) | 0; break;
        case '-=': rv = (lv.v - r) | 0; break;
        case '*=': rv = Math.imul(lv.v, r) | 0; break;
        case '/=': if (r === 0) this.err('除以零'); rv = (lv.v / r) | 0; break;
        case '%=': if (r === 0) this.err('除以零'); rv = (lv.v % r) | 0; break;
        case '&=': rv = (lv.v & r) | 0; break;
        case '|=': rv = (lv.v | r) | 0; break;
        case '^=': rv = (lv.v ^ r) | 0; break;
        case '<<=': rv = (lv.v << r) | 0; break;
        case '>>=': rv = (lv.v >> r) | 0; break;
        default: this.err('未知赋值 ' + node.op);
      }
    }
    this.wr(lv.addr, rv, lv.ty);
    return { v: rv, ty: lv.ty };
  };

  Interp.prototype.evalCall = function (node, env) {
    if (node.f.t !== 'id') this.err('不支持函数指针调用');
    var name = node.f.name;
    if (name === 'printf') return this.callPrintf(node.args, env);
    if (name === 'putchar') { var c = this.eval(node.args[0], env).v; this.out.push(String.fromCharCode(c & 255)); return { v: c, ty: T('int', 0) }; }
    if (name === 'puts') { var s = this.readCStr(this.eval(node.args[0], env).v); this.out.push(s + '\n'); return { v: s.length, ty: T('int', 0) }; }
    if (name === 'strlen') return { v: this.readCStr(this.eval(node.args[0], env).v).length, ty: T('int', 0) };
    var fn = this.funcs[name];
    if (!fn) this.err("未定义的函数 '" + name + "'");
    if (++this.callDepth > 2000) this.err('递归层数过深（>2000）');
    var savedSp = this.sp;
    var args = [];
    for (var i = 0; i < node.args.length; i++) args.push(this.eval(node.args[i], env));
    var newEnv = {};
    for (var pi = 0; pi < fn.params.length; pi++) {
      var prm = fn.params[pi];
      var pname = prm.name || ('__arg' + pi);
      var sz = Math.max(sizeOf(prm.type), 4);
      this.sp = (this.sp - sz) & ~3;
      var pv = { name: pname, type: prm.type, baseType: prm.type, dims: [], isArray: false, addr: this.sp };
      var a = args[pi];
      this.wr(pv.addr, a ? a.v : 0, prm.type);
      newEnv[pname] = pv;
    }
    var ret = 0;
    try { this.execStmt(fn.body, newEnv); }
    catch (sig) { if (sig && sig.__return) ret = sig.v; else { this.sp = savedSp; this.callDepth--; throw sig; } }
    this.sp = savedSp;
    this.callDepth--;
    return { v: ret | 0, ty: fn.ret };
  };

  Interp.prototype.callPrintf = function (argNodes, env) {
    var fmt = this.readCStr(this.eval(argNodes[0], env).v);
    var args = [];
    for (var i = 1; i < argNodes.length; i++) args.push(this.eval(argNodes[i], env).v);
    var s = this.format(fmt, args);
    this.out.push(s);
    return { v: s.length, ty: T('int', 0) };
  };

  Interp.prototype.format = function (fmt, args) {
    var out = '', i = 0, ai = 0;
    while (i < fmt.length) {
      var ch = fmt[i++];
      if (ch !== '%') { out += ch; continue; }
      if (fmt[i] === '%') { out += '%'; i++; continue; }
      var spec = '';
      while (i < fmt.length && /[-+ 0#]/.test(fmt[i])) spec += fmt[i++];
      var width = '';
      while (i < fmt.length && /[0-9]/.test(fmt[i])) width += fmt[i++];
      var prec = -1;
      if (fmt[i] === '.') { i++; var pd = ''; while (i < fmt.length && /[0-9]/.test(fmt[i])) pd += fmt[i++]; prec = pd ? parseInt(pd, 10) : 0; }
      while (i < fmt.length && /[lhLzjt]/.test(fmt[i])) i++;
      var conv = fmt[i++];
      var val = args[ai++];
      var s;
      switch (conv) {
        case 'd': case 'i': s = String(val | 0); break;
        case 'u': s = String(val >>> 0); break;
        case 'x': s = (val >>> 0).toString(16); break;
        case 'X': s = (val >>> 0).toString(16).toUpperCase(); break;
        case 'o': s = (val >>> 0).toString(8); break;
        case 'c': s = String.fromCharCode(val & 255); break;
        case 's': s = this.readCStr(val); if (prec >= 0) s = s.slice(0, prec); break;
        case 'p': s = '0x' + (val >>> 0).toString(16); break;
        default: s = '%' + conv;
      }
      var w = width ? parseInt(width, 10) : 0;
      if (prec >= 0 && /[duxXo]/.test(conv)) { while (s.length < prec) s = '0' + s; }
      if (w > s.length) {
        var left = spec.indexOf('-') >= 0;
        var pad = (spec.indexOf('0') >= 0 && !left) ? '0' : ' ';
        s = left ? s + new Array(w - s.length + 1).join(pad) : new Array(w - s.length + 1).join(pad) + s;
      }
      out += s;
    }
    return out;
  };

  Interp.prototype.execStmt = function (node, env) {
    if (++this.steps > this.limit) this.err('执行步数超过上限（可能存在死循环）');
    switch (node.t) {
      case 'block': for (var i = 0; i < node.body.length; i++) this.execStmt(node.body[i], env); return;
      case 'empty': return;
      case 'expr': this.eval(node.e, env); return;
      case 'decl': for (var d = 0; d < node.items.length; d++) this.declLocal(node.items[d], env); return;
      case 'if':
        if (this.eval(node.c, env).v) this.execStmt(node.th, env);
        else if (node.el) this.execStmt(node.el, env);
        return;
      case 'while':
        while (this.eval(node.c, env).v) {
          try { this.execStmt(node.b, env); }
          catch (sig) { if (sig && sig.__break) break; if (sig && sig.__continue) continue; throw sig; }
        }
        return;
      case 'do':
        do {
          try { this.execStmt(node.b, env); }
          catch (sig) { if (sig && sig.__break) break; if (sig && sig.__continue) { } else throw sig; }
        } while (this.eval(node.c, env).v);
        return;
      case 'for':
        if (node.init) { if (node.init.t === 'decl') { for (var k = 0; k < node.init.items.length; k++) this.declLocal(node.init.items[k], env); } else this.eval(node.init.e, env); }
        while (node.cond === null || this.eval(node.cond, env).v) {
          var broke = false;
          try { this.execStmt(node.b, env); }
          catch (sig) { if (sig && sig.__break) broke = true; else if (sig && sig.__continue) { } else throw sig; }
          if (broke) break;
          if (node.step) this.eval(node.step, env);
        }
        return;
      case 'return': throw { __return: true, v: node.e ? this.eval(node.e, env).v : 0 };
      case 'break': throw { __break: true };
      case 'continue': throw { __continue: true };
      default: this.err('未知语句 ' + node.t);
    }
  };

  Interp.prototype.declLocal = function (item, env) {
    var sz = Math.max(this.varSize(item), 4);
    this.sp = (this.sp - sz) & ~3;
    if (this.sp <= (1 << 20)) this.err('栈溢出');
    item.addr = this.sp;
    if (item.initExpr) this.wr(item.addr, this.eval(item.initExpr, env).v, item.baseType);
    env[item.name] = item;
  };

  Interp.prototype.run = function () {
    try {
      this.parse();
      var main = this.funcs['main'];
      if (!main) this.err('找不到 main() 函数');
      try { this.execStmt(main.body, {}); }
      catch (sig) { if (!(sig && sig.__return)) throw sig; }
      return { output: this.out.join(''), error: null };
    } catch (e) {
      return { output: this.out.join(''), error: e && e.message ? e.message : String(e) };
    }
  };

  return new Interp(src);
}

function runC(src) { return createCInterp(src).run(); }


/* ==== 代码运行面板（v1.9）：web 类代码沙箱 iframe 预览 + C 解释执行 ==== */

/* 语言 → 运行类型（决定运行按钮是否出现；'c' 走解释器，其余走沙箱预览） */
function crKind(lang){
  if (!lang) return null;
  var l = String(lang).toLowerCase();
  if (l === 'html' || l === 'htm') return 'html';
  if (l === 'svg') return 'svg';
  if (l === 'js' || l === 'javascript' || l === 'mjs') return 'js';
  if (l === 'css') return 'css';
  if (l === 'c' || l === 'cpp' || l === 'cc' || l === 'c++') return 'c';
  return null;
}

var RUNNER = (function(){
  var frame, out, srcEl, emptyEl, kindEl, statusEl, bound = false;
  var cur = null;
  var curNonce = '', cap = null; /* v2.0：捕获态 {lines,chars,cut,t0,done,res,idle,tmo}；nonce 防残留 iframe 串台 */
  var pvTmr = null; /* v2.5：预览自动刷新防抖 */

  /* 沙箱文档同源策略：外层 sandbox="allow-scripts"（无 allow-same-origin → 不透明源，
     碰不到主窗 DOM / localStorage / 宿主桥）；内联 CSP 再禁一切外网请求。 */
  var CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'">';

  /* 注入沙箱的 console 桥：log/info/warn/error + 未捕获错误 → postMessage 回主窗 */
  var BRIDGE = '<scr' + 'ipt>(' + function(){
    function fmt(a){
      try{
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);
        if (typeof a === 'function') return '[Function]';
        if (typeof a === 'bigint') return String(a) + 'n';
        return JSON.stringify(a, function(k, v){ return typeof v === 'function' ? '[Function]' : v; });
      }catch(e){ return String(a); }
    }
    function post(type, text){ try{ parent.postMessage({ __scrun: 1, nonce: __SC_NONCE__, type: type, text: text }, '*'); }catch(e){} }
    ['log', 'info', 'warn', 'error', 'debug'].forEach(function(k){
      var orig = console[k] ? console[k].bind(console) : function(){};
      console[k] = function(){
        var args = [].slice.call(arguments);
        post(k === 'error' ? 'error' : (k === 'warn' ? 'warn' : 'log'), args.map(fmt).join(' '));
        try{ orig.apply(null, args); }catch(e){}
      };
    });
    window.addEventListener('error', function(ev){
      post('error', (ev && ev.message ? ev.message : 'Error') + (ev && ev.lineno ? ' @行 ' + ev.lineno : ''));
    });
    window.addEventListener('unhandledrejection', function(ev){
      var r = ev && ev.reason;
      post('error', 'UnhandledRejection: ' + ((r && (r.stack || r.message)) || String(r)));
    });
    post('ready', '');
  }.toString() + ')();</scr' + 'ipt>';

  function buildDoc(kind, code, nonce){
    var head = '<meta charset="utf-8">' + CSP + BRIDGE.replace('__SC_NONCE__', JSON.stringify(String(nonce || '')));
    if (kind === 'svg'){
      return '<!doctype html><html><head>' + head + '</head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:' + tok('--code-bg','#0f1011') + ';color:' + tok('--code-ink','#f7f8f8') + '">' + code + '</body></html>';
    }
    if (kind === 'js'){
      return '<!doctype html><html><head>' + head + '</head><body><scr' + 'ipt>\ntry{\n' + code + '\n}catch(e){ console.error(e); }\n</scr' + 'ipt></body></html>';
    }
    if (kind === 'css'){
      var sample = '<h1>Heading 1</h1><h2>Heading 2</h2><p>这是一段用于预览样式的示例段落，The quick brown fox jumps over the lazy dog。可以在这里观察字体、颜色、间距与盒模型效果。</p><button>按钮 Button</button><ul><li>列表项一</li><li>列表项二</li></ul><p><a href="#">一个链接</a> · <input placeholder="输入框…"></p><div class="box">.box 示例块</div>';
      return '<!doctype html><html><head>' + head + '<style>\n' + code + '\n</style></head><body>' + sample + '</body></html>';
    }
    /* html / 默认 */
    if (/<html[\s>]/i.test(code) || /<!doctype/i.test(code)){
      if (/<head[\s>]/i.test(code)) return code.replace(/<head[^>]*>/i, function(m){ return m + head; });
      return code.replace(/<html[^>]*>/i, function(m){ return m + '<head>' + head + '</head>'; });
    }
    return '<!doctype html><html><head>' + head + '</head><body>\n' + code + '\n</body></html>';
  }

  function ce(tag, cls, txt){ var d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; }
  function clearOut(){ if (out) out.textContent = ''; }
  function line(cls, txt){
    if (!out) return;
    var rn = $('#runner');
    if (rn && rn.getAttribute('data-tab') !== 'out'){
      var t = rn.querySelector('.rn-tab[data-rt="out"]');
      if (t) t.classList.add('dot');
    }
    if (out.childNodes.length > 2000) out.removeChild(out.firstChild);
    out.appendChild(ce('span', 'rn-ln' + (cls ? ' ' + cls : ''), txt));
    out.scrollTop = out.scrollHeight;
  }
  /* v0.2.5：顶部分栏（工作区 / 运行 / 终端）——不再各区块单独折叠 */
  function setTab(name){
    var r = $('#runner'); if (!r) return;
    if (['ws', 'view', 'out', 'src', 'web'].indexOf(name) < 0) name = 'ws';
  if (name === 'web'){ var _wf = $('#web-frame'); if (_wf && !_wf.getAttribute('src')){ var _wu = $('#web-url'); if (_wu) _wu.focus(); } }
    r.setAttribute('data-tab', name);
    if (name !== 'web') webHostHide();
    else {
      var _wu2 = ($('#web-url') || {}).value || webLastUrl();
      if (_wu2){
        var _wIn = $('#web-url');
        if (_wIn && !_wIn.value) _wIn.value = _wu2;
        webHost(_wu2);
      }
    }
    try { localStorage.setItem('sc.rn.tab', name); } catch(e){}
    if (name === 'ws') renderWs();
  if (name === 'src') renderSrc();
    if (name === 'out'){ var t = r.querySelector('.rn-tab[data-rt="out"]'); if (t) t.classList.remove('dot'); }
  }
  function open(){
    document.body.classList.add('rn-open');
    var r = $('#runner');
    if (r && !r.getAttribute('data-tab')) setTab('ws');
    /* v1.1.8：重开面板时若停在「网页」标签，要把宿主浏览器重新叫出来；
       其它标签则确保原生控件已经收起，避免它浮在界面上挡住内容。 */
    var _tab = r && r.getAttribute('data-tab');
    if (_tab === 'web'){
      var _u = ($('#web-url') || {}).value || webLastUrl();
      if (_u){
        var _wIn2 = $('#web-url');
        if (_wIn2 && !_wIn2.value) _wIn2.value = _u;
        webHost(_u);
      }
    } else {
      try { webHostHide(); } catch (e) {}
    }
    renderWs();
  }
  var _preMaxW = null;
  function close(){ document.body.classList.remove('rn-open'); document.body.classList.remove('rn-max'); try { webHostHide(); } catch (e) {} }
  function toggleMax(){
    var r = $('#runner'); if (!r) return;
    if (document.body.classList.contains('rn-max')){
      document.body.classList.remove('rn-max');
      var w = _preMaxW || 390;
      r.style.width = w + 'px';
      document.documentElement.style.setProperty('--side-w', w + 'px');
      _preMaxW = null;
      setTimeout(function(){ var u = ($('#web-url') || {}).value || ''; if (u) webHost(u); }, 0);
    } else {
      _preMaxW = Math.round(r.getBoundingClientRect().width);
      document.body.classList.add('rn-max');
      setTimeout(function(){ var u = ($('#web-url') || {}).value || ''; if (u) webHost(u); }, 0);
    }
  }
  function reloadPanel(){
    var r = $('#runner'); if (!r) return;
    var tab = r.getAttribute('data-tab');
    if (tab === 'web'){
      var u = ($('#web-url') || {}).value || webLastUrl();
      if (!u){ UI.toast('还没有网页地址', true); return; }
      if (NET.bridge && NET.bridge.ok && NET.bridge.engine === 'webview2'){
        webHost(u);
        try { NET.bridge.send({ t: 'webview', op: 'reload' }); } catch (e) {}
      } else {
        var f = $('#web-frame');
        if (f){ f.setAttribute('src', ''); setTimeout(function(){ f.setAttribute('src', u); }, 30); }
      }
      return;
    }
    if (tab === 'view'){
      if (pv) pvRender({ sid: pv.sid, path: pv.path });
      return;
    }
    if (tab === 'ws'){ renderWs(); return; }
    if (tab === 'src'){ renderSrc(); return; }
    UI.toast('这个面板没有可刷新的内容');
  }
/* v0.3.88：网页在侧栏里打开，不再另起窗口；被网站拒绝嵌入时给一键切窗口的出口 */
/* v0.9.8：优先用宿主内嵌 WebView2（真浏览器，不受 X-Frame-Options 限制） */
