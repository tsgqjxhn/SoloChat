
/* 防闪烁：首帧前定主题 */
try{var __c=JSON.parse(localStorage.getItem('sc.cfg.v1')||localStorage.getItem('op.cfg.v1')||'{}'),__t=__c.theme||'auto';
if(__t==='auto')__t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
document.documentElement.dataset.theme=__t;}catch(e){document.documentElement.dataset.theme='light';}
