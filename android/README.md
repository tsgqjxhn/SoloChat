# SoloChat Android（悬浮截图 + 分享接收 + 自动同步）

原生 Android 壳 + 现有 `index.html`：聊天走 WebView，悬浮球截屏走 `MediaProjection`，
系统分享走 `ACTION_SEND`，记忆同步走 WebDAV（JobScheduler 后台任务）。
**截图只在内存里，点「发送」才 base64 直传模型，不写相册、不经过中转服务器。**

当前版本 **0.4.0**（versionCode 18，发布包已用项目自己的 keystore 签名）。

## 功能

- **截图弹窗模型独立配置**：设置 → 连接与模型 → 模型页新增「截图弹窗模型」，可单独选视觉模型，留空跟随当前聊天模型；原生 `Prefs.POPUP_MODEL` 与主应用自动同步。
- **截图超时修复**：`ImageReader` 常驻监听、空闲持续丢帧，避免队列积满；等待 5 秒，第二次及后续截图不再频繁超时。
- **回答 null 修复**：兼容 `content:null`、数组 content、`reasoning_content`、`choices[].text`；仍为空提示「模型返回空内容」，不再显示 null。
- **回答页锁按钮**：底部中间锁按钮加浅灰圆角底和蓝色图标，明确可见；点击切换分屏，可滑动底层题目。
- **ResizeObserver 报错**：全局错误处理忽略 `ResizeObserver loop` 布局警告，不再弹 “looplimitexceed” toast。
- **回答 Markdown 渲染**：原生 `Md` 渲染标题、粗体、斜体、行内代码、代码块、列表、引用、链接、删除线；图片只显示 alt 文本，不联网加载。
- **配对凭据持久化**：电脑把配对 token 存到 `%USERPROFILE%\SoloChat\pair-token.txt`，桌面重启/重新开启配对仍沿用；手机 `sc.pair.v1` 也随 APK 更新保留，更新后不需要重新配对或同步。
- **ResizeObserver 报错修复**：两个 ResizeObserver 回调改到下一帧合并执行，抽屉底边高度去重，消除 `looplimitexceed / ResizeObserver loop limit exceeded`。
- **投屏授权复用**：首次点悬浮球授权后保留 `MediaProjection`/常驻 `VirtualDisplay`，后续点球直接取帧，不再每次弹「开始录制或投射」；关闭悬浮球或系统收回投屏才失效。
- **悬浮球开关**：手机「通用设置 → 外观与行为 → 悬浮球截屏提问」可关闭；关闭后悬浮球与常驻通知一起消失。
- **截图弹窗**：顶部不再有拖拽条和「截图已加入队列」；锁在左上，缩略图 44×60dp，输入框右侧内嵌发送；输入最多 5 行，弹窗最多半屏，回答在 45% 屏高内增长/滚动。
- **配对默认地址**：手机记住上次电脑地址，端口未填自动补 `8788`；配对后直接传配置（含 API Key）和记忆文件。
- **手机 UI 收口**：Work/Agent 工具条只留设置/附件/图片/联网/扩展/更多，六类「本轮选择」合并到一个扩展按钮，打开统一的 `/` 搜索面板；面板隐藏长描述并限制高度。
- **NVIDIA 地址修复**：Base URL 归一化时只保留一个 `/v1`；切换供应商清空上一家的 `chatPath/modelsPath`，避免 `/v1/v1/chat/completions` 404；原生截图问答同样归一化 URL。
- **API Key 小眼睛**：设置页所有密码型 Key/Secret 输入框右侧都有眼睛按钮，点击可在明文/密文之间切换；只改输入框类型，不额外存储。
- **设置页**：手机隐藏「快捷键」页；扩展页六个二级标签横向可滑；底部完成栏加分隔线与安全区；侧栏搜索去掉 `(Ctrl+K)` 提示。
- **工作区**：没有会话/产物时显示空态提示，不再是空白面板。
- **手机布局**：窄屏自动收起侧栏（左上角 ☰ 呼出）；Work/Agent 工具条最左有设置齿轮，顶栏最右有工作区入口（全屏抽屉）；会话参数齿轮在顶栏工作区右侧，底部不再为它留一整行；主页面右上角「临时会话」；设置页全屏（顶部横向分类、单列内容）；输入框默认一行，主页面最多四行，下拉面板最多两行。
- **悬浮球**：蓝色圆底 + 桌面版白色气泡，点球直接截当前整屏，拖动贴边；App 在前台时自动隐藏，回到桌面/其他 App 再出现。
- **截屏队列弹窗**：点球 → 投屏授权 → **直接抓整屏**（不跳 SoloChat、不裁剪）→ 紧凑 Bottom Sheet（拖拽条、标题、整屏缩略图、单行输入、锁、蓝色全宽发送）；截图只是队列里的待发送消息，**不会自动发送**。
- **锁**：未锁时点弹窗外（题目页面）会关闭弹窗并回到原应用；锁定后弹窗固定，可在上层滑动/操作底层题目。
- **发送**：主应用的连接配置会自动同步给原生截图问答，避免聊天里配好 Key、截图弹窗却发不出去；缺 Key 时提示并打开连接设置。回答弹窗也改为紧凑底部卡片。
- **分享接收**：其他 App 分享**文字** → 直接填入输入框；分享**图片** → 进入附件栏（压缩到 1600px 内，JPEG 85，Base64 内存传递）。
- **聊天**：WebView 加载内置 `index.html`；`AndroidBridge` 提供 `http`（流式）、`mem`、`notify`；Soul 记忆写 App 私有目录 `files/memory/{USER,MEMORY,DREAMS}.md`。
- **自动同步**：打开 App、记忆写入后 15 秒、每天一次（JobScheduler）自动拉取并合并；`USER` 以本机为准，`MEMORY/DREAMS` 按行取并集，合并后再上传。
- **可选加密**：AES-256-GCM + PBKDF2（12 万次）加密远端文件；口令只存本机，远端看到的是 `SCENC1` 开头的二进制。
- **同步通知**：同步完成/失败发通知（低优先级，不响铃）。
- **手动操作**：设置页仍有「上传记忆 / 下载并合并」；另有导出/导入 `.md`；关于页有「手机 ↔ 电脑配置同步」（导出本机 / 以对方为准 / 取并集，密钥不进文件，同名或同地址配置沿用本机 Key）。
- **不落相册**：只用 `Bitmap` + Base64，没有 `MediaStore` 写入。

## 构建

```bash
# 1) 构建网页主产物 + 注入 Android 桥
node tools/build.mjs
node tools/build-android.mjs        # index.html → android/app/src/main/assets/index.html

# 2) 打包
cd android
gradle assembleDebug                 # 调试包
gradle assembleRelease               # 签名发布包
```

发布签名读取 `android/keystore.properties`（已 gitignore）：

```properties
storeFile=solochat-release.jks
storePassword=...
keyAlias=solochat
keyPassword=...
```

换机器构建前把 `solochat-release.jks` 和 `keystore.properties` 一起备份；丢了就不能覆盖安装升级。

产物：`android/app/build/outputs/apk/release/app-release.apk`
仓库已放一份：`dist/SoloChat-Android-0.4.0.apk`（442,966 字节，证书 `CN=SoloChat`；桌面也放了一份 `SoloChat-Android-0.4.0.apk`）

## 使用

1. 安装 APK → 首次启动允许「显示在其他应用上层」与通知。
2. 屏幕左侧出现蓝色圆底白色气泡；点球 → 「Start now」→ 直接截当前整屏 → 问答卡。
3. 设置：**长按球**或通知里的「设置」→ 填 Base URL / API Key / 模型（需支持图片输入）。
4. WebDAV：填地址/账号/密码/文件名，勾「自动同步」；要加密再填「同步口令」。
5. 其他 App 里选中文字/图片 → 分享 → SoloChat，文字进输入框、图片进附件栏。

## 已验证（模拟器 API 34，release 包已安装）

- **布局**：390px 视口/真机 WebView 下无横向溢出，输入框与发送按钮完整可见；设置弹层不超出屏幕。
- **截屏流程**：在 Android 设置页点球 → 投屏授权 → 问答卡；授权对话框背后的背景仍是设置页，截图内容是设置页整屏，没有跳回 SoloChat，也没有裁剪框。
- **分享文字**：`am start -a SEND -t text/plain` 冷启动后输入框出现分享文字。
- **分享图片**：`content://media/...` + `--grant-read-uri-permission`，图片解码后附件栏出现 1 个缩略图。
- **自动同步**：启动时 PUT 合并文件；远端新增 MEMORY 条目后重启，本地文件出现该条目（换行正确）。
- **加密**：开启后远端文件头为 `SCENC1`；清空本地记忆后重启，能解密并合并回两条条目。
- **后台任务**：`dumpsys jobscheduler` 可见 `4101`（每日）与 `4103`（写入后延迟）；强制运行 4101 后远端文件 mtime 更新。
- **通知**：同步后通知栏出现「SoloChat 记忆同步」。
- **悬浮球**：App 前台隐藏、回桌面出现；截屏/框选/问答链路仍正常。
- **签名**：`apksigner verify --print-certs` 通过，证书 `CN=SoloChat`。

## 权限

`SYSTEM_ALERT_WINDOW`、`FOREGROUND_SERVICE` + `specialUse`、`FOREGROUND_SERVICE_MEDIA_PROJECTION`、
`POST_NOTIFICATIONS`、`INTERNET`、`ACCESS_NETWORK_STATE`（JobScheduler 网络约束）、`RECEIVE_BOOT_COMPLETED`（恢复周期任务）。

## 已知限制

- Android 14+ **每次截屏都要重新授权投屏**（系统行为，无法绕过）。
- 银行/支付/DRM 页面系统禁止截屏或悬浮，属正常。
- 省电模式/厂商后台限制可能推迟 JobScheduler；需要更实时可把 App 加入「不受限制」。
- 手机端没有 Python/命令执行，Work 的 `run`、Agent 的 `cmd` 不可用；聊天、Soul、悬浮问答、同步可用。
- WebDAV 账号密码仍存 App 私有 `SharedPreferences`（未加密）；建议用专用账号/应用密码。
- 只在模拟器验证，未在真机/不同 ROM 上跑；iOS 未做（系统不允许全局悬浮截屏）。
- `USER.md` 合并策略是「本机优先」，两端同时改画像时以本机为准。

## 目录

```
android/app/src/main/java/com/solochat/mobile/
  MainActivity.java            WebView、分享接收、启动同步
  Bridge.java                  http / mem / notify
  BubbleService.java           悬浮球 / 截屏 / 裁剪 / 提问 / 回答
  CropOverlayView.java         可拖动选框
  ProjectionRequestActivity.java 透明授权页
  SettingsActivity.java        Base/Key/模型/提示词 + WebDAV 自动同步/加密
  Dav.java                     WebDAV 合并、AES-GCM、通知
  SyncJobService.java          JobScheduler 周期/延迟同步
  BootReceiver.java            开机恢复任务
  Api.java                     视觉问答调用（非流式）
  Prefs.java                   本地配置
android/app/src/main/assets/index.html   构建产物 + WebView 桥 shim
tools/build-android.mjs                  网页产物 → Android assets
```
