# SoloChat

**v0.4.2 · 一个单 exe，双击就是一个完整的本地 AI 聊天客户端。**

没有安装器、没有前端构建步骤、没有 npm、没有云端。整个应用——界面、逻辑、图标、样式——全部内联在一个 `index.html` 里；配上宿主壳后发布成**单个 exe（`SoloChatHost.exe`）**，托管 DLL、原生加载器、页面统统嵌进这一个文件。拷到任何一台 Win10/11 机器，双击即用。

![首屏](screenshots/home.png)

## 为什么值得

| 事实 | 数字 |
|---|---|
| 发布产物 | **单个 exe**（全内嵌，零散落依赖；体积见「体积与资源占用」） |
| 应用真实内存占用 | **~85 MB**（v0.2 实测，口径为活动专用工作集） |
| 数据存放 | **100% 本机**——IndexedDB + localStorage，不上传、无遥测 |
| 外部依赖 | 仅系统预装的 WebView2 Runtime（Win10/11 自带，边际成本 0） |
| 源码可读性 | 核心仍是 **一个 `index.html`**（约 1 MB / 1.7 万行，CSS / JS / SVG 全内联），另配 `docs/工程规范.md` 与 `tools/verify.mjs` 静态闸门；任何编辑器打开即可读/改 |

它不是又一个 Electron 壳。没有几百 MB 的运行时、没有 node_modules、没有后台守护进程。你拿到的是一个**能直接读完的单文件**，和一个**能直接拷走的单 exe**。

## 特性

**v0.4 主题**

- **供应商目录 223 家（含 Atlas）** — 点选后自动填好 Base URL / 鉴权 / wire 协议 / 字段怪癖，不用手抄接口文档
- **四种 wire 协议** — `openai-chat` / `openai-responses` / `anthropic-messages` / `gemini`，协议与供应商正交，可任意组合
- **原生 function calling** — Work / Agent 把模型返回的 `tool_calls` 转成既有围栏执行链，工具白名单与开关照旧生效
- **输入区六类扩展选择器** — 智能体 / 插件 / 技能 / 工具 / 提示词 / MCP，配合 `/` 唤起的插入面板
- **插件市场与 Python 3.11 便携运行时** — 运行时安装到 `%LOCALAPPDATA%\OpenPage\runtimes`，不需要管理员权限，Agent 可执行 Python
- **新增搜索源** — Perplexity / 百度千帆 / You.com / Google Grounding，与原有九源并列可切

- **单文件架构** — CSS / JS / SVG 图标全内联在一个 `index.html`，浏览器双击即用
- **多配置组** — 一套界面管多组提供商（Base URL / Key / 模型 / 上下文上限），顶栏下拉切换，兼容任意 OpenAI 风格接口
- **流式对话** — SSE 流式渲染 + 中断/重试/继续；重新生成用**原地覆盖 + 多版本切换**（`< 2/3 >`）
- **上下文圆环** — 输入框右侧实时 prompt token 占比，悬浮看精确值与**缓存命中率**，≥70% 黄 / ≥90% 红预警
- **自动压缩** — 上下文到 80% 自动触发：早期对话提炼为 **9 段结构化摘要**，无缝续写
- **提示词库** — 设置页卡片管理，输入区 `/` 唤起插入
- **Markdown 渲染** — 表格 / 代码块（一键复制）/ 引用 / 高亮齐全，思考过程可折叠
- **Agent 模式** — 宿主内选本地目录，模型经 `fs-list / fs-read / fs-write` 文本协议读写文件，写入需确认
- **联网搜索** — 查询预处理与 LLM 改写（可关）→ Serper / SerpAPI / Brave / Tavily / Firecrawl / 博查 / Jina / Exa / Perplexity / 百度千帆 / You.com / Google Grounding / SearXNG 等 13 源检索（可切）→ 前 N 条网页正文抓取（可关）→ 编号+引用要求的结构化注入
- **文档解析与 OCR** — docx / xlsx / pptx / rtf 及带文本层的 PDF 零依赖本地提取；扫描版 PDF 可选 Mistral OCR、Azure 文档智能、Google Document AI、Amazon Textract、Adobe PDF Services、ABBYY、百度/阿里/腾讯 OCR（密钥进 DPAPI 保险库、附「测试识别」）
- **代理** — 「通用设置」页内代理区块，默认 `direct`（显式直连）；可填 `http://127.0.0.1:7897`（Clash / mihomo 混合端口）或留空跟随系统代理，宿主桥全通道生效，附「测试连通性」
- **其他** — 深/浅双主题、Alt+Space 全局呼出（宿主）、侧栏分组置顶、快捷键自定义、导入导出、`mock` 离线演示

- 历史版本（v0.3 及更早）见 [docs/变更记录.md](docs/变更记录.md)

## 截图

| 对话 | 设置 |
|---|---|
| ![对话](screenshots/chat.png) | ![设置](screenshots/settings.png) |

## 快速开始

### 方式一：浏览器直接用

双击 `index.html`，在 **设置 → 连接与模型** 填任意 OpenAI 兼容接口：

| 字段 | 说明 |
|---|---|
| Base URL | 例 `https://api.deepseek.com/v1`；已含 `/v1`、`/v3` 原样用，否则自动补全；填 `mock` 进离线演示 |
| API Key | 仅存本机 localStorage，不上传 |
| 模型 | 手动填或「获取列表」拉取 |

> 浏览器直连可能受 CORS 限制；受阻时用宿主方式，或自建透传。

### 方式二：单文件宿主（Windows，推荐）

需要 .NET SDK：

```powershell
dotnet publish host/SoloChatHost.csproj -c Release -o dist
```

产出 **单个 `dist/SoloChatHost.exe`**（托管 DLL + WebView2Loader + index.html 全嵌入）。双击运行，获得：Alt+Space 全局呼出并聚焦、文件 Agent 本地目录访问、受限网络下的请求桥。

## 数据存储

| 内容 | 位置 |
|---|---|
| 会话 / 消息 / 提示词 | IndexedDB（库名 `ai-chat`） |
| 配置（Base URL / 模型 / 主题等） | localStorage（键 `sc.cfg.v1`） |
| API Key / 搜索 Key / OCR Key | 宿主模式下走 DPAPI 保险库；浏览器模式回退 localStorage（明文，启动时警告） |

- 数据按**页面来源（origin）隔离**，不写入 html 本身，也不在任何"缓存"里
- 换浏览器、清数据、改路径都会看不到旧数据——长期数据请定期在 **设置 → 关于 → 数据与维护 → 导出** 备份

## 体积与资源占用

| 项目 | 实测值 |
|---|---|
| 发布产物 | `dist/SoloChatHost.exe` **3,180,032 字节**（v0.4.2，2026-11-06 发布），单文件，无任何散落 dll / config |
| 源码 | `index.html` **1,010,937 字节 / 16,823 行**（CSS、JS、SVG 全内联）；`host/Program.cs` **3,211 行 / 170,578 字节**（本轮未改 C#，实测不变） |
| 首次运行磁盘占用 | **v0.2 基线**：exe 2,593,280 + `%LOCALAPPDATA%\OpenPage` ≈ **65 MB**（其中 WebView2 运行时组件 ~60 MB：Widevine、过滤规则、着色器缓存；真正的聊天数据 IndexedDB 约 2 MB，随会话增长）；当前 exe 约 3.14 MB |
| 内存（可见空闲） | **v0.2 实测**：6 个进程（宿主 + 5 个 WebView2），工作集合计 ≈ **374 MB**，私有内存 ≈ **140 MB** |
| 内存（最小化） | **v0.2 实测**：宿主自身工作集 56 MB → **2.2 MB**，全树工作集 ≈ **219 MB**（低内存态挂起渲染进程） |
| 依赖 | Windows 10/11 自带的 .NET Framework 4.8 + WebView2 Runtime（系统级，随 Edge 更新） |

## 引擎选型：一次较真的评估

我们不满足于"能跑就行"，对替换 WebView2 的候选引擎 **Sciter** 做了逐层实测（不是纸面调研）：

| 维度 | WebView2 | Sciter |
|---|---|---|
| 引擎磁盘 | **868 MB** Runtime（系统级） | **18 MB** `sciter.dll` |
| 发布形态 | 单 exe + 依赖系统预装 Runtime | 单 dll + 页面 |
| 真实内存（活动专用） | ~85 MB | ~92 MB（基本打平） |
| 流式 SSE | 原生支持 | `fetch` 无流式（`body=null`） |
| 存储栈 | IndexedDB + localStorage | **两者皆无**，`@storage` 建库失败、`@sys` API 不可枚举 |

**结论（诚实版）**：Sciter 在**磁盘（47 倍）和架构简洁性**上是压倒性优势，但**内存两者打平**（Sciter 并无内存优势），且其**存储栈在裸环境不可用、流式缺失**——移植需重建整套持久化层，是独立专项，不值得为省磁盘冒险。当前交付 **WebView2 单 exe** 是工程上最稳的选择。这份评估的完整数据与过程见开发记录。

## 项目结构

```
SoloChat/
├── index.html                        # 核心：单文件聊天客户端（唯一运行时）
├── host/
│   ├── Program.cs                    # WebView2 宿主（托盘 / 热键 / 桥 / 文件访问 / 运行时）
│   ├── SoloChatHost.csproj           # 单文件发布：全部依赖内嵌
│   └── app.ico
├── docs/                             # 工程规范、审计-v0.4、对标记录、扩展路线图、变更记录
├── tools/verify.mjs                  # 零依赖静态闸门（6 项）
├── plugins/                          # market.json + Python 3.11 便携运行时 zip
├── dist/SoloChatHost.exe             # 发布产物（单文件）
├── screenshots/                      # README 截图
├── LICENSE                           # MIT
└── .gitignore
```

## 开发

- 硬约束与流程见 `docs/工程规范.md`：单文件 `index.html` ≤ 1,048,576 字节 / ≤ 18,000 行，零外部依赖，ES5 / IIFE，内联脚本按规范分区
- 当前闸门：`node tools/verify.mjs`（6 项：内联脚本语法、字节数、行数、重复 id、版本一致、脚本非空），全绿才可发布
- 发布：`dotnet publish host/SoloChatHost.csproj -c Release -o dist`，产出单个 `dist/SoloChatHost.exe`
- 会话备份（`idb-backup/`）、开发日志、本机配置均被 `.gitignore` 排除

## 安全

已做安全加固（F1–F5）：日志不落消息原文与密钥（DEBUG 才有，含脱敏 + 1MB 滚动）、Release 无调试端口、无 PDB 泄露源路径、API Key 走 DPAPI 加密保险库、导出可选脱敏分享。

## 许可

MIT，见 [LICENSE](LICENSE)。

## 文档

- [docs/工程规范.md](docs/工程规范.md)
- [docs/审计-v0.4.md](docs/审计-v0.4.md)
- [docs/对标记录.md](docs/对标记录.md)
- [docs/扩展路线图.md](docs/扩展路线图.md)
- [docs/扩展书写规范.md](docs/扩展书写规范.md)
- [docs/变更记录.md](docs/变更记录.md)
