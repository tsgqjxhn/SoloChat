# SoloChat · Work 模式 / 虚拟沙箱 / 下载 / 本地零遗留 设计文档

版本：1.0｜日期：2026-10-30｜状态：**已实施（当前应用版本 v0.2.0）**

---

## 0. 四条硬性要求（来自需求方）

1. **始终保持单文件**：`index.html ≤ 1MB 且 ≤ 12000 行`（现状 306 KB / 5883 行，余量充足）。
2. **支持下载**：沙箱产出的单文件可下载；整个工作区（虚拟或真实）可打包为一个 zip 下载。
3. **虚拟轻量沙箱**：纯本地（WebView2 页内），**无服务端、无本地临时目录**——不写 `%TEMP%`、不落磁盘中间产物。
4. **三模式会话删除零遗留**：Chat / Work / Agent 会话从左侧边栏删除后，应用自有的本地数据全部删除，不留残余。

> 设计基调：**Work 的一切都在页内内存/IndexedDB 完成**；只有 Agent 模式本来就会触碰的真实用户工作区文件才涉及宿主（且是用户文件，不属于"遗留"）。

---

## 1. 模式体系：`fileOps` 布尔 → `mode` 三态枚举

### 1.1 三模式定位

| | Chat | **Work（新增）** | Agent |
|---|---|---|---|
| 用途 | 纯对话 | **沙箱内短任务**（生成/运行/自检/交付代码页面） | 真实工作区文件读写 |
| 文件系统 | 无 | **虚拟工作区（内存 + IndexedDB，不碰磁盘）** | 授权真实文件夹（宿主 fs 桥） |
| 执行环境 | 无 | 页内沙箱 iframe + C 解释器 | 不执行，只读写文件 |
| 需要选文件夹 | 否 | **否** | 是 |
| 工具协议 | 无 | `run` / `vfs-*` 围栏 | `fs-*` 围栏（现状不动） |

### 1.2 现状与迁移

- 现状：`S.cfg.fileOps`（布尔，`index.html:673`）隐含两态，**约 20 处引用**散落在：模式切换（5365）、系统提示注入（1147）、回合钩子（5727）、mock（1404）、输入区控件（4840/4914）、空态（4309）、快速条状态（3410/3389/3399）、设置镜像等。
- 目标：`S.cfg.mode ∈ {'chat','work','agent'}`。
- **迁移策略**：`loadCfg` 一次性转换 `fileOps:true→'agent' / false→'chat'`，保存后删除旧键；此后全部判断改读 `mode`。**不保留双轨**，避免两套真值源。
- 逐点改法速查：

| 引用类 | 改法 |
|---|---|
| `fileOps` = Agent 含义（协议注入、fs 围栏处理、空态选夹提示） | `mode === 'agent'` |
| `fileOps` = "非 Chat" 含义（如有） | `mode !== 'chat'`（逐一核对，禁止机械替换） |
| `quick.state` / `quick.cmd`（宿主小窗） | 协议加 `mode` 字段；**小窗按钮仅切 chat/agent**（Work 只在主窗切换——见 §6 决策点 D3） |
| 模式分段按钮 `#seg-mode` | 2 按钮 → 3 按钮（chat/work/agent），选 work **不弹**文件夹选择框 |

### 1.3 切到 Work 时的行为

- toast：`Work 模式：沙箱内运行短任务，产出可下载，不写本地磁盘`；
- 系统提示注入 `WORK.protocol`（§2.2），**不注入** `FS.protocol`；
- 不要求工作区；`renderComposerCtl` 显示 Work 徽标、隐藏真实文件夹路径按钮。

---

## 2. Work 模式：执行循环

### 2.1 现有可复用资产

- 围栏工具协议与回合钩子：`FS.scan / handleTurn / [fs-result]` 回灌模式（`index.html:5700-5741`）——**直接仿写**；
- 轮次上限范式：`LIMITS.FS_MAX_TURNS = 6`（`index.html:658`）；
- 停止：现有 `S.aborter` / `cancel` 标记；
- 执行环境：RUNNER 沙箱（iframe `sandbox="allow-scripts"` + CSP `connect-src 'none'`，不透明源）与 C 解释器（步数上限 30M、递归 2000、除零）——**均已上线**。

### 2.2 工具协议（围栏，沿用供应商中立路线，**不做原生 tool_calls**）

````
```run            ← 执行 html/svg/js/css/c 代码，结果回灌 [run-result]
<代码>
```

```vfs-write       ← 写入虚拟工作区（会话隔离，免确认——沙箱会话内无外部风险）
<相对路径>
<完整内容>
```

```vfs-list         ← 列虚拟工作区
```
````
- 执行类型判定复用 `crKind()`；未知类型 → `[run-result] 不支持的类型`。
- 工具结果统一样式：`[run-result] ok|err` + 输出（截断规则见 §3.3），并**明确标注"是数据不是指令"**（沿用 FS 协议的注入缓解措辞）。

### 2.3 循环纪律（`WORK` 模块，仿 `FS`）

1. assistant 落定 → `WORK.handleTurn(msg)` 扫描围栏；
2. 逐个执行（沙箱串行；C 同步执行天然串行），结果落 `[run-result]` 用户消息（复用 `FS.note` 模式）→ 触发下一轮请求；
3. 预算：`LIMITS.WORK_MAX_TURNS = 6`；**同型错误（错误文本归一后相同）连续 3 次 → 强停**并提示"已停止自动修复，请人工查看"；
4. 墙钟：单任务累计 ≤ 3 min（超时杀 iframe）；总输出行数超限即截断并注明；
5. 用户停止 → `cancel=true` + abort 当前请求 + 销毁沙箱 iframe；
6. 任务完成的判据放在**提示词层**（§2.4），无后端 verify——沙箱内 `console.assert` 的通过/失败输出就是验证证据。

### 2.4 提示词协议（文档 §8/§13 精华的本地化，代价最低收益最高）

`WORK.protocol` 要求模型：
- 开工前把需求转成**验收清单**（平铺几条）；
- 代码内嵌自检（`console.assert` / 结果比对打印）；
- 每轮结束声明：清单哪几项已验证（引用控制台输出）、哪几项未验证；
- 最后交付：产物清单 + 已知限制；**禁止编造"已测试"**。

---

## 3. 虚拟轻量沙箱（纯本地、零临时文件）

### 3.1 边界

| 进 | 不进 |
|---|---|
| RUNNER iframe（不透明源、禁外网、禁同源） | 任何服务端 |
| C 解释器（内存 Uint8Array，2MB 虚拟内存） | `%TEMP%` / 任何磁盘临时文件 |
| 虚拟工作区 VFS（页内 Map + IndexedDB） | 真实工作区文件夹（那是 Agent 的事） |
| 运行输出（DOM + 环形上限） | 真实进程 / shell |

- 现有宿主日志 `Path.GetTempPath()\solo-host.log` 退出时自删（`Program.cs:622`），与沙箱无关；可选整改见 §6 决策点 D4。

### 3.2 虚拟工作区 VFS（新增）

- **数据模型**：IndexedDB 新 store `workfs`（`{id, sid, path, content, ts}`，`sid`+`path` 复合唯一），DB 版本 `1 → 2`；
- **隔离**：按会话隔离，读写都带 `sid`；路径规范化（`/` 统一、禁 `..`、禁绝对路径）——与 fs 桥同款纪律，只是全在页内；
- **配额**：单文件 ≤ 1 MB、单会话总量 ≤ 20 MB、文件数 ≤ 200；超限报错不静默；
- **不落磁盘**：IndexedDB 是浏览器私有库（应用数据，非"临时目录"）；重启可恢复，删除会话即删（§5）。

### 3.3 沙箱加固（新增小项）

- **超时强杀**：iframe 无 onbeforeunload 钩子，用"移除节点 + 重建空 iframe"实现终止；C 已有步数上限；
- **输出防护**：控制台行数 ≤ 500、单行 ≤ 1000 字符、总字符 ≤ 64 KB，超出截断并加 `…（已截断）`；回灌给模型的 `run-result` 同样截断（防 token 爆炸，文档 §5.3）；
- **postMessage 校验**：现有 `{__scrun:1}` 之外增加 `nonce`（每次 run 生成，不匹配丢弃），防残留 iframe 串台。

---

## 4. 下载能力

### 4.1 单文件下载（沙箱/虚拟工作区产出）

- 机制：`Blob → URL.createObjectURL → a[download]`（与现有"导出 JSON"完全同款，`index.html:4784`，**已有先例**）；
- 入口：① RUNNER 面板"下载产物"按钮；② 虚拟工作区文件列表每项的下载按钮；③ 消息内 vfs 卡片下载；
- **需实测项**：WebView2 内 `a[download]` 的落点（默认"下载"文件夹）。宿主当前未订阅 `DownloadStarting`，默认行为应直接落 Downloads；若实测被吞或落临时位置 → 备选方案：宿主订阅 `DownloadStarting` 改跳 `SaveFileDialog`（一次性约 30 行 C#）。

### 4.2 虚拟工作区打包下载（页内 ZIP，零依赖）

- 页内手写 ZIP（STORE 不压缩 + CRC32 查表，约 90 行）→ 单 Blob 下载为 `<会话标题或文件夹名>.zip`；
- 无临时文件：**全程内存**，ZIP 字节直接进 Blob；
- 结构：`<root>/<vfs 相对路径>…`；空工作区提示"无文件"。

### 4.3 ~~真实工作区打包下载~~（已废弃，见下方说明）

> **v2.1 变更**：Agent 模式本就在真实文件夹上原位读写、即时同步，打包下载属多余出口，已连同宿主 `zipws` 一并移除（保留下文仅作设计记录）。

- 宿主新增 fs 桥操作 `zipws`：
  - 复用 `NormalizeRoot` 白名单 + 符号链接拒绝（`Program.cs:872-881`）；
  - `ZipArchive` 写 `MemoryStream`（**不落临时文件**）→ `SaveFileDialog` 选路径 → 一次写盘 → 回 `fs.done {path, size}`；
  - 单文件读取 256KB 限制**不适用**于 zip（宿主直接读流）；总量上限 500 MB，超出拒绝并说明；
- 页内入口：Agent 会话工具条"下载整个工作区"按钮（有真实工作区时显示）。

---

## 5. 删除零遗留（重点审计）

### 5.1 数据清单与整改

| # | 数据 | 位置 | 现删除现状 | 整改 |
|---|---|---|---|---|
| 1 | 会话记录 | IDB `sessions` | ✅ `delSessionDeep` 直删 | 不动 |
| 2 | 消息 | IDB `messages`（`sid` 索引游标删） | ✅ | 不动 |
| 3 | 图片/文件附件 | IDB `attachments`（按 `sid` 游标删） | ✅ | 不动 |
| 4 | 草稿 | 内存 `S.drafts[sid]` | ✅ 已 delete | 不动 |
| 5 | 图片预览 blob URL | 内存 `S.previewUrls` | ✅ 切换会话时 revoke | 删除路径确认也走 `selectSession`（若当前会话被删，`deleteSession` → `selectSession` 即触发） |
| 6 | **虚拟工作区** | IDB `workfs`（新增） | — | **加入 `delSessionDeep` 同事务**（§5.2） |
| 7 | **沙箱运行态** | 内存 RUNNER（cur/srcdoc/输出） | — | 删除当前会话时 `RUNNER.reset()`：清 srcdoc、清输出、`cur=null` |
| 8 | 快速条问答标记 | 内存 `qa` / `quickPending` | 指向已删 sid 的标记 | 删除 sid 命中时清 `qa` |
| 9 | 未发送附件 `S.pendAtts` | 内存（输入区暂存） | 属输入区草稿，非会话数据 | **会话级不删**（用户还能发）；"清空全部数据"时清 |
| 10 | `localStorage sc.rn.w / sc.rn.cc` | 全局 UI 偏好（面板宽/收合） | 非会话级 | 不随会话删 |
| 11 | 项目级 `pinnedWs / wsClosed` | `S.cfg` | ✅ 仅 `deleteProject` 清 | 语义即项目级，会话删除不动（无遗留——项目删时会清） |
| 12 | 真实工作区文件 | 用户磁盘 | **不删（策略）** | 会话删除**不碰**用户文件，文档与 toast 明示"聊天记录已删，工作区文件夹保留" |
| 13 | 宿主侧 | — | ✅ 无 per-session 文件（Work 全页内） | 无遗留来源 |
| 14 | 导出/下载的 zip/json | 用户"下载"文件夹 | 用户主动保存的交付物 | 不删（非应用遗留） |
| 15 | IDB 文件物理收缩 | 浏览器管理 | 删除后条目无、文件可能不缩 | **如实说明**：不承诺物理空间归还，属浏览器行为 |

### 5.2 `delSessionDeep` 扩展（核心改动，一处）

```
tx(['sessions','messages','attachments','workfs'], 'readwrite', ...)
  ├─ sessions.delete(sid)            （现状）
  ├─ messages 游标 sid 匹配删        （现状）
  ├─ attachments 游标 sid 匹配删     （现状）
  └─ workfs 游标 sid 匹配删          （新增）
```
调用方（`deleteSession` / `deleteProject` / 批量删）**无需逐个改**，事务内一并完成。

### 5.3 "清空全部数据"（`index.html:5493`）同步扩展

- IDB：三 store → 四 store 全清（`workfs` 加入）；
- 内存：`S.pendAtts`、`RUNNER.reset()`、`S.previewUrls` 全 revoke；
- localStorage：保留 UI 偏好（主题/快捷键/面板宽），仅清会话类（草稿无 localStorage）；`pinnedWs/wsClosed` 清空。

### 5.4 验收方法（"确保能删除"必须可验证）

1. **浏览器模式回归脚本**：起本地 `srv.cjs`，脚本建 3 个会话（分别 chat/work/agent 数据形态：消息+附件+workfs 条目）→ 逐个删除 → 遍历四个 store 按 `sid` 计数断言全 0、`sessions.get(sid)` 为 undefined；
2. **"清空全部"断言**：四 store `count()===0`；
3. **重启复验**：删后刷新页面再次断言（排除"仅内存移除"假象）；
4. **宿主内抽查**：删除 work 会话后确认 IndexedDB 无 `workfs` 残条（DevTools 或加临时 bridge 审计口）。

---

## 6. 工期与阶段（在上轮 3.5~5 天评估上增补）

| 阶段 | 内容 | 估时 |
|---|---|---|
| A | `mode` 三态枚举改造 + 三按钮 UI + 迁移/回归 | 0.5~1 天 |
| B | `WORK` 模块（协议、循环、预算、回灌）+ 提示词 | 1~1.5 天 |
| C | VFS（store v2 + 配额 + vfs 围栏） | 0.5~1 天 |
| D | 沙箱加固（强杀/截断/nonce）+ RUNNER 结果回调 | 0.5~1 天 |
| E | 下载：单文件 + 页内 ZIP +（宿主 `zipws` 真实工作区打包） | 0.75~1.25 天 |
| F | 删除零遗留：`delSessionDeep` 扩展 + 清空扩展 + RUNNER.reset + 验收脚本 | 0.5~1 天 |
| G | 全链路回归（三模式互切/删除/重启/导出导入兼容） | 0.5~1 天 |
| **合计** | | **约 4.5~7.5 天** |

体积预估：新增约 18~26 KB → 最终 ≈ 330 KB / ≈ 6100 行，**红线内**。

### 决策点（开工前需确认）

- **D1** 虚拟工作区**持久化**（IndexedDB，推荐——可重启后下载/续跑）还是纯内存（零 IDB 改动但重启即失）？本文按持久化设计。
- **D2** 真实工作区打包放在 Work 首版，还是二期？（`zipws` 是唯一动宿主的项）
- **D3** 快速条小窗是否需要 Work 按钮（涉及宿主小窗 UI 改动）？本文默认**不需要**。
- **D4** 宿主日志从 `%TEMP%` 迁到 `LocalAppData\OpenPage\logs`？（严格零临时文件口径下可顺手做，~20 分钟）

### 风险

- **枚举改造遗漏**：`fileOps` 约 20 处，机械替换易错——逐点核对语义表（§1.2），改完全量 `grep fileOps` 必须归零；
- **删除遗漏**：靠 §5.4 脚本兜底，不靠人眼；
- **提示词调优不确定**：B 阶段的"验收清单/自检"质量依赖模型，需多模型实测；
- **WebView2 下载行为**：`a[download]` 落点需实测，备选方案已列（§4.1）。

---

*本方案遵守单文件红线、无服务端、无本地临时目录三项约束；Agent 模式现有 fs 协议与真实工作区行为不回退。*

---

## 7. 实施状态（v2.0 已落地）

> 落地版本：index.html 331,484 B / 6,249 行（红线 1MB / 12000 行内）；宿主 exe 2,421,248 B。
> 浏览器官网服务端到端已验证；宿主改动仅剩「日志迁出 %TEMP%」一项（D4）。
>
> **v2.1 追加**（渲染与入口收敛）：① 轻量 LaTeX 子集渲染（`\[ \]`/`$$`/`\( \)`/`$...$`，含 `\frac`/上下标/常用符号，零依赖）；② 流式增量 Markdown 渲染（原「流式纯文本 + 结束才渲染」改为节流 ~8fps 边流边渲染，超长退化）；③ 下载入口从顶栏收敛进右侧「运行」面板「工作区」区。

| 阶段 | 状态 | 落地内容 |
|---|---|---|
| A 三态枚举 | ✅ | `DEF_CFG.mode` + `loadCfg` 一次性迁移（`fileOps→mode`，迁完删键）；17 处引用全改；`fileOps` 仅剩迁移 3 行 |
| B WORK 循环 | ✅ | `WORK` 模块（协议 / ` ```run `·` ```vfs-write `·` ```vfs-list ` 围栏扫描 / 串行执行 / `[run-result]` 回灌 / 6 轮 + 同型错误 3 次强停 + 3 分钟墙钟）；两处回合钩子并挂；mock 演示 run→vfs-write 全链 |
| C VFS | ✅ | IDB `workfs`（DB v2，`sid` 索引）；配额（1MB/文件、20MB/会话、200 个）；路径规范化禁 `..`/绝对路径；导出/导入/清空均带 workfs |
| D 沙箱加固 | ✅ | RUNNER `runCapture`（Promise 结构化结果 + 空闲 350ms 判定完成 + 20s 超时物理拆 iframe + 输出行/字符截断）；postMessage `nonce` 防串台（同 tab 双 iframe 已验证不串） |
| E 下载 | ✅ | **v2.1 起全部收敛到右侧「运行」面板的「工作区」区**（`#rn-ws`：文件列表 + 单项下载 + 打包 zip，随面板展开/收起，状态存 `sc.rn.ws`）；运行面板 `#rn-dl` 下载产物（.html/.js/…）；页内 ZIP（STORE+CRC32，全程内存）。**顶栏不再有下载按钮**。Agent 走真实文件夹实时同步，故不提供打包（原 `zipws` 已从页面与宿主一并移除） |
| F 删除零遗留 | ✅ | `delSessionDeep` 四 store 同事务；删当前会话时 `RUNNER.reset()` + 清 `qa`；清空全部扩展为四 store 全清 + 内存复位 |
| G 回归 | ✅ | 三模式互切；Work mock 全链；VFS 面板/单文件/整包下载；导出 JSON 含 workfs；删除与清空的四 store 断言 + 刷新复验；零控制台错误 |

**验收证据（浏览器端到端）**：① 三形态会话经侧栏真实删除 → 四 store 按 sid 计数全 0，刷新后仍 0；② `清空全部数据` → 四 store `count()===0`；③ Work 循环产出 `[run-result] js 成功（429ms）`、`[vfs] 已写入 index.html`；④ 整包 zip 落盘 153 B，`Expand-Archive` 解出 `workspace/index.html`；⑤ 导出 JSON `v=2` 且 `workfs` 含文件。

**v2.1 验收证据**：① 流式期间 `.msg-body` 已是 HTML（边流边长，非结束才渲染）；② 真实消息里 `\[9.8^\circ C/km\]` → `.math-blk` 显示 `9.8° C/km`，`\rightarrow` → `→`，`E=mc^2` → `E = mc²`，无 `\[`/`\circ` 残留；③ 运行面板「工作区」区列出 `index.html`/`out.txt`，单项下载 8 B，打包 zip 271 B 且解出 `workspace/index.html` 与 `workspace/out.txt`。

**待真人自测**：`a[download]` 在 WebView2 内的落点（默认应进「下载」文件夹）。

---

## 8. v2.2 增量（2026-10-30）

| # | 项 | 改动 |
|---|---|---|
| 1 | 设置图标全局统一 | `#i-gear` 与 `#i-gear2` 统一为指定图标（`viewBox 0 0 1084 1024`，`fill:currentColor`）；侧栏「设置」、会话参数、空态「配置 API」三处一并生效 |
| 2 | 主窗滚动不再"拽人" | `endStream` / `renderMsgs` / `regen-continue` / 联网状态 由 `maybeScroll(true)` 改为 `maybeScroll(false)`（尊重 `S.follow`）；切会话、新建草稿、用户主动发送时显式 `S.follow = true`（仍会跳到最新） |
| 3 | 小窗（Alt+Space）实时流式 | 推送节流 250ms → 150ms；推送文本 `quickText()`：剥工具围栏 + **未闭合 ``` 临时补闭**，避免小窗 RTF 把后半段整体当代码 |
| 4 | 小窗滚动不被打扰 | 宿主 `PaintAnswer()` 重设 RTF 前记录「是否贴底 + 用户视口首字符」，重设后仅贴底才跟随，否则还原原视口（`AnswerAtBottom()`） |

| 5 | 上下文环口径简化 | 只保留一个分数「占用 / 上限」；占用 = 最近一次请求的 **prompt + completion**（输入含缓存命中，输出下轮并入，全部计入不遗漏）；移除 v1.9「会话累计」徽标与多余行 |

**验收**：主窗长会话流式中上翻 → 流结束 `scrollTop` 仍为 0（`d>40`），未上翻则跟随到底、切会话跳底；零控制台错误；exe 内新图标路径出现 2 次、旧图标路径已消失；上下文环 mock 一轮后显示 `153/131072`（128 输入 + 25 输出），提示仅一行，`ctx-sum`/「会话累计」/「官网口径」字样全部消失。

---

## 9. v2.3 增量（2026-10-31）

### 9.1 生成"后台继续"，不再切走即停

| 项 | 改动 |
|---|---|
| 流按会话存 | 新增 `S.streams[sid]`；`S.sending` 语义收窄为「**当前显示的会话**是否在生成」。切会话/新建草稿**不再 `stopGeneration()`** |
| DOM 隔离 | `streamFrame(st)` 仅当 `st.sid === S.sid` 才渲染；切回时 `attachStreamView()` + `bindStreamDOM()` 重新绑定节点 |
| 在飞消息可见 | 切回会话时把未落库的在飞消息补进视图；`streamDelta` 同步 `msg.content`，重渲染/切回不会丢半截文本 |
| 后台会话落库 | `endStream(st)` 按 `st.msg.sid` 落库；`touchSession(titleFrom, sid)` 支持指定会话（条数从库回填） |
| 工具循环按会话 | FS/WORK 的 `turns/cancel` 改为 `stMap[sid]`；`note(content, sid)`、`startStreamFor(sid)` 让 Agent/Work 循环在后台会话继续推进 |
| 停止语义 | `stopGeneration(sid)` / Esc 只停**当前显示**会话；两个会话可同时生成 |
| 删除不复活 | 新增 `killStreams(sids)`（删除会话/项目、清空全部时打 `dead` 标记并 abort）；`endStream` 见 `dead` 直接丢弃 |
| 退后台更稳 | 页面新增 `busy` 信令（有流在跑即发），宿主 `SetMemTarget` 期间强制 Normal，**不把 WebView 压进低内存/挂起** |

**验收**：切走后后台流跑完并落库；切回能看到完整回答；两会话并发同时生成；Esc 只停当前；删除流式中的会话 → 0 条残留、不复活；Agent/Work mock 循环无回归；零控制台错误。

### 9.2 回答内嵌图片/视频（方案 A：直连）

| 项 | 改动 |
|---|---|
| CSP | `img-src data: blob: https:`、新增 `media-src data: blob: https:`（宿主为 https 源，http 图必被混合内容拦截，故不放行 http） |
| MD | `![说明](https://…)` → `<img>`；`.mp4/.webm/.mov/…` → `<video controls preload="metadata" playsinline>`；独占一行的裸图/视频直链同样内嵌；整块包在 `<a target="_blank">` 里，点击在系统浏览器打开原图/原视频 |
| 尺寸 | **默认按正文字宽的 50% 显示**（`max-width:50%`，高度同比缩放）；小于半宽的图保持原始尺寸、不放大模糊；`max-height:420px` 兜住超高图/长视频 |
| 省流量/少泄露 | `loading="lazy"`、`referrerpolicy="no-referrer"`；`alt` 作说明行 |
| 提示词 | 新增 `MEDIA_HINT` 常量，`buildBody` 每次请求附注："展示图片用 `![说明](直链)`…链接必须真实存在，不要编造" |

**验收**：MD 产物断言 img×3/video×1/锚点×4、lazy+no-referrer+preload 均在；真实浏览器插入 https 图 → `naturalWidth=800` 且**无 CSP 拒绝错误**；真实消息里 `![]()` 图 800px 加载成功、裸链图 800px 加载成功、视频元素与 src 正确、普通 `[链接]` 仍为普通链接。

### 9.3 已知取舍（方案 A 直连）

图片/视频由 WebView2 **直接向目标 URL 发起请求**（不走 AI 供应商代理）：代价是目标服务器可见本机 IP 与 Referer（已用 `no-referrer` 降为无 Referer）；收益是零中转、零供应商流量费、无跨域代理失败。若在意隐私，可切换方案 B（点按加载 + 宿主 http 桥取字节，走代理、不自动触网）——当前未实现。

## 10. v2.4 增量：报错可见化 + 流式健壮性 + 滚动卡顿治理（2026-10-31）

### 10.1 「发生未预期错误」排查

在浏览器端跑了 10 组场景（长会话滚动 / 流式中滚动 / 流式中切走再切回 / 两会话并发 / Esc / 删除生成中的会话 / 加载更早 / 重新生成·继续生成·重试 / Agent+Work 循环 / 图片消息滚动）**均未复现**。据此按代码风险点整改：

| 项 | 改动 |
|---|---|
| 错误不可见（根因） | 原处理器只弹一句「发生未预期错误」，**消息与堆栈全丢**，无法定位 → 现在 toast 带原因+文件:行，并 `console.error` 打完整堆栈 |
| 未处理的 Promise 拒绝被完全吞掉 | `unhandledrejection` 原来只 `preventDefault()` → 现在额外 `console.warn` |
| **宿主推送处理器未加保护（最可能的真因，仅宿主环境触发）** | `bridge._dispatch` 任一处理器抛错会冒泡成未捕获错误（正好表现为该 toast）→ 整体包 `try/catch` + 记日志，且不再打断消息循环 |
| 流式渲染兜底 | `streamFrame` 补 `st.node` 判空/挂载判断；节点找不到时安全退出（原来可能 `null.querySelector` 抛错） |
| 同类隐患 | `inPlaceStream` 的 `$listNode(...)` 未判空（消息不在渲染窗口时抛错）→ 补判空并回退整列表渲染 |
| 僵尸会话 | `touchSession` 后台条数回填期间会话被删 → 不再写回 |

### 10.2 滚动卡顿治理

| 项 | 原因 | 改动 |
|---|---|---|
| 工具循环每次都整列表重建 | `FS/WORK.note` 与 `markDone` 调 `renderMsgs()` 重建全部节点 → **每张图重新加载、整页重排** | 新增 `appendMsgNode()` / `repaintMsg()`：只追加一条、只重建一条 |
| 流式期反复重造 `<img>/<video>` | 每 120ms 重渲染 MD → 图片重复请求 + 布局抖动 | 流式期 `MD.render(..., {noMedia:true})` 先按链接显示，**收尾时全量渲染**出图/视频 |
| 每帧多余查询 + 空转重排 | 每帧 `querySelector('.skel')`、无变化也写 DOM/读 scrollHeight | 骨架屏引用只取一次并在首帧移除；`lastLen` 判重，无变化不写 DOM、不滚动 |
| 昂贵选择器 | `.md p:has(> a.md-media:only-child)` 在长消息上每次样式重算都要跑 | 移除 |

**验收**：切走再切回后台流 → 文本继续增长（99→101 字符，验证 flush 恢复）；脚本化滚动 2s 内 98 帧（≈49fps）；图片消息 2 图（均 800px 加载）+1 视频，零错误。

## 11. v2.5 增量：Work 内置侧边栏浏览器（VFS 预览）（2026-10-31）

### 11.1 功能

右侧「运行」面板的工作区文件现在可**直接预览**，不再只能下载：

| 文件类型 | 按钮 | 行为 |
|---|---|---|
| `.html` / `.htm` | 预览 | 沙箱 iframe 渲染；**相对引用的 css/js 自动从 VFS 内联**（外链原样保留） |
| `.svg` | 预览 | 直接渲染（深色底居中） |
| `.md` / `.markdown` | 预览 | 页内 Markdown 渲染（深色样式） |
| 其余文本（js/css/json/txt…） | 查看 | 源码视图（`#rn-src`，等宽字体） |

预览工具条（`#rn-pvbar`）：**后退 / 前进 / 当前路径（悬停显示大小）/ 刷新 / 关闭**。当前预览的文件在工作区列表中高亮（`.pv-on`）。

### 11.2 多页跳转

预览文档注入导航桥（`PVNAV`）：拦截页内**相对链接**点击 → `postMessage` 回主窗 → 按当前文件目录解析成 VFS 路径 → `previewTo` 换页并压入历史（上限 50 条）。绝对路径/`..` 逃逸被 `pvResolve` 拒绝；**外链（http/https）一律拦截**并 toast 提示（沙箱不外联）。

### 11.3 自动刷新（Live Reload）

Work 循环 `vfs-write` 成功后调用 `RUNNER.previewRefreshIf(sid, path)`：若正在预览该文件，250ms 防抖后重渲染。**沙箱执行期间（`cap` 未完成）不抢 iframe**，`capFinish` 恢复预览。实测 Work mock 循环（run → [run-result] → vfs-write index.html）≈2.5s 内自动刷新。

### 11.4 安全与零遗留

- 复用沙箱 iframe（`sandbox="allow-scripts"`，不透明源，碰不到主窗 DOM/storage/宿主桥）。
- 预览文档内联 CSP（`PV_CSP`）：`connect-src 'none'`（禁一切 fetch/XHR）、`frame-src 'none'`、`form-action 'none'`、`base-uri 'none'`；仅 `img/media` 放行 `https:`（与主窗方案 A 一致）。
- console 桥复用（`BRIDGE`+nonce）：预览页的 console 输出照常进运行面板控制台。
- 手动 ▶ 运行代码块 → 自动退出预览（避免工具条与画面不符）。
- 切会话 / 删除会话 / 清空全部：`pvClose` 清预览态 + 历史 + 工具条 + 高亮，iframe 物理拆除（`killFrame`）。实测删除会话后 workfs=0、工具条隐藏、srcdoc 清空。

### 11.5 修复的旧问题

`renderWs` 原来开头 `if (!bound) return`——只有 ▶ 运行过一次代码块才置位 `bound`，导致**从未运行过代码的会话，工作区列表不渲染**（预览/下载按钮全都看不到）。现改为 `renderWs` 首次调用即 `bindOnce()`。

- **不走应用代理**：图片/视频由 WebView 直连，墙外站点可能加载失败（如需走代理请改方案 B：点按加载 + 宿主 http 桥取字节）；
- **会向第三方暴露 IP/UA**（已用 `no-referrer` 降低泄露）；模型理论上可塞追踪像素，介意则改 B；
- **无 onerror 兜底**：加载失败时浏览器显示 alt/空白，可点开原图。

## 12. v2.6 增量：回答内嵌图片补全 + Work 调用预览浏览器（2026-10-31）

### 12.1 回答里图片仍是超链接的根因与修复

用户反馈"还是没内嵌图片，只有超链接"。排查结论：`MD.render` 链路本身没问题，问题在**模型输出形式**与渲染规则不匹配——模型最常写的是 `[文字](图链)` 普通链接语法（MEDIA_HINT 还教它"引用网页用 `[说明](链接)`"），而渲染器只有 `![](图链)` 与独占一行裸链两种内嵌路径。三种形式现已全部内嵌（`inl()` 行内规则，边界只认空白/全角括号，不含半角 `(`，避免抢在 `![]()` / `[]()` 规则之前吃掉 URL）：

| 模型输出形式 | 修复前 | 修复后 |
|---|---|---|
| `![说明](图链)` | 内嵌 ✓ | 内嵌 ✓ |
| `[文字](图链)` / `[文字](视频链)` | **纯锚点** ✗ | `mediaTag` 内嵌（锚点包裹，可点开原图/播放） |
| 行内裸链 `看这里 https://…/x.jpg 说明` | 纯文本 ✗ | 内嵌（尾部标点剥离判定后接回） |
| 独占一行裸链 | 内嵌 ✓ | 内嵌 ✓ |
| `[文字](普通网页链接)` | 锚点 ✓ | 锚点 ✓（非媒体扩展名不误伤） |

流式期（`noMedia`）仍先显示锚点/文本，收尾 `endStream` 全量渲染变图——行为与 `![]()` 原有策略一致。

### 12.2 Work 调用内置侧边栏浏览器：` ```preview ` 围栏

- **协议**（`PROTOCOL` 新增）：` ```preview ` 首行是工作区相对路径 → 在右侧运行面板的内置侧边栏浏览器打开该文件（html/svg/md 渲染，其余源码视图）；提示模型"写完 html/svg/md 产物后用它自检"。
- **执行**（`scan` 正则扩为 `run|preview|vfs-*`；`runCalls` 新增 preview 分支）：路径校验（禁 `..`、去绝对路径前缀）→ `RUNNER.previewTo(sid, path, true)` → 回灌 `[preview] 已在运行面板打开：path`。**后台会话不抢当前 UI**：只回灌"已就绪，切回本会话可预览"。
- **小窗同步**：`stripFs` 剥离规则同步加入 preview 围栏。
- **mock 演示链**：收尾消息带 ` ```preview\nindex.html ` → 自动打开预览；`[preview]` 结果回灌后 mock 给出终止回复（防演示死循环）。

实测（mock Work 全链路）：发消息 → `run js` → `[run-result]` → `vfs-write index.html` → ` ```preview ` → 预览工具条出现、路径 `index.html`、iframe 渲染 hello、工作区行 `.pv-on` 高亮，单轮 8 条消息后终止，零控制台错误。

## 13. v2.7 增量：交付物自动落盘 + 运行面板三段统一 + 预览可滚动（2026-10-31）

### 13.1 Work 产物"写了但没进工作区"的根因与修复

**根因**：Work 模式原来只认 ` ```vfs-write ` 围栏。真实模型十次有八次直接把整页 HTML 贴在回答里（或代码块标 `html`/`svg`），围栏协议没被触发 → 工作区空、预览无文件，用户看到的就是"AI 写的页面没了"。

**修复**（`WORK.autoVfs`，v2.7）：一轮回答收尾时兜底扫描全文，把可交付的代码块自动写入虚拟工作区：

- 识别围栏：`html | svg | js | javascript | css | md | markdown`（正则加 `i`，`HTML` 等大写也能中）。
- 跳过噪声：`js`/`css` 正文 < 200 字符的短片段不入库（多半是解释性示例，不是产物）。
- 落盘位置：会话 VFS 根（`index.html`/`page.svg`/…），与 ` ```vfs-write ` 走同一条 `DB.workfsPut`；重名覆盖。
- 工作区自动展开：`S.cfg.mode === 'work'` 且未被用户手动收起（localStorage `sc.rn.ws !== '0'`）时自动展开工作区段。

### 13.2 运行面板三段风格统一（对齐 Linear.md / Claude.md）

| 段 | 改前 | 改后 |
|---|---|---|
| 段标题（运行/工作区/终端） | 12.5px·600 / 11.5px·600 / 11.5px 混排 | 统一 **12px·600**，同色阶（`--ink` 主标题、`--body` 段标题） |
| 段条 | 各自 padding、部分无背景 | 统一 30px 高、`--soft` 底、`--hairline` 下边线（`.rn-sec`） |
| 工作区位置 | 预览/终端之下的第三段 | **提到面板最上侧**（`.rn-head` → `#rn-ws` → `#rn-view` → 控制台） |
| 文件行 | 只有"查看" | `预览` / `运行`（可运行类型才出）/ `下载` 三个动作，行高 26px、等宽文件名 12px |
| 终端字色（浅色主题） | `--body` 深灰写在 `--code-bg` 深色面上（几乎不可读） | `--code-ink`，两主题均满足对比度 |
| 文件行分隔线 | `var(--line)`（未定义 → 边框回退 currentColor） | `var(--hairline-soft)` |

### 13.3 内置浏览器滚不动：遮罩吃掉了滚轮

**根因**：`#rn-empty`（"选择文件预览"的空态）是 `display:flex` 的绝对定位覆盖层，`[hidden]` 的 UA 规则被类选择器的 `display:flex` 压掉，所以预览打开后这层仍然盖在 iframe 上，滚轮事件全被它吃掉。

**修复**：空态加 `pointer-events:none`（不挡鼠标，文字仍可见）+ `.rn-empty[hidden]{display:none}` 双保险。工具条 `#rn-pvbar` 固定 30px 高，`#rn-view.pv #rn-frame` 用 `margin-top:30px` 让出位置。

### 13.4 工作区行内「运行」

新增 `RUNNER.runVfs(sid, path)`：按扩展名解析可运行类型（`crKind`）→ 取 VFS 文件 → 复用既有 `run(kind, content)`；`renderWs()` 对可运行文件多出一个 `运行` 按钮（`data-vrun`）。

## 14. v2.8 增量：模式选择搬到主页 + 临时会话 + 字号阶收敛（2026-10-31）

### 14.1 模式选择前置到主页

- **未开始会话前**：`#seg-mode` 由 `updateEmpty()` 移入主页（`#empty .e-modes`），三个模式各有一份主页文案；`chat` 为默认选中。
- **会话开始后**：首条消息渲染时同一函数把 `#seg-mode` 插回顶栏首位，顶栏可继续切换。
- 切换模式**不再弹 toast**（v2.7 起）。

### 14.2 临时会话（不写历史、不留痕）

主页右上角开关，图标用提供的"未选中"SVG（`#i-temp`）。

- **内存态**：`DB` 层新增 `TEMP` 注册表与 `markTemp/isTemp/dropTemp`；`putSession`、`putMessage`、`putAttachment`、`workfsPut`、`msgsBySid`、`workfsBySid`、`getAttachment`、`delSessionDeep` 全部分支到内存，**不写 IndexedDB**。
- **不可见**：`renderSessions()` 跳过 `s.temp`；导出/备份天然不含。
- **即弃**：新建草稿、切到别的会话、删除会话时 `dropTempSessions()` 清空（同时 `killStreams`）。
- 会话标题固定"临时会话"，不被首条消息改名。

### 14.3 字号阶收敛（两套设计文档对齐）

全站 `font-size` 只允许 9 档：**11 / 12 / 13 / 14 / 15 / 16 / 18 / 20 / 28**（对应：微型元信息 · caption · 控件 · 正文 · 会话正文与输入 · 小标题 · 标题 · 弹窗标题 · 主页大标题）。原有 10 / 10.5 / 11.5 / 12.5 / 13.5 / 14.5 / 15.5 / 17.5 / 19 / 30 等 42 处半像素值全部归入上表；`border-radius` 的 4px / 5px 字面量统一为 `var(--r-sm)`。

### 14.4 预览文档的代码面跟随主题

`buildDoc('svg')` 与 Markdown 预览原先写死 `#0b0b0c / #e8e8e8`，现按 `--code-bg`、`--code-ink`、`--code-bg-soft`、`--primary`、`--hairline`、`--code-muted` 取值（Claude 浅色主题下代码面 `#181715`，Linear 深色主题下 `#0f1011`），符合两份文档"代码面恒深"的约定。

### 14.5 验收（puppeteer，30 项断言全绿）

| 组 | 断言 |
|---|---|
| 主页 | 模式选择在 `#empty` 内、顶栏无残留、默认 chat、临时会话开关可切换 |
| 模式 | 切 Work 零 toast、文案随模式切换 |
| 面板 | 工作区在预览/终端之前、三段同字号同字重、空态 `pointer-events:none` |
| Work | 产物自动落盘、行内 `预览/运行/下载`、工作区自动展开、`运行` 起沙箱 |
| 预览 | 预览条出现、命中的是 `#rn-frame`（非遮罩）、滚轮在 iframe 内 `scrollY=1440` |
| 临时会话 | `sessions`/`messages` 库计数均为 0、历史列表 0 条 |
| 主题 | 深色 `#010102`+`#0f1011` 代码面、浅色 `#faf9f5`+`#181715` 代码面、文件行分隔线取 token |
| 布局 | 1500/1120 两种宽度 × 明暗两主题：无横向溢出、顶栏居中、输入框不出界 |

## 15. v2.9 增量：文件夹选择入主页 + 模型能力自动填充 + 上下文估算重做（2026-10-31）

### 15.1 工作区选择移到 Agent 主页

顶栏原有的 `#btn-ws` 彻底移除（`#tb-c` 只剩标题与模式切换，居中不再被挤）。改成 `updateEmpty()` 在 **Agent 模式主页**渲染 `<button class="e-ws">`：图标 + 文件夹名（无则"选择文件夹"），选中后显示末级目录名、`title` 给完整路径。会话开始后主页消失，按钮随之消失，因此 `renderWsBtn()` 也不再处理 `hidden/disabled/locked` 三种旧态。

同时取消两处"自动弹系统选目录框"：切到 Agent 模式不再强制弹框（主页有按钮）、快速条 `quickCmd('agent')` 保留（那里没有主页）。

### 15.2 临时会话开关静默化，主页去小字

- `toggleTemp()` 不再 `toast`，只切 `S.tempMode` 并重渲染主页。
- `Work：虚拟沙箱`、`Agent：真实文件工具` 两个标题下的小字介绍删除（chat 主页保留一句引导，因为那里需要说明输入框用法）。
- chat 主页提问改为 `CHAT_SUGS`（12 条）按 `S.sugSeed` 用 LCG 抽 4 条；每个新草稿重新播种，所以不会再"每次都那几句"。

### 15.3 应用图标统一为侧栏 logo

`host/app.ico` 由 `#i-logo` 的**外轮廓**生成：珊瑚渐变圆角方（`#d8835f → #bd6a4e`）+ 米白实心气泡，9 个尺寸（16/20/24/32/40/48/64/128/256，PNG 压缩条目）。取外轮廓而非原图的描边样式，是因为侧栏里 1024 画布上的 85px 描边在 16px 下只剩 0.9px，会糊成一团。窗口图标与托盘图标都走 `ExtractAssociatedIcon(exe)`，所以换 `app.ico` 重新 publish 即同时覆盖任务栏、托盘、资源管理器。

### 15.4 模型能力表（上下文 / 最大输出 / 输入类型 / 思考字段）

单文件零依赖，三级数据源，逐模型落到 `cfg.modelMeta`：

```
cfg.modelMeta[modelId] = { ctx, out, in:[...], reason, src:'api'|'catalog'|'manual' }
```

1. **接口 `/models`**：`context_window / context_length / max_model_len / max_input_tokens …`（含 `topProvider / architecture / info / capabilities` 嵌套盒）、`max_completion_tokens / max_output_tokens …`、`modalities.input / architecture.input_modalities`、`supported_parameters`（据此判定该模型认 `reasoning_effort` / `reasoning` / `thinking` / `enable_thinking` 哪个字段）。
2. **models.dev 目录**（MIT，opencode 同源）：GET `https://models.dev/api.json`（实测 5.9 MB / 235 家 / 3936 个模型），`catNorm()` 归一化成 `{id:{c,o,i,r}}` 后存 localStorage，**290 KB / 7 天 TTL**。匹配顺序：全等 → 去 `provider/` 前缀 → 去 `:free`/`@版本` → 去日期后缀 → 去 `-latest` → 最长前缀（要求边界字符）。实测命中：`claude-sonnet-4-5-20250929`→200k/64k/图、`gpt-4o`→128k/16k、`qwen3-max`→262k/65k、`glm-4.6`→204.8k/131k/思考、`kimi-k2-0905-preview`→262k，未知名返回 `null`。
3. **模型名规则** `guessCtx()`：前两级都没命中时兜底。

拉取时机：设置里点「获取列表」时联网拉一次（并回填整池）；启动/切模型只读本地缓存，静默补全，**不联网**。手工改过的（`src:'manual'`）不被覆盖。

**思考字段**：`buildBody()` 在 `thinkByModel[model]` 非 Default 时，优先按 `modelMeta[model].reason` 决定发哪个字段（`reasoning: {effort|enabled}` / `thinking: {type}` / `enable_thinking: bool` / `reasoning_effort: string`）；没有 `reason` 时沿用旧的两分支，向后兼容。

### 15.5 设置页模型池列表（取代逗号文本框）

原来 `modelsText` 输入框（逗号分隔字符串）删除，改为 `#mdl-pool` 列表：每行 `模型名 + 能力摘要（200k 上下文 · 64k 输出 · 文/图 · 思考）`，右侧两个图标按钮 ⚙ 展开能力编辑面板（上下文窗口 / 最大输出 / 输入类型 5 个复选框 / 思考字段下拉 / 来源标注）、🗑 从池中移除；点模型名 = 设为当前模型。行高 30px，编辑面板两列网格，池内最多 264px 滚动。

### 15.6 上下文估算重做

旧实现只显示"上一轮 usage 的 p+c"，草稿态永远是 0。新版 `ctxEst()` 实时估算**下一次请求**会占多少：系统提示 + 历史（与 `buildBody` 同规则：最近 20 条 / 32k 字符）+ 当前输入 + 待发附件（图片按 OpenAI 视觉公式 `85 + 170×512px 块数`）。

分词估算 `NET.estimate`（不引 tiktoken，保持单文件）：CJK 按家族系数 0.62（Gemini/o 系）~ 0.78（Claude）token/字，拉丁字母数字 4 字符/token，标点代码 2.6 字符/token，每条消息信封 4 token、整体 +3。圆环显示 `≈12.3k/200k`，tooltip 给出分项（系统提示 / 历史 n 条 / 当前输入 / 附件 / 上一轮实际 usage）与"这是估算非 BPE"的说明；分母取 `ctxLimitFor()`（能力表 → 旧探测值 → 模型名规则）。80% 自动压缩阈值同步改用该函数。

> **v0.2.0 修正（口径）**：上面这一版把「输出」写成了按 `max_tokens` 预留的**预计输出**（未设置按 4096），于是空草稿也会显示 ≈4k，而且历史里已经含了上一轮回答、再叠加一次等于重复计数。现在改为四项真实相加：
> `占用 = 缓存命中(u.h) + 未缓存输入(u.p − u.h) + 草稿(未发送的输入+附件) + 本次输出(u.c)`，
> 其中 `本次输出` 是**已经发生的**上一轮 completion token（没有就显示 0），不再预测未来输出。没有 usage 时 `u.p` 由 `系统提示 + 最近 20 条 / 32k 字符` 估算，`本次输出` 保持 0。因此新开空会话是 `≈0/200k`，发完一轮后才跳到 `≈174/131k` 这种真实值。

### 15.7 验收

| 组 | 断言 |
|---|---|
| 顶栏/主页 | 顶栏无 `#btn-ws`；Agent 主页有工作区按钮且无小字；Work 标题「Work：虚拟沙箱」且无小字 |
| 提问建议 | chat 主页 4 条；连开 5 次草稿出现 ≥2 种组合（实测 5 种） |
| 估算 | 输入后圆环数字变化（≈0/131k → ≈26/131k）；tooltip 含系统提示/历史/当前输入分项 |
| 模型池 | 列表渲染、每行 2 个操作按钮、旧逗号框已移除、⚙ 可展开、改窗口后摘要/上限/圆环分母同步 |
| 布局 | 1024/1280/1600 三档：圆环不压输入框、无横向溢出、输入框 ≥240px、模型池行高 30px、编辑面板两列、5 个复选框 |
| 图标 | ICO 9 个条目、四角透明、中心米白、底色珊瑚；exe 内可检出 ICO 头（offset 2,494,348）与 v2.9 标记 |

## 16. v2.9.1 增量：主页结构锚定 + 图标复刻侧栏轮廓 + 能力数据源兜底（2026-10-31）

### 16.1 模式选择坐标恒定，下侧内容不再顶动它

问题：`#empty` 是 `justify-content:center` 的纵向 flex，聊天页有提问建议、Agent 页有文件夹按钮，内容高度不同 → 三模式切换时图标/标题/模式选择整体上下跳；Agent 页的图标还比另外两个大 12px。

改法：`#empty` 里只保留一个参与居中的 `.e-wrap`，它内部只有 `.e-core`（图标 76px + h1 + `#seg-mode`）；各模式的差异内容一律放进 `.e-extra`，用 `position:absolute; top:100%` 挂在中间块下方，**不参与布局计算**。Agent 页的「选择文件夹」因此落在模式选择正下方，且切模式时模式选择组件的 x/y/w/h 完全不变（实测 760/900px 两种窗口高度下三模式坐标一致，误差 <0.1px，仅为亚像素居中取整）。

### 16.2 应用图标 = 侧栏 logo 的同一张 SVG

`host/app.ico` 不再自创配色，直接取 `#i-logo` 的第一段路径（气泡外轮廓，第二段是原图的挖空），用浅底 `#faf9f5` 圆角方 + 墨色 `#141413` 描边渲染，与侧栏看到的标识一致。描边宽度按尺寸补偿：≤24px 时按画布单位加粗到约 1.6px（原图 85 单位的描边在 16px 下只有 0.9px，会糊），≥32px 用 88 单位保持原图形比例。共 9 个尺寸（16/20/24/32/40/48/64/128/256）。窗口图标与托盘都取自 exe 的 `ExtractAssociatedIcon`，重编即三处同步。

### 16.3 能力补全的三级兜底

v2.9 只有 models.dev 一个来源，像 `nvidia/nemotron-4-340b-instruct` 这种已被上游目录下架的模型会显示「能力未获取」。现在链路是：

1. `models.dev/api.json`（3936 条）；
2. **有缺口才拉** `openrouter.ai/api/v1/models`（456 条，0.77MB，覆盖 `vendor/model` 形态 id），合并进同一份缓存并打 `or:true` 标记，之后不再重复请求；
3. 仍有缺口 → **按模型名推断**（`guessCaps`）：`vl|vision|omni` → 图片输入，`reasoning|thinking|qwq|r1|o1` → 思考字段，上下文走 `guessCtx` 规则表（新增 `nemotron-4 → 4096`）；结果标 `src:'guess'`，列表里显示「· 推断」；
4. 识别为**非对话模型**（`reward|embedding|rerank|guard|classifier|moderation|safety|asr|tts` 等）的，直接标「非对话模型（无上下文窗口）」，不再显示空能力。

另外：打开设置页会用本地缓存对**池内所有模型**做一次离线补全，所以列表不再需要先点「获取列表」才有数据。

## 17. v0.2.0 增量（应用版本号由 v2.9.1 起改为 0.2.0）：`改进建议-2026-10-31.md` 的 30 项全部落地（2026-10-31）

实施顺序按文档 §五，但一次性全部做完。全部改动仍在单文件 `index.html` + 宿主两处小改（`direct` 直连例外、`win.datadir`），零新依赖。

### 17.1 设置（#1~#10）

| # | 落地形态 |
|---|---|
| 1 | 设置左侧 6 组：连接与模型 / 通用设置 / 数据与维护 / 快捷键 / 提示词 / **关于**；顶部搜索框对 `label` 文本做子串过滤并高亮，命中的字段自动展开 |
| 2 | 「一键自检」串行跑 代理 / 模型列表 / 能力目录 / OCR 四项，逐行 ✓✗ + 耗时 + 建议；浏览器模式（无宿主桥）代理项直接给说明而不是报错 |
| 3 | 存储用量：会话/附件/VFS/孤立附件计数 + `navigator.storage.estimate` 占用条 + **占用前 20 的会话列表**；长会话（>40 条）行内「压缩」：保留最近 30 条，其余合成一条摘要占位（二次确认、不可逆） |
| 4 | 配置快照导出/导入（JSON 单文件）：深度递归剔除 `apiKey/token/secret/password`（含 `presets[].apiKey`），导入按 key 合并 |
| 5 | `modelMeta[id].def = { temperature, maxTokens }`：模型池 ⚙ 面板新增两个输入框，留空=跟随全局；`effParams` 优先级 会话 > 该模型默认 > 全局 |
| 6 | 快捷键中心已有录制/恢复；新增**冲突检测**（同组合绑两个动作标红 + 提示） |
| 7 | 4 套强调色（珊瑚/薰衣草/青/琥珀）映射 `--primary` 系列；字号 4 档（92/100/112/125%）写 `--fs-scale`；均持久化并在 `init`/配置变更时应用 |
| 8 | 目录缓存瘦身：下载后按「模型池命中 ∪ 常见家族」裁剪（`catPrune`），典型占用从 290KB 降到 ~100KB 级；缓存损坏/过大可一键清空 |
| 9 | 代理按域名分流：设置里 `proxyDirect`（逗号/换行分隔），命中即给宿主请求打 `direct:true`，宿主用 `UseProxy=false` 的专用 `HttpClient` 发送 |
| 10 | 诊断包 `solochat-diag-*.txt`：版本/UA/主题/桥状态/BaseURL/DB 计数/最近错误码，**不含正文、Key、路径** |

### 17.2 Agent / Work（#11~#18）

| # | 落地形态 |
|---|---|
| 11 | 运行面板「工作区」按目录分组（`tree-grp` + 折叠状态存 `S.wsTreeClosed`），单层平铺时不加分组；行内仍是 预览/查看/运行/下载 |
| 12 | 工具调用卡片：```run / ```vfs-write / ```vfs-list / ```patch / ```preview 渲染成 `.tool-card`（标签 + 标题 + 元信息 + 行数），点标题折叠 |
| 13 | 写入审批分级：工作区内默认自动，但 `dangerExt`（默认 `exe,bat,cmd,ps1,dll,msi,scr`）与 `writeDirs` 白名单外一律逐次确认，并用 toast 说明原因 |
| 14 | 新增 ```patch 围栏（极简 unified diff：`@@ -a,b +c,d @@` + 上下文/增/删），`applyUnified` 严格校验上下文，不匹配即拒绝并把原因回灌 |
| 15 | 同一路径 `vfs-write` 保留最近 5 版（`workfs.vers[]`），工作区行出现「版本 N」按钮 → 确认后回滚（当前内容成为新的历史版本） |
| 16 | 失败自愈：同型错误达到阈值时先注入「带报错的自愈提示」续跑一次（`w0.healed`），仍失败才停 |
| 17 | Work 空态 3 个模板（静态页 / 单页应用 / 图表页）：一键建会话 + 铺 `index.html/style.css/app.js` |
| 18 | 预览沙箱：`sandbox="allow-scripts"`（不透明源）+ 文档内联 CSP（`connect-src 'none'`）+ `postMessage` 校验 `e.source === iframe.contentWindow` 与 nonce |

### 17.3 页面与交互（#19~#25）

- **#19 命令面板**：`Ctrl+K` 浮层，对 动作 / 会话 / 模型 / 提示词 / 设置分组 做子序列打分，↑↓ 选择、Enter 执行、Esc 关闭；`mousedown` 与 `click` 双通道（后者供键盘与自动化），250ms 去重防双触发。
- **#20 代码块工具条**：`.code-bar` 内含 运行 / 复制 / 下载为文件（按语言映射扩展名）/ 换行开关；流式期间（`.msg.streaming`）隐藏，结束后淡入。
- **#21 会话分组 + 拖拽**：无项目块时按 今天/昨天/本周/更早 分桶；HTML5 拖拽落位后把当前顺序写进 `cfg.order`，渲染时优先按它排。
- **#22 主页最近会话**：草稿态在提问建议下加 4 条最近会话（标题 + 模式 + 相对时间），点击直达。
- **#23 会话内查找**：`Ctrl+F`，TreeWalker + Range 高亮 `mark.hit`，Enter/↑↓ 跳转、显示 `n/m`、Esc 清除。
- **#24 消息分支**：每条非系统消息悬停出现「分支」，取该条及之前的历史深拷贝到新会话（`forkFrom`）。
- **#25 细节**：滚动条统一 8px 圆角、`::selection` 用强调色 12%、动效统一 120~150ms、**可选代码行号**（`cfg.lineNo`，逐行 `span.cl` + CSS 计数器，复制仍是纯文本）。

### 17.4 性能与体积（#26~#30）

- **#26** 长会话：`.msg{content-visibility:auto;contain-intrinsic-size:auto 120px}`，屏外消息跳过布局与绘制（比手写 IntersectionObserver 虚拟列表风险低得多，滚动与查找都不受影响）。
- **#27** 附件降采样沿用 v1.4 的 `compressImage`（长边 1800 / q0.85），本次核对无回归。
- **#28** 流式分页：`MD_STREAM_MAX` 以上转纯文本追加；重排间隔随长度让步（`60ms + len/60`，上限 +320ms）。
- **#29** 目录按需切片：见 #8 的 `catPrune`。
- **#30** 未使用 SVG symbol 清理：删掉 5 个 0 引用符号（`sun/moon/plusb/menu/check`，其中 `check` 因关于页新增用法重新保留），并加了一个统计脚本口径。

### 17.5 本轮修复的几个真问题

1. **新配置项被白名单丢弃**：`loadCfg` 只按 `DEF_CFG` 的键合并，`accent/fontScale/codeNoWrap/msgFork/groupSessions/order/dangerExt/writeDirs/proxyDirect/lineNo` 未登记 → 刷新即回默认。已全部补进 `DEF_CFG`。
2. **自检项作用域错误**：`runSelfCheck` 里误用裸 `fetchModels`（在 `NET` 内），改为 `NET.fetchModels()`；并给「代理」项加浏览器模式短路。
3. **上下文口径里的「预计输出」**：v2.9.2 用 `max_tokens` 预占输出（默认 4096），加上历史已含上一轮回答 → 空草稿显示 ≈4k、真实值翻倍。v0.2.0 改为「缓存命中 + 未缓存输入 + 草稿 + 本次输出（已发生的 completion）」，并删掉 `ctxOutBudget()`。空会话 `≈0`，一轮后 `≈174/131k`（96 命中 + 32 未缓存 + 0 草稿 + 46 输出），分项之和恒等于总数。
4. **拖拽排序插错位置**：先 `splice` 移除再按旧下标插入，向下拖会插回原处（拖了没反应）。改为移除后重新定位目标下标、向下拖插到目标之后。
5. **Alt+Space 要按两次才出来**：热键原来是无条件 `Toggle`——只要窗口"技术上可见"就隐藏。快速条默认常驻（`cfg.quickbar=true`，半透明 560×44 停在顶部），用户往往没意识到它一直在，于是第一次按 = 把它藏起来（看起来毫无反应），第二次按才出现。现在改为按「召唤」语义：不可见 → 显示+置顶+聚焦；可见但焦点不在条上 → 拉到最前+聚焦；焦点已在条上才隐藏。另外把置顶从「2s 定时器」提前到显示瞬间同步 `SetWindowPos`，并给 `WM_HOTKEY` 加 250ms 去抖（键盘软件/自动重复会送来两条消息，一显示一隐藏等于没反应）。Esc 仍是「隐藏」，不受影响。

### 17.6 验收

puppeteer 六套（`_t11`~`_t17`）全绿：加载无 JS 错误、命令面板、设置六组跳转与关于页、自检、模型池默认参数、Work 模板、代码工具条（行号/换行/复制/下载）、工具卡片折叠、分支、查找、会话分组、强调色/字号/换行持久化、存储面板与孤儿清理、快照无密钥、诊断包、`applyUnified` 五个用例。宿主 `dotnet publish` 通过并已替换 `dist\SoloChatHost.exe`。