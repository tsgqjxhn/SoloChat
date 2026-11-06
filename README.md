# SoloChat

**v0.4.3 · 一个单 exe，双击就是完整的本地 AI 聊天客户端。**

没有安装器、没有前端构建、没有 npm、没有云端。界面、逻辑、图标、样式全部内联在一个 `index.html` 里；配上宿主壳后发布成**单个 exe（`SoloChatHost.exe`）**，托管 DLL、WebView2 加载器、页面统统嵌进这一个文件。拷到任何一台 Win10/11 机器，双击即用。

![首屏](screenshots/home.png)

## 当前能力

### 对话与会话

- **Chat / Work / Agent 三种模式**：Chat 纯对话；Work 在内存沙箱里写文件、跑脚本、预览；Agent 读写真实工作区，写入逐次确认。
- **会话分组**：侧栏「+ 分组」创建一组 Chat/Work 会话，不绑定文件夹；组可设模式、模型、System Prompt、temperature、max_tokens，组内未覆盖的会话动态继承，删除分组保留会话。
- **发送前调参**：输入区右侧 ⚙ 在第一条消息前也能打开「新会话（发送前）」，设置分组、模式、模型、提示词、温度与输出上限；请求按「会话 > 分组 > 全局」取生效模型。
- **Chat 选工具自动切 Work**：Chat 本身不执行工具；本轮勾了工具/插件时，发送前显式切到 Work 并提示，避免工具围栏没人执行。
- **流式与上下文**：SSE 流式渲染、中断/重试/继续、原地重新生成与多版本切换；上下文圆环实时估算，80% 自动压缩成 9 段摘要；网络瞬断自动重试一次。
- **提示词库**：设置页管理，输入 `/` 统一搜索所有扩展；提示词点选后直接插入正文。

### 扩展系统

- **六类内容**：智能体 / 插件 / 技能 / 工具 / 提示词 / MCP，统一走 `EXT.registry()`。
- **唯一 ID**：内置工具 `builtin:<name>`，用户条目 `tool:/skill:/agent:<name>`，提示词 `prompt:<name>`，插件 `plugin:<pkg>`，MCP `mcp:<name>`；同屏去重，旧内置工具选择自动迁移。
- **「/」统一搜索**：输入 `/` 保留符号并弹出面板，继续输入字母/中文按名称、类型、说明实时过滤全部扩展；内置工具带「内置工具」标签。选中后清空查询、收起面板，直接写问题。
- **扩展市场**：读 `ext/plugins` 分支的 `index.json`，按类型过滤并可整包安装；已安装的扩展/运行时不再出现在市场，统一进「已有」。
- **Python 3.11 运行时插件**：官方 CPython 3.11.9 portable + uv，安装到 `%LOCALAPPDATA%\OpenPage\runtimes`，不写 PATH、不改注册表；Agent 的 `python` 工具与需要前置的扩展使用它。当前是便携隔离，不是 OS 级安全沙箱。
- **本地导入/导出**：文件、文件夹、拖放、JSON；导出统一弹文件夹选择器，按类导出本地条目。

### 连接与工具

- **供应商目录**：223 家预设，点选自动填 Base URL、鉴权、wire 协议与字段怪癖。
- **四种 wire 协议**：`openai-chat` / `openai-responses` / `anthropic-messages` / `gemini`，与供应商正交。
- **原生 function calling**：Work / Agent 把 `tool_calls` 转成既有围栏执行链，工具白名单与开关照旧生效。
- **内置工具**：web / search / crawl / get / browser / python / 文件读写 / 沙箱 run 等；扩展工具只接受声明式 HTTP，不执行任意 JS。
- **联网搜索**：查询改写 → 13 个搜索源 → 前 N 条正文抓取 → 带引用注入。
- **文档与 OCR**：docx / xlsx / pptx / rtf 与带文本层 PDF 本地提取；扫描版可接 Mistral / Azure / Google / Amazon / Adobe / ABBYY / 百度 / 阿里 / 腾讯 OCR。
- **代理与安全**：默认直连，可填 HTTP 代理；密钥走宿主 DPAPI 保险库，日志不落消息原文。

## 快速开始

### 浏览器直接用

双击 `index.html`，在 **设置 → 连接与模型** 填任意 OpenAI 兼容接口：

| 字段 | 说明 |
|---|---|
| Base URL | 例 `https://api.deepseek.com/v1`；已含 `/v1`、`/v3` 原样用，否则自动补全；填 `mock` 进离线演示 |
| API Key | 仅存本机，不上传 |
| 模型 | 手动填或「获取列表」拉取 |

浏览器直连可能受 CORS 限制；受阻时用宿主方式。

### 单文件宿主（Windows，推荐）

需要 .NET SDK：

```powershell
dotnet publish host/SoloChatHost.csproj -c Release -o dist
```

产出单个 `dist/SoloChatHost.exe`（托管 DLL + WebView2Loader + index.html 全嵌入）。双击运行，获得 Alt+Space 全局呼出、文件 Agent、受限网络下的请求桥与运行时安装。

## 数据存储

| 内容 | 位置 |
|---|---|
| 会话 / 消息 / 提示词 / 扩展 | IndexedDB（库名 `ai-chat`） |
| 配置（Base URL / 模型 / 分组 / 主题等） | localStorage（键 `sc.cfg.v1`） |
| API Key / 搜索 Key / OCR Key | 宿主模式走 DPAPI 保险库；浏览器模式回退 localStorage（明文，启动时警告） |

数据按页面来源隔离；换浏览器、清数据或改路径会看不到旧数据。长期使用请在 **设置 → 关于 → 数据与维护 → 导出** 备份。

## 体积与资源

| 项目 | 当前值 |
|---|---|
| 发布产物 | `dist/SoloChatHost.exe` **3,163,648 字节**（v0.4.3，FileVersion 0.4.3.0），单文件，无散落 dll |
| 主源码 | `index.html` **1,025,562 字节 / 17,356 行**（CSS / JS / SVG 全内联） |
| 宿主源码 | `host/Program.cs` **172,099 字节 / 3,242 行** |
| 依赖 | Windows 10/11 自带的 .NET Framework 4.8 + WebView2 Runtime |

内存占用未在本版重新实测；历史机器数据已不再写入 README，避免把旧版本数字当当前结论。

## 项目结构

```
SoloChat/
├── index.html                        # 单文件客户端（唯一运行时）
├── host/
│   ├── Program.cs                    # WebView2 宿主（托盘 / 热键 / 桥 / 文件 / 运行时）
│   ├── SoloChatHost.csproj           # 单文件发布配置
│   └── app.ico
├── docs/                             # 工程规范、审计、对标、扩展规范、变更记录
├── tools/verify.mjs                  # 零依赖静态闸门（6 项）
├── plugins/                          # 本机运行时市场清单 + Python zip
├── dist/SoloChatHost.exe             # 发布产物
├── screenshots/                      # README 截图
├── LICENSE                           # MIT
└── .gitignore
```

扩展市场源码在 `ext/plugins` 分支（`index.json` + 扩展包 + `runtimes/python-311/`）；分类分支为 `ext/agents`、`ext/plugins`、`ext/skills`、`ext/tools`、`ext/prompts`。

## 开发与版本

- 主应用仍是单文件：`index.html` ≤ **1,048,576 字节** / ≤ 18,000 行，零外部依赖，ES5 / IIFE。
- 当前闸门：`node tools/verify.mjs`（内联脚本语法、字节数、行数、重复 id、版本一致、脚本非空）；发布前必须 6/6。
- **版本策略**：每次发布在末位 **+0.01**（例如 0.4.2 → 0.4.3）；**0.1 级版本未经用户允许不得变动**。
- 每次改完：`verify` → `dotnet build` → 重发布 `dist/SoloChatHost.exe` → **重启 exe**，确认新进程/窗口后再汇报。
- 扩展包不受单文件限制；写作与区分规范见 [docs/扩展书写规范.md](docs/扩展书写规范.md)。

## 安全

已做安全加固：日志不落消息原文与密钥（DEBUG 才输出且脱敏、1MB 滚动）；Release 无调试端口、无 PDB 泄露源路径；API Key 走 DPAPI 加密保险库；导出可选脱敏分享；扩展工具只允许声明式 HTTP，市场安装只取文本、不执行代码。

## 许可

MIT，见 [LICENSE](LICENSE)。

## 文档

- [docs/工程规范.md](docs/工程规范.md)
- [docs/扩展书写规范.md](docs/扩展书写规范.md)
- [docs/审计-v0.4.md](docs/审计-v0.4.md)
- [docs/对标记录.md](docs/对标记录.md)
- [docs/扩展路线图.md](docs/扩展路线图.md)
- [docs/变更记录.md](docs/变更记录.md)
