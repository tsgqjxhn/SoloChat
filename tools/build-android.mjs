import fs from 'node:fs';
import path from 'node:path';

/* 把构建产物 index.html 复制进 Android assets，并在 <meta charset> 后注入
   window.chrome.webview 兼容层（页面代码按桌面宿主写，Android 用真桥接）。 */
const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'index.html');
const dst = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'index.html');

const shim = `<script>
(function(){
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    postMessage: function(o){
      try{
        if (window.AndroidBridge && AndroidBridge.post) AndroidBridge.post((typeof o === 'string') ? o : JSON.stringify(o));
      }catch(e){}
    },
    addEventListener: function(t, fn){ window.__scBridgeCb = fn; }
  };
  window.__scBridgePush = function(s){
    try{ var d = (typeof s === 'string') ? JSON.parse(s) : s; if (window.__scBridgeCb) window.__scBridgeCb({data:d}); }catch(e){}
  };
  window.__SC_ANDROID__ = true;
})();
</script>
`;

let html = fs.readFileSync(src, 'utf8');
const anchor = '<meta name="viewport"';
const at = html.indexOf(anchor);
if (at < 0) throw new Error('index.html 里找不到 viewport 锚点');
if (!html.includes('__SC_ANDROID__')) html = html.slice(0, at) + shim + html.slice(at);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, html);
console.log('ANDROID ASSETS OK', Buffer.byteLength(html), 'shim_at', html.indexOf('__SC_ANDROID__'));
