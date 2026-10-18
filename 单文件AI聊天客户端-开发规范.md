# 单文件 AI 聊天客户端 · 开发规范（v1.2）

> **文档用途**：这是一份"开发合同"。把它连同开工指令（附录 G）一起交给 AI（GLM-5.3-Flash / Muse Spark 1.3 / Claude / GPT 等），AI 应一次产出符合全部约束的单个 `index.html`。
>
> **产品形态**：单文件 HTML AI 对话客户端 → 在**自研 Windows WebView2 宿主**中加载（Tauri 亦可，见 §7.4）。
>
> **制定日期**：2026-10-13 ｜ **验收红线**：体积 / 内存 / DOM（见 §0）

---

## 0. 三条硬指标（验收红线）

| # | 指标 | 目标值 | 测量方式 |
|---|---|---|---|
| 1 | 单文件体积 | ≤ 1 MB（未压缩；v1.3 由 170 KB 上调，解除余量告警；v1.2 曾 150→170 KB） | `wc -c index.html` |
| 2 | 应用内存（JS Heap 口径） | 空载 ≤ 3 MB；标准负载 ≤ 10 MB；流式长跑增量 ≤ 1 MB | §9.2（DevTools / CDP） |
| 3 | DOM 节点 | 空载 ≤ 800；标准负载峰值 ≤ 3,000 | `document.getElementsByTagName('*').length` |

**内存口径定义**（对齐"不算浏览器内核"）：

- **计入**：页面 JS Heap（GC 后的 `performance.memory.usedJSHeapSize`）、DOM 节点、IndexedDB 内存侧缓存；
- **不计入**：`msedgewebview2.exe` 各进程的内核、合成器、GPU 开销；
- **交叉验证口径（可选）**：进程私有工作集增量 = 应用加载后 − 空白页基线（§9.3），仅看趋势。

> 可行性说明：零依赖原生应用基线堆约 1.5~3 MB（V8 运行时对象 + 应用状态 + 50 条消息 DOM），本规范所有限额（§4.3）都是按 10 MB 反推出来的，执行到位即可达标。

---

## 1. 产品定义与范围

### 1.1 是什么

单页、单文件、离线可打开的 AI 对话客户端：连接任意 **OpenAI 兼容 API**（`POST /chat/completions`），支持流式对话、多会话管理、Markdown 渲染、图片输入、消息编辑/重试、导入导出、明暗主题。

### 1.2 非目标（明确不做，用于保护内存预算）

| 不做 | 原因 |
|---|---|
| 代码高亮库（Prism / Shiki / highlight.js） | 体积 100 KB~MB 级，语法树常驻内存；用等宽字体 + 复制按钮替代 |
| 公式渲染（KaTeX / MathJax） | 字体 + 排版引擎数十 MB 级；直接显示 LaTeX 原文 |
| RAG / 向量检索 / 嵌入 | 超出范围，且吃内存与存储 |
| 插件系统 / i18n 框架 / Service Worker | 对单机 WebView 收益低，易引入常驻内存 |
| 消息分支树 / 虚拟滚动第三方库 | 超出"标准"范围；分页已足够 |
| 运行时 CDN 加载任何资源 | 破坏"单文件 + 离线可用"底线 |
| 头像图片 / 背景图 / WebFont / 图标字体 | 体积与合成层内存 |

**可选增强**（默认不实现；启用前须先算预算并在自检表登记）：极简正则代码高亮（≤ 5 KB，仅 5~8 种语言）、`content-visibility: auto`。

---

## 2. 参考开源实现与取舍（为什么是这套技术栈）

截至 2026-10-13 实测（GitHub API）：

| 项目 | 技术栈 | 借鉴 | 不采用 |
|---|---|---|---|
| [ollama-ui](https://github.com/ollama-ui/ollama-ui)（1,124★） | 纯原生 JS 单页 + 静态托管 | 零依赖、最简结构、流式 | 只支持 Ollama 原生协议 |
| [Cxmrykk/html-chat](https://github.com/Cxmrykk/html-chat)（3★，活跃） | 原生 JS + Vite 构建成单文件、IndexedDB | 预构建单文件产物、`reasoning_content` 显示、消息编辑/重试、会话导入导出 | 引入构建链、体积不受控 |
| [OpenCharacters](https://github.com/josephrocca/OpenCharacters)（400★） | 单 HTML + IndexedDB + OpenAI API | 无服务端结构、数据模型 | 已停更（2025-03）、角色扮演向 |
| [AI-QL/chat-ui](https://github.com/AI-QL/chat-ui)（96★） | Vue3 + Vuetify 打包进单 HTML | 自定义 endpoint、响应格式自适应 | 框架运行时（数百 KB + 数十 MB 内存），与 10 MB 红线冲突 |
| NextChat（88.8k★）/ LobeChat | Next.js 全栈工程 | 仅作功能清单参考 | 体积/内存完全不符 |

**结论（本规范采用）**：**原生 JS + 原生 CSS + IndexedDB + fetch/SSE 手写解析 + 自研 Markdown 渲染 + 零构建单文件**。

> 判据一句话：能达标的开源项目全部走"无框架、无运行时依赖"路线；引入框架就上到 MB 级体积/数十 MB 内存，直接与红线冲突。

---

## 3. 技术栈规范（白名单 / 黑名单）

### 3.1 总表

| 层 | 选型 | 明令禁止 |
|---|---|---|
| 语言 | 原生 ES2020 JavaScript，单文件 IIFE（`'use strict'`） | TypeScript 编译产物、任何转译/打包工具 |
| 框架 | 无 | Vue / React / Svelte / Preact / jQuery |
| 组件化 | 纯函数 + `createElement`；静态骨架可用模板字符串（**不含模型内容**） | innerHTML 模板注入动态内容 |
| 样式 | 原生 CSS + CSS 变量；系统字体栈 | Tailwind / Bootstrap / 预处理器 / WebFont |
| 状态 | 单例 `App.store`（约 120 行：state + 订阅 + 防抖持久化） | Redux / Zustand / Pinia |
| 通信 | `fetch` + `ReadableStream` + `TextDecoder`（手写 SSE 解析，附录 A） | `EventSource`、axios、openai SDK、任何 CDN |
| 存储 | IndexedDB（1 库 3 表：sessions / messages / attachments） | localStorage 存历史或 base64 大图 |
| Markdown | 自研白名单渲染器（≤ 350 行，先转义后标记，§5.4） | marked / markdown-it / DOMPurify / KaTeX / highlight.js |
| 代码块 | 等宽字体 + 右上角复制按钮（无高亮） | 任何高亮库 |
| 图标 | 内联 SVG sprite（≤ 8 KB） | 图标字体 / 图片文件 |
| 定时器 | 按需 + 页面隐藏时暂停 | 永久 `setInterval` / 常驻 rAF 循环 |
| Worker / WASM | 不用 | Worker / WASM（无收益，反而多一份堆） |
| 宿主桥 | 可选（自研宿主推荐，§7.2） | — |

### 3.2 明确禁止的写法

1. `innerHTML = 模型输出` —— 模型内容必须经 Markdown 渲染器（内部先转义）
2. `eval` / `new Function`
3. 大数组全量复制（`[...arr]`、`arr.slice()` 用于 500+ 元素）
4. base64 图片常驻 state（只允许发送瞬间存在，`finally` 置 null）
5. 每条消息各挂监听（一律事件委托：3 个容器 + 1 个 window）
6. CSS 大面积 `box-shadow` / `backdrop-filter` / `filter: blur`（合成层内存 + GPU 开销）
7. 滚动监听里做逐帧计算（节流 ≥ 100 ms 或 IntersectionObserver）

### 3.3 语言与兼容基线

- **目标运行时**：WebView2（Chromium 114+）；开发期用 Edge 直接调试
- **允许**：ES2020 特性（`?.`、`??`、`??=`）、`fetch`、`ReadableStream`、`AbortController`、`Intl.DateTimeFormat`、`navigator.clipboard`
- **禁用**：WebGPU、`SharedArrayBuffer`、顶层 `await`、import maps、`structuredClone` 用于大对象、OffscreenCanvas
- **不用 module 拆分**：单文件内以"分节注释 + 单 IIFE + 内部目标 `App`"组织

---

## 4. 单文件结构与数据模型

### 4.1 分区锚点（顺序固定，AI 输出必须带这些注释锚）

```
┌─ 0) <head>：meta + CSP + 内联 CSS（≤20KB）
├─ 1) 静态骨架：顶栏 / 会话列表容器 / 消息容器 / 输入区 / 设置弹层 / SVG sprite（≤10KB）
└─ 2) <script>：单 IIFE，内部分 9 节（v1.1 起），每节以 /* ==== N. NAME ==== */ 开头
     1 CONSTANTS   常量、默认配置、所有限额（§4.3）
     2 UTIL        dom 帮助、escapeHtml、throttle、fmtTime、uuid、sizeFmt
     3 STORE       状态树 + 订阅 + 防抖持久化
     4 DB          IndexedDB 封装（open / upgrade / get / put / del / iterate）
     5 NET         请求构造、SSE 解析、取消、重试、错误分类
     6 MD          Markdown 白名单渲染（全项目唯一允许生成 HTML 的地方）
     7 UI          渲染函数（会话列表 / 消息列表 / 输入区 / 弹层 / 主题）
     8 EVENTS      事件委托、快捷键、初始化、全局错误处理、beforeunload
     9 FS          文件 Agent（v1.1 新增）：fs 桥客户端接入、回合循环、写入确认
```

### 4.2 数据模型（字段固定，不得增删）

```js
Session    { id, title, createdAt, updatedAt, pinned, model, systemPrompt,
             params: { temperature, maxTokens }, msgCount }
Message    { id, sid, role: 'user'|'assistant'|'system', content, reasoning?,
             status: 'ok'|'streaming'|'aborted'|'error', ts,
             attachments: [aid...], tokens?, errMsg? }
Attachment { id, sid, name, mime, size, w, h, thumbKey }   // 原图+缩略图均以 Blob 存 IDB
Config     { baseURL, models: [...], currentModel, theme, stream: true,
             timeout: { connect: 15s, first: 60s, idle: 30s }, useBridge }
```

> API Key **不写入以上结构**：优先由宿主桥注入内存（§7.2）；无桥时存 localStorage，可选口令加密（`crypto.subtle` AES-GCM，`https://app.local` 是安全上下文所以可用）。
>
> **v1.2 修订**：允许为各结构增加带 `?` 的**可选字段**（向后兼容、不破坏既有数据；如 `Session.workspace?`、`Config.thinkList?/thinkByModel?/prompts?/fileOps?` 等）；破坏性增删仍然禁止。

### 4.3 硬性限额（必须写成常量并遵守）

| 项 | 限额 | 处理方式 |
|---|---|---|
| 单条消息文本 | ≤ 64 KB | 超出截断存储 + 标 `truncated` |
| 附件单张 | 原图 ≤ 5 MB；发送前压至 ≤ 300 KB | canvas 压缩：最长边 1600px、JPEG q0.82 |
| DOM 内消息 | 仅最近 50 条 | 更早显示"加载更早"按钮，每批 50 条 |
| 内存内会话 | 当前会话完整，其余仅索引 | 切换时按需从 IDB 读取 |
| 单次请求上下文 | 最近 20 条或 ≤ 32K 字符 | 超限从头裁剪（不丢 systemPrompt） |
| 导出 | 流式写 Blob | 禁止把整库 join 成一个字符串 |

---

## 5. 渲染与内存纪律（重点章节）

### 5.1 流式渲染规则

1. **追加式**：每个 chunk 只修改一个 `.msg-body` 的 `textContent` 尾部，禁止重建节点
2. **两段式（推荐省内存）**：流式期间写纯文本；结束时一次性换成 Markdown 渲染结果
3. **节流**：DOM 写操作经 `requestAnimationFrame` 合并，每帧最多一次
4. **自动滚动**：距底 ≤ 40px 才跟随；用户上滑后停止跟随，显示"回到底部"浮动按钮
5. **结束/取消**：一次性落库（IDB）+ 更新会话索引

### 5.2 必须遵守的内存规则（逐条验收）

1. `URL.createObjectURL` 与 `revokeObjectURL` 严格成对（附件预览、导出下载）
2. 删除消息/会话时：`AbortController.abort()` → 移除 DOM → 清 STORE → 清 IDB
3. 监听器只挂 4 处：sidebar / messages / composer / window（事件委托）
4. 无永久 `setInterval`；`visibilitychange` 隐藏时暂停全部定时器
5. 流式累加用字符串拼接 `acc += delta`，不留 chunk 数组
6. base64 只在发送瞬间存在；state 只存 Blob key
7. 切换会话时 revoke 上一会话的预览 URL
8. 禁止 `console.log` 打印消息体（只打统计量）；生产关闭日志
9. `beforeunload`：abort 全部请求 + flush 一次持久化

### 5.3 常见泄漏点（AI 必须自查）

- 消息节点闭包引用整段文本 → 用 `data-id` + 查表代替
- `reader` 未 `cancel()` 导致流悬挂
- 防抖定时器未清 → 会话对象无法回收
- 验收：堆快照中 `Detached HTMLElement` **必须 0 增长**（§9.2）

### 5.4 Markdown 白名单（渲染器规格）

- **顺序**：先整体 HTML 转义 → 再替换标记；链接只允许 `http(s)` 协议
- **支持**：标题 `#~####`、粗体、斜体、行内码、围栏代码块（含语言标注但不高亮）、有序/无序列表（一级）、引用、链接、分割线、表格（可选）
- **不支持**：原始 HTML 透传、图片内联显示（仅显示链接）、嵌套列表
- **代码块**：`<pre><code>` + 右上角复制按钮（`navigator.clipboard`，失败回退 `execCommand`）
- **文件工具卡片（v1.1）**：围栏语言以 `fs-` 开头的块渲染为专用卡片（头部：操作徽标 / 路径 / 状态；`fs-write` 体的 diff 预览做行级 `+`/`-` 染色，染色仅限卡片内）；卡片内按钮一律走事件委托，diff HTML 仍由 MD 分区生成

---

## 6. 通信规范（OpenAI 兼容）

### 6.1 请求构造

```
POST {baseURL}/chat/completions
Headers: Content-Type: application/json; Authorization: Bearer {key}
Body: {
  model, messages: [{role, content}], stream: true, temperature,
  max_tokens?, stream_options: { include_usage: true }
}
```

- **baseURL 规则**：以 `/v1` 结尾则原样拼接；否则自动补 `/v1`（404 时提示用户检查此项）
- **图片消息**：`content: [{type:'text',...}, {type:'image_url', image_url:{url:'data:image/jpeg;base64,...'}}]`
- **模型列表**：优先 `GET {baseURL}/models`；失败或为空 → 允许手动输入（逗号分隔）

### 6.2 SSE 解析规则（必须精确实现；参考代码见附录 A）

`TextDecoder({stream:true})` 累积 → 按 `\n` 切行、容忍 `\r\n` → `:` 开头忽略 → 多行 `data:` 拼成一条 → **空行触发派发** → `[DONE]` 结束 → `JSON.parse` 失败**忽略该事件、不中断流** → 取 `choices[0].delta.content` 与 `.reasoning_content`（兼容 `.reasoning`）→ 记录 `usage`。

**兜底**：若响应 `Content-Type` 是 `application/json`（服务端忽略 stream），整包解析一次。

### 6.3 错误处理矩阵

| 情况 | 判定 | UI 行为 |
|---|---|---|
| 401 / 403 | HTTP 状态 | 提示 Key 无效/无权限，直达设置 |
| 404 | HTTP 状态 | 提示检查 Base URL 是否缺 `/v1` |
| 429 | HTTP 状态 | 显示限流 + 重试（指数退避 1s/2s/4s，最多 3 次） |
| 5xx / 断流 | HTTP / reader 异常 | 保留已收内容 + 标"已中断" + 提供"继续生成" |
| `TypeError: Failed to fetch` | CORS 或断网 | 提示三选一解法（§6.4） |
| 首 token > 60s / 空闲 > 30s | 计时器 | 中止 + 标记 + 重试按钮 |

### 6.4 CORS 三选一（重要）

| 方案 | 适用 | 代价 |
|---|---|---|
| ① 页面直连（默认） | 服务商返回 CORS 头（如 OpenRouter）；OpenAI 官方**不允许**浏览器直连 | 受制于各服务商 |
| ② 宿主桥（自研宿主**推荐**） | 任何服务商；零 CORS 问题；Key 放 Windows 凭据管理器（§7.2） | 宿主侧 ~30 行代码 |
| ③ CF Worker 透传 | 不想动宿主时 | 多一个中间层 |

**启动探测**：`window.chrome?.webview` 存在且桥握手成功 → 走桥；否则直连。两种 transport 共用同一个 `NET.send()` 接口。

---

## 7. 宿主集成（自研 WebView2，从 0 写）

### 7.1 最小宿主配置（C# 示例）

```csharp
// 开发期附加调试端口；发布去掉该参数
var opts = new CoreWebView2EnvironmentOptions("--remote-debugging-port=9222");
var env  = await CoreWebView2Environment.CreateAsync(null, userDataFolder, opts);
await webView.EnsureCoreWebView2Async(env);

var s = webView.CoreWebView2.Settings;
s.IsStatusBarEnabled = false;  s.IsZoomControlEnabled = false;
s.IsGeneralAutofillEnabled = false; s.IsPasswordAutosaveEnabled = false;
s.AreDevToolsEnabled = true;   // 仅开发期；发布置 false

// 关键：虚拟主机映射 → 页面 origin 变为 https://app.local（安全上下文）
webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
    "app.local", appDir, CoreWebView2HostResourceAccessKind.DenyCors);
webView.Source = new Uri("https://app.local/index.html");
```

**要点**：

- 用虚拟主机映射（而非 `file://`）的理由：`https://app.local` 是**安全上下文**（`crypto.subtle` 可用）、IndexedDB 归属稳定 origin、规避 `file://` 的存储/CORS 坑
- 禁止 `--disable-web-security`（仅临时调试可用）
- 连本机 `http://localhost:11434`（Ollama）属混合内容会被拦：加 `--allow-running-insecure-content` 或直接走宿主桥
- 不用 Service Worker；导出下载走默认下载对话框（或桥保存）

### 7.1b 单文件发布（现网采用：全内嵌单 exe）

发布产物是**单个 2.14 MB 的 `SoloChatHost.exe`**——托管 DLL、`WebView2Loader.dll`、`index.html` 全部以 `EmbeddedResource` 嵌入 exe，启动时释放到临时目录加载（磁盘存在同名文件时优先磁盘，开发态不受影响）。拷一个文件到任意 Win10/11 即可运行，无散落依赖。

```xml
<!-- SoloChatHost.csproj：全部依赖内嵌 -->
<EmbeddedResource Include="...\Microsoft.Web.WebView2.Core.dll"><LogicalName>emb.Microsoft.Web.WebView2.Core.dll</LogicalName></EmbeddedResource>
<!-- ... WinForms / WebView2Loader / System.Text.Json 及其依赖 ... -->
<EmbeddedResource Include="..\index.html"><LogicalName>emb.index.html</LogicalName></EmbeddedResource>
```

要点：

- **Release 无 PDB / 无调试符号**（`DebugType=None`），避免泄露本机用户名与源路径
- **Release 无调试端口**（`#if DEBUG` 才带 `--remote-debugging-port=9222`）
- 唯一外部依赖是**系统预装的 WebView2 Runtime**（Win10/11 自带，边际磁盘成本 0）；应用自身真实内存占用 **~85 MB** 活动专用工作集
- 打包体积对比：单 exe 2.14 MB vs 全托管发布数十 MB；引擎侧 WebView2 Runtime 868 MB vs Sciter 18 MB（后者存储栈不可用，评估结论见开发记录，未采用）

### 7.2 宿主桥协议（推荐启用）

**页面 → 宿主**（`chrome.webview.postMessage`）：

```json
{"t":"http","id":"r17","url":"https://...","method":"POST","headers":{...},"body":"..."}
{"t":"http.abort","id":"r17"}
```

**宿主 → 页面**（`PostWebMessageAsJson`）：

```json
{"t":"http.meta","id":"r17","status":200}
{"t":"http.chunk","id":"r17","data":"data: {...}\n\n"}
{"t":"http.done","id":"r17"}
{"t":"http.error","id":"r17","message":"..."}
```

**页面侧适配器（约 15 行）**：

```js
const host = {
  ok: !!window.chrome?.webview,
  send(m) { window.chrome.webview.postMessage(m); },
  on(fn)  { window.chrome.webview.addEventListener('message', e => fn(e.data)); }
};
```

**宿主侧骨架要点**（完整流程：收到 `http` → `HttpClient.SendAsync(..., ResponseHeadersRead)` → 先发 `meta`，再循环读流发 `chunk`，最后 `done`）：

- ⚠️ **必须用 `StreamReader` 按字符读**（或增量 UTF-8 解码）；直接对 `byte[4096]` 做 `Encoding.UTF8.GetString` 会把中文/emoji 从中间切坏
- `http.abort` → `CancellationTokenSource.Cancel()`
- Key 建议存 Windows 凭据管理器（`wincred`），启动握手时注入页面内存，**不进 localStorage**

### 7.3 内存观测接线

- 开发期保留 `--remote-debugging-port=9222`，用 `edge://inspect` 连接，跑 §9 全部测量
- 加 `--enable-precise-memory-info` 让 `performance.memory` 返回精确字节（否则 100 KB 粒度量化）
- 发布版关闭 DevTools 端口，但保留"关于页手势 ×5 开诊断"入口以便复测

### 7.4 若改用 Tauri

- `frontendDist` 指向存放 `index.html` 的目录即可；Windows 下 WebView2 环境在安全上下文，§7.1 其余结论不变
- 桥改为 `invoke` / `event` API，§7.2 协议字段照用（宿主侧实现换成 Rust）
- 代价：Rust 侧宿主进程额外常驻内存（不计入本规范红线，但属"宿主"体积）

---

## 8. 功能与交互规范（内容要求）

### 8.1 Must（缺一不可）

会话管理（新建 / 重命名 / 删除 / 置顶 / 搜索）｜流式对话｜停止生成｜重试｜重新生成｜编辑用户消息｜删除消息｜Markdown 渲染｜代码块复制｜图片输入（粘贴 / 选择 / 拖放三通道）｜模型切换｜参数设置（temperature / max_tokens / system prompt）｜明暗主题｜导入 / 导出 JSON｜错误提示与重试｜快捷键

**快捷键表**：`Ctrl+Enter` 发送 ｜ `Esc` 停止生成 / 关弹层 ｜ `Ctrl+N` 新建会话 ｜ `Ctrl+K` 搜索会话 ｜ `↑`（空输入框时）回填上一条

### 8.2 Should（有余力再做）

token 估算显示（约 4 字符 ≈ 1 token）｜消息时间戳｜会话内搜索｜草稿自动保存｜"继续生成"

### 8.3 界面骨架

```
┌──────────────┬─────────────────────────────────────────┐
│ 会话列表      │  顶栏：模型▾  会话名  参数⚙  主题◐       │
│ [+ 新建]      ├─────────────────────────────────────────┤
│ □ 会话A       │                                         │
│ □ 会话B       │   消息区（仅渲染最近 50 条）              │
│ □ 会话C       │   ┌ 用户气泡（右）                       │
│              │   └ 助手气泡（左，含推理折叠 / 代码块）    │
│              │                       [回到底部↓]        │
│              ├─────────────────────────────────────────┤
│ ⚙ 设置        │  [📎] [输入框.................] [发送/停止]│
└──────────────┴─────────────────────────────────────────┘
```

### 8.4 交互细则（提前定死，避免返工）

- **发送后**：清空输入框（原稿另存草稿）→ 按钮变"停止"→ 贴底滚动
- **长消息**：渲染高度 > 2000px 折叠"展开/收起"
- **空状态**：无会话时显示引导（配置 API / 新建会话）
- **加载态**：三行灰条骨架屏，不用旋转动画
- **主题**：CSS 变量双主题；初始跟随 `prefers-color-scheme`，手动覆盖后持久化；**先设 `data-theme` 再渲染**（防闪烁）

---

## 9. 验收与自测（AI 必须跑完并在结尾回报）

### 9.1 体积

```bash
wc -c index.html        # ≤ 1048576 字节（v1.3 = 1MB）
```

### 9.2 内存三连测（DevTools / CDP）

| # | 场景 | 步骤 | 通过标准 |
|---|---|---|---|
| 1 | 空载 | 打开 → 等 10s → 手动触发 GC（DevTools Memory → Collect garbage） | `usedJSHeapSize` ≤ 3 MB |
| 2 | 标准负载 | 灌入 20 会话 × 100 条假数据 → 逐一切换遍历一遍 → GC | ≤ 10 MB |
| 3 | 流式长跑 | 用 mock SSE 端点回放 500 轮 → 每 100 轮 GC 记录 | 末端增量 ≤ 1 MB 且**无单调上升** |
| 4 | 泄漏 | 3 轮"新建 → 删除会话" → 堆快照前后对比 | Detached HTMLElement **0 增长** |

> 注：`performance.memory` 需精确值则加 `--enable-precise-memory-info`；`usedJSHeapSize` 含堆空闲区，**必须 GC 后读**。

### 9.3 进程级交叉验证（可选）

```powershell
Get-Process msedgewebview2 -ErrorAction SilentlyContinue |
  Measure-Object -Property PrivateMemorySize64 -Sum
```

与"空白页基线"之差即应用增量（含 DOM 合成，量级高于 JS Heap，仅看趋势、不作红线）。

### 9.4 功能演练表（逐项打勾）

断网发消息（提示正确）｜错误 Key（401 引导）｜错误 URL（404 提示补 `/v1`）｜429（退避重试）｜中途停止（保留已收内容）｜关闭应用重开（历史完整）｜导出 → 清库 → 导入（一致）｜连发 3 张大图（内存回落）｜切会话 20 次（内存不累积）

**文件 Agent 演练（v1.1 追加）**：mock 全链路（读 → 答 → 写申请 → 应用 → 续跑总结）｜绝对路径 / `..` 越界路径被拒绝并回传错误｜拒绝写入后文件保持原样｜工具循环中 Esc 中断无悬挂请求｜应用后重启，卡片状态（已写入）保持一致

### 9.5 DOM 与性能

- 标准负载下 `document.getElementsByTagName('*').length` ≤ 3000
- 首屏 TTI ≤ 300 ms（本地，无网络等待）
- 流式期间主线程无长任务 > 50 ms（Performance 面板验证）

---

## 10. 给 AI 的写作合同（Prompt Contract）

### 10.1 输出要求

1. **一次输出完整 `index.html`**：不省略、不用 `/* ... */` 占位、不留 TODO
2. 分节注释严格按 §4.1 编号；每节 ≤ 300 行；总行数 ≤ 12000（v1.3 配合 1MB 体积上调，v1.2 曾 3000→3600）
3. UI 文案与代码注释均用中文
4. 结尾附**自检表**：文件字节数 / 各节行数 / §9 各项结论 / 已知取舍与未实现项

### 10.2 必读坑（写作前默读）

SSE 行被网络切半 → 必须缓冲拼接｜`[DONE]` 与空行派发顺序｜`reasoning_content` 字段｜`data:` 冒号后可能有空格｜CORS 失败只能靠提示与桥｜模型输出必须 `textContent`/转义｜`revokeObjectURL` 成对｜监听器委托｜base64 不驻留｜自动滚动别和用户抢｜404 先怀疑缺 `/v1`｜双主题防闪烁｜流式结束才做完整 Markdown｜`beforeunload` flush

### 10.3 三轮交付节奏

| 轮次 | 内容 | 验收 |
|---|---|---|
| 第 1 轮 | 骨架 + CONSTANTS/UTIL/STORE/DB/NET/MD + 流式对话打通（可先接 mock） | §9.1、§9.2 测 1 |
| 第 2 轮 | 会话管理 + 设置 + 主题 + 导入导出 | §9.4 大部分 |
| 第 3 轮 | 图片输入 + 边角错误 + 完整自测 | §9 全量 |

---

## 附录

### A. SSE 解析参考实现（可直接作为规范附件）

```js
async function streamChat({url, headers, body, signal, onDelta, onDone, onError}) {
  let res;
  try { res = await fetch(url, {method:'POST', headers, body: JSON.stringify(body), signal}); }
  catch (e) { return onError(e); }                      // 含 AbortError / CORS TypeError
  if (!res.ok) return onError(new Error('HTTP ' + res.status));

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {                // 服务端忽略了 stream
    const j = await res.json();
    onDelta(j.choices?.[0]?.message?.content || '', false);
    return onDone(j.usage || null);
  }
  const reader = res.body.getReader(), dec = new TextDecoder('utf-8');
  let buf = '', data = [], usage = null;

  const flush = () => {                                  // 空行触发：派发一条事件
    if (!data.length) return false;
    const raw = data.join('\n'); data = [];
    if (raw === '[DONE]') return true;
    try {
      const j = JSON.parse(raw);
      if (j.usage) usage = j.usage;
      const d = j.choices && j.choices[0] && j.choices[0].delta || {};
      if (d.content) onDelta(d.content, false);
      const r = d.reasoning_content != null ? d.reasoning_content : d.reasoning;
      if (r) onDelta(r, true);
    } catch (_) { /* 坏事件忽略，不中断流 */ }
    return false;
  };

  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    buf += dec.decode(value, {stream: true});
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') { if (flush()) return onDone(usage); continue; }
      if (line[0] === ':') continue;                    // 注释/心跳行
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
  }
  flush();                                              // 收尾兜底
  onDone(usage);
}
```

### B. 宿主桥 C# 骨架要点（关键正确性提示）

- `WebMessageReceived` → 解析 `t/http` → 组 `HttpRequestMessage`（header 用 `TryAddWithoutValidation`）
- `SendAsync(req, HttpCompletionOption.ResponseHeadersRead)` → 先发 `meta`
- **用 `StreamReader` 循环 `ReadAsync(char[])` 发 `chunk`**；切勿按字节切后再 `UTF8.GetString`（会切坏多字节字符）
- 收到 `http.abort` → `CancellationTokenSource.Cancel()`
- 异常统一转 `{"t":"http.error", ...}`

### C. IndexedDB 最小封装要点

1 库（`ai-chat`，version 1）／3 表：`sessions`（keyPath `id`，索引 `updatedAt`）、`messages`（keyPath `id`，索引 `sid`）、`attachments`（keyPath `id`，Blob 值）
规则：写入用单事务批量 `put`；会话列表用游标分页（每页 50）；删除会话在同一事务内清其 `messages` + `attachments`。

### D. 测量命令集

| 目的 | 命令/方式 |
|---|---|
| 附加 DevTools | `edge://inspect`（需 `--remote-debugging-port=9222`） |
| 读 JS 堆 | DevTools Console：`performance.memory.usedJSHeapSize` |
| 精确内存 | 启动参数加 `--enable-precise-memory-info` |
| 进程内存 | `Get-Process msedgewebview2 | Measure-Object PrivateMemorySize64 -Sum` |
| DOM 计数 | `document.getElementsByTagName('*').length` |

### E. 参考项目（数据截至 2026-10-13）

ollama-ui 1,124★｜OpenCharacters 400★｜AI-QL/chat-ui 96★｜Cxmrykk/html-chat 3★（当日活跃）｜NextChat 88.8k★（Next.js，非单文件）
模型侧：GLM-5.3-Flash（MIT 开源、1M 上下文、$0.15/M 输入、Cline 有免费通道）适合第 1~3 轮快速迭代；Muse Spark 1.3（DeepSWE 75.4、Terminal-Bench 88.8、$1.25/$4.25）适合最后收口与疑难排查。

### F. 开工指令（复制给 AI 用）

```
你是一名资深前端工程师。请严格按《单文件 AI 聊天客户端 · 开发规范 v1.0》实现：

【硬指标】单文件 index.html ≤150KB；空载 JS Heap ≤3MB、标准负载 ≤10MB；禁用一切外部依赖、框架、CDN、构建工具。

【本轮任务】第 1 轮：完成 §4.1 全部分节骨架 + STORE/DB/NET/MD 可用 + 流式对话打通（接口可先指向 mock SSE）。

【交付要求】一次输出完整文件（不省略不占位）；按 §4.1 的 8 个分节注释组织；结尾附自检表（字节数/行数/§9 结论/取舍）。

【必读】先默读 §5.2 内存规则、§6.2 SSE 解析规则、§10.2 必读坑，再动手写。
```

---

*变更记录：v1.0（2026-10-13）初稿，目标平台 Windows WebView2 + 自研宿主，功能范围＝标准档。*
*变更记录：v1.1（2026-10-15）新增文件 Agent：§4.1 允许第 9 分区「FS」；§5.4 白名单增加 fs 卡片渲染与 diff 行级染色（仅卡片内）；§9.4 演练表补充 agent 场景。数据模型（§4.2）、请求体（§6.1）与总体红线（§0）不变，工具调用以 content 内文本标记协议实现。*
*变更记录：v1.2（2026-10-16）输入区编辑器化改造：§4.2 允许向后兼容的可选字段；§10.1 总行数上调至 3600；§0/§9.1 体积上限由 150KB 上调至 170KB（编辑器、工作区树与提示词库等界面扩展所致，解析开销可忽略）。新增：输入区左右分区（模式/模型/思考程度选择器、更多菜单、会话工作区）、侧栏工作区目录树、思考档位传输字段（enabled/disabled → thinking.type，其余 → reasoning_effort，Default 不传输）。*
*变更记录：v1.3（2026-10-17）规模上限放宽：§0/§9.1 体积上限由 170KB 上调至 1MB（1048576 字节）；§10.1 总行数随之上调至 12000。功能面（配置组、提示词页、自动压缩、上下文圆环等）扩展所致，check 脚本同步。*
