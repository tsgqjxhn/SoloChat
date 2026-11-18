# SoloChat

**v0.4.16 · 一个单 exe，双击就是完整的本地 AI 聊天客户端。**

没有安装器、没有 npm、没有云端。源码在 `src/`，`node tools/build.mjs` 把界面、逻辑、图标、样式内联回一个 `index.html`；配上宿主壳后发布成**单个 exe（`SoloChatHost.exe`）**，托管 DLL、WebView2 加载器、页面统统嵌进这一个文件。拷到任何一台 Win10/11 机器，双击即用。

主应用仓库保持极简；扩展包与 Python 运行时放在同级目录 **`../extensions/`**（独立 Git 仓库），发布前用 `node tools/sync-extensions.mjs` 同步到 `dist/plugins/` 与 `dist/packages/`。

![首屏（演示模式）](screenshots/home.png)

## 四种模式

| 模式 | 定位 | 适合做什么 |
|---|---|---|
| **Chat** | 纯对话 | 问答、写作、代码解释、公式、图片理解；不带文件/命令工具 |
| **Work** | 沙箱工作台 | 写页面、跑脚本、生成文件、预览产物；在内存 VFS 里工作，不碰真实目录 |
| **Agent** | 文件 Agent | 读写真实工作区、git / 命令 / Python、逐次确认后执行；适合改项目 |
| **Soul** | 长期人格 | 本地记忆、自动沉淀、技能进化、全部扩展可用；像人一样持续成长 |

模式切换条在四个模式中的中心坐标固定；切换模式、切换会话、新建会话时，Work 打开的「网页」侧边栏会自动收起，不会串到下一个会话。

### Plan / Write / Free

Work、Agent、Soul 的输入框内部最左侧有一个权限触发钮，点开**向上展开** Plan / Write / Free 三个选项；权限随会话保存：

- **Plan**：只读规划，只允许读文件/列目录/搜索/浏览器读取与智能体等扩展；写文件、补丁、cmd/git/python、crawl/download 会被拦截，并明确显示“未运行”。
- **Write**：全部扩展可用；普通文件写入直接应用，`cmd`、`git`、Python 每次执行前弹确认（可点击「运行」或按 Enter；Esc 取消）。
- **Free**：原名 Yolo，全部扩展与命令免确认，直接用；仍会报告退出码、失败和未验证项。

旧配置 `ask / auto / readonly / yolo` 会自动迁移到 `Write / Free / Plan`，不需要手动改。

### 模式设置 / 工具参数

设置里保留模式页，工具参数不再单独成页：

- **模式设置**：按 Chat / Work / Agent / Soul 四块配置上下文条数、上下文字符；Work 另有 VFS 文件数、总量、单文件和工具轮次上限；Agent / Soul 各有工具轮次。
- **工具参数**：到「扩展 → 工具」每张卡片右侧点齿轮，参数会在该卡片下方**就地展开**（crawl 页数、web/browser 正文上限、fs-read/write 上限、控制台、grep、子智能体暂存等）。改完立即生效，不需要重启。

基础模式条回到空态原位置（Chat / Work / Agent / Soul 固定居中，不再放入输入框）；输入框内部最左侧只放上拉式 Plan / Write / Free 权限选框。

Agent 没有 Work 的 VFS 文件/总量配额（它直接操作真实工作区），但有工具轮次、单文件读写上限、结果截断、diff 预览和工作区外写入确认；工具参数到「扩展 → 工具」卡片齿轮里改，宿主单文件硬上限提升到 4MB，页面侧默认仍是 256KB。

### 会话执行记录

同一轮的「思考 / 运行 / 编辑」会合并成一个默认收起的「执行记录」；工具结果按行缩略，原始输出再折叠，最终正文单独显示。历史空回复会显示「本轮没有返回正文内容」，不会再留空白块。

### 链接与浏览器

Chat 收到 URL 会自动切到 Work；Work/Agent/Soul 会自动打开上下文里的链接，并把最近 40 条用户消息中的链接和内置浏览器当前页交给模型；`browser-read` 不传 URL 读当前页，不需要用户重发链接。

### 沙箱容量

Work VFS 文件数上限 **5000**、总量 **200MB**；crawl 单次页数上限 **2000**。长篇小说、批量章节不会再卡在 200 个文件。

## 当前能力

### 对话与搜索

- **联网搜索**：设置里选提供商并填 Key / 地址后，打开输入区地球图标即强制检索；搜索结果以标题 + 链接 + 摘要注入当前轮，要求模型带引用回答。
- **配置组**：联网搜索与文档解析各自支持保存 / 新建 / 重命名 / 删除多组配置，和 LLM 供应商配置一样切换；当前组字段自动保存，Key 按组进入宿主保险库。
- **错误可见**：搜索提供商返回 402 / 额度不足 / HTTP 错误时，回答上方会显示真实原因，不再假装「没有工具」。
- **智能改写检索词**：可选；只负责把问题精简成检索词，不再跳过搜索。
- **Firecrawl 用户注意**：`HTTP 402 / insufficient_credits` 表示 Firecrawl 账号额度为 0，需要充值、等额度重置，或改用 Tavily / Brave / SerpApi / SearXNG / 自定义搜索。
- **教材式公式**：`$…$` / `$$…$$` 由内置 LaTeX → MathML 解析器排版，不联网、无第三方库。
- **富文本**：表格、任务列表、脚注、定义列表、9 种语言代码高亮。
- **流式与上下文**：SSE 流式渲染、中断/重试/继续、上下文圆环、超限自动压缩。
- **会话隔离**：模型、模式、工具/插件/技能勾选跟会话走；同一会话内保留，切走不串，新建会话清空。

### Soul 人格

- **脸**：头像 Emoji 或上传图片。
- **性格**：人格提示词，下一轮请求生效。
- **声音**：浏览器 Web Speech TTS；可选语音、语速、音高。
- **能力**：LLM、生图、生视频、联网、附件开关。
- **记忆**：本地 `%USERPROFILE%\SoloChat\memory`，支持自动记忆、巩固、搜索与回滚。
- **身体**：Agent 级文件/命令/浏览器能力，仍受应用原有安全确认约束。
- **进化**：每轮沉淀记忆，定期反思并新增/更新技能；有进化日志与手动 `/evolve`。

Soul 输入区保持极简：不显示附件、联网、生图等 SVG 图标；这些能力统一放在 **+更多** 或人格设置里。

### +更多

输入区 **+更多** 统一承载：

- 深度研究
- 生成图片
- 生成视频
- 语音输入 STT
- 语音合成 TTS

生图不再占用输入区独立按钮。

### 扩展系统

- **大文件管线**：文本附件完整保存在附件表，VFS 只存引用；Work/Plan 可用 `vfs-grep` / `vfs-read --offset` / `vfs-stat` 检索全文，不需要切 Free 或跑 Python。说明见 [`docs/大文件管线.md`](docs/大文件管线.md)。
- **工作区文件管理**：右侧工作区支持外部附件全文预览与下载、新建/编辑/删除文本文件；Agent 真实工作区可在面板内新建和编辑。大附件在面板中只读预览，避免用截断内容覆盖原附件。
- **外部扩展仓库**：扩展包与运行时在 `../extensions/`，不放进主应用 Git；新增扩展不需要修改主应用源码。
- **扩展配置规范**：智能体 / 插件 / 技能 / 工具 / MCP / 提示词统一用 `manifest.json` 的 `config` schema 声明 baseURL、API Key、模型 ID、轮数等字段；按规范写的字段会自动出现在扩展卡片齿轮里，填写后按 `{{key}}` 注入执行。完整格式与示例见 [`docs/扩展规范.md`](docs/扩展规范.md)。
- **六类内容**：智能体 / 插件 / 技能 / 工具 / 提示词 / MCP，统一走 `EXT.registry()`。
- **原生 function calling**：Work / Agent / Soul 可把工具 schema 交给支持 function calling 的模型；结果回到既有围栏执行链。
- **自定义工具**：声明式 HTTP，不执行任意 JS；可设置 URL / 方法 / headers / 字段。
- **扩展市场**：优先读取本地 `packages/index.json`（`node tools/sync-extensions.mjs` 生成，显示「本地扩展包市场」），本地缺失时回退远端 `ext/plugins` 分支；已安装项进入「已有」。
- **Python 3.11 运行时插件**：官方 CPython 3.11 portable；不写 PATH、不改注册表。

### 连接与数据

- **供应商**：内置供应商目录；支持 `openai-chat` / `openai-responses` / `anthropic-messages` / `gemini` 四种 wire 协议。
- **密钥**：宿主模式走 DPAPI 保险库；浏览器模式回退 localStorage（明文，启动时提示）。
- **数据**：会话 / 消息 / 扩展在 IndexedDB；配置在 `sc.cfg.v1`；截图问答只传文本，不写相册。
- **手机 ↔ 电脑配对**：桌面开启配对后，手机用 6 位码 + token 同步配置（含 API Key）与记忆文件；同一局域网明文传输。

## Android 版

`dist/SoloChat-Android-0.4.16.apk`（497,194 字节，versionCode 34；项目自有 keystore 签名）

- 悬浮球截屏提问、截图队列、半屏回答弹窗、Markdown 渲染、继续对话、分屏锁。
- 截图只在内存中，发送时 Base64 直传模型；不写相册、不经过中转服务器。
- 设置页、会话参数、配对同步、分享接收、WebDAV 自动同步、AES-GCM 加密。
- 构建、签名与限制见 `android/README.md`。

## 快速开始

### 浏览器直接打开

双击 `index.html`，在 **设置 → 连接与模型** 填任意 OpenAI 兼容接口：

| 字段 | 说明 |
|---|---|
| Base URL | 例 `https://api.deepseek.com/v1`；已含版本段则原样使用 |
| API Key | 仅存本机，不上传 |
| 模型 | 手动填写或「获取列表」 |

浏览器直连可能受 CORS 限制；受阻时使用宿主方式。

### Windows 单文件宿主

需要 .NET SDK：

```powershell
dotnet publish host/SoloChatHost.csproj -c Release -o dist
```

产出 `dist/SoloChatHost.exe`（托管 DLL + WebView2Loader + index.html 全嵌入）。双击运行，获得全局呼出、文件 Agent、请求桥与运行时安装。

### Android

```bash
cd android
gradle --offline --no-daemon assembleRelease
```

APK 输出到 `android/app/build/outputs/apk/release/app-release.apk`。

## 项目结构

```text
SoloChat/                    # 主应用仓库（极简）
├── src/                    # 源码：index.template.html + css/svg/js 分段
├── index.html              # 构建产物（单文件运行时；不手改）
├── host/                   # WebView2 宿主（Program.cs / csproj / app.ico）
├── android/                # 原生 Android 壳（WebView + 悬浮截图 + 分享 + WebDAV）
├── tools/                  # build.mjs / verify.mjs / build-android.mjs / sync-extensions.mjs
├── docs/                   # 工程规范、扩展规范、变更记录、历史设计
├── screenshots/            # README 截图
├── dist/                   # 发布产物：exe + 当前 APK
└── LICENSE                 # MIT

../extensions/              # 独立扩展仓库（同级目录）
├── plugins/                # 运行时插件 + market.json
├── packages/               # 扩展包：一个文件夹一个包
│   ├── _template/          # 新建扩展从这里复制
│   └── 示例扩展包/
└── README.md
```

扩展市场源码在 `ext/plugins` 分支；分类分支为 `ext/agents`、`ext/plugins`、`ext/skills`、`ext/tools`、`ext/prompts`。本地扩展目录的 Git 配置见 `../extensions/README.md`。

## 构建与验证

```bash
node tools/build.mjs          # src/ → index.html
node tools/build.mjs --check  # 构建新鲜度
node tools/verify.mjs         # 7 项静态闸门：语法/字节/行数/重复 id/版本/非空/新鲜度
node tools/sync-extensions.mjs # ../extensions/plugins → dist/plugins；packages → dist/packages + 本地市场索引
node tools/build-android.mjs  # 注入 Android assets
```

发布前要求：构建通过、`verify 7/7`、宿主发布、exe 重启、Android APK 版本核对。

## 版本与发布

- 当前版本 **v0.4.16**；桌面 `APP_VER` / FileVersion **0.4.16.0**；Android `versionCode 34`。
- 版本策略：每次发布末位 **+0.0.1**；未经明确同意不增加 0.1 级版本。
- 扩展仓库与主应用仓库分开提交；主应用发布前同步 `dist/plugins/` 与 `dist/packages/`。
- GitHub：[`tsgqjxhn/SoloChat`](https://github.com/tsgqjxhn/SoloChat)
- GitHub Releases：[`v0.4.0` 历史归档](https://github.com/tsgqjxhn/SoloChat/releases/tag/v0.4.0)；最新代码/tag 以仓库当前 `main` 为准。

## 体积与资源

| 项目 | 当前值 |
|---|---|
| 桌面 exe | `dist/SoloChatHost.exe` **3,595,264 字节**（v0.4.16，FileVersion 0.4.16.0），单文件 |
| 主产物 | `index.html` **1,412,417 字节 / 23,946 行** |
| 源码 | `src/` **19 个文件 / 1,412,489 字节** |
| 宿主源码 | `host/Program.cs` **205,349 字节 / 3,854 行** |
| Android APK | `dist/SoloChat-Android-0.4.16.apk` **497,194 字节**（versionCode 34） |

## 数据存储

| 内容 | 位置 |
|---|---|
| 会话 / 消息 / 提示词 / 扩展 | IndexedDB（库名 `ai-chat`） |
| 配置（Base URL / 模型 / 分组 / 主题等） | localStorage（键 `sc.cfg.v1`） |
| API Key / 搜索 Key / OCR Key | 宿主模式走 DPAPI 保险库；浏览器模式回退 localStorage |
| Soul 记忆 | `%USERPROFILE%\SoloChat\memory\{USER,MEMORY,DREAMS}.md` |

换浏览器、清数据或改路径会看不到旧数据；长期使用请在 **设置 → 关于 → 数据与维护 → 导出** 备份。

## 安全

- Release 宿主无调试端口、无 PDB 源路径。
- API Key / 搜索 Key / OCR Key 走 DPAPI 保险库；日志不落密钥。
- 扩展工具只允许声明式 HTTP，市场安装只取文本，不执行代码。
- 扩展、技能、提示词不会覆盖内置安全校验；危险命令仍需确认。

## 文档

- [工程规范](docs/工程规范.md)
- [扩展书写规范](docs/扩展书写规范.md)
- [变更记录](docs/变更记录.md)
- [移动端与悬浮截图评估](docs/移动端与悬浮截图-评估.md)

## 许可

MIT，见 [LICENSE](LICENSE)。
