# SoloChat Android（悬浮截图 + 分享接收 + 自动同步）

原生 Android 壳 + 现有 `index.html`：聊天走 WebView，悬浮球截屏走 `MediaProjection`，
系统分享走 `ACTION_SEND`，记忆同步走 WebDAV（JobScheduler 后台任务）。
**截图只在内存里，点「发送」才 base64 直传模型，不写相册、不经过中转服务器。**

当前版本 **0.3.1**（versionCode 4，发布包已用项目自己的 keystore 签名）。

## 功能

- **手机布局**：窄屏自动收起侧栏（左上角 ☰ 呼出），输入框/发送按钮完整可见，工具栏可横向滑动；**设置页全屏**（顶部横向分类、单列内容），不再左右挤压。
- **悬浮球**：蓝色圆底 + 桌面版白色气泡，点球直接截当前整屏，拖动贴边；App 在前台时自动隐藏，回到桌面/其他 App 再出现。
- **截屏问答**：点球 → 投屏授权 → **直接抓整屏**（不再跳 SoloChat、不再裁剪）→ 问答卡（取消/发送）；球和问答卡都不再显示「设置」按钮，设置走长按球/通知。
- **分享接收**：其他 App 分享**文字** → 直接填入输入框；分享**图片** → 进入附件栏（压缩到 1600px 内，JPEG 85，Base64 内存传递）。
- **聊天**：WebView 加载内置 `index.html`；`AndroidBridge` 提供 `http`（流式）、`mem`、`notify`；Soul 记忆写 App 私有目录 `files/memory/{USER,MEMORY,DREAMS}.md`。
- **自动同步**：打开 App、记忆写入后 15 秒、每天一次（JobScheduler）自动拉取并合并；`USER` 以本机为准，`MEMORY/DREAMS` 按行取并集，合并后再上传。
- **可选加密**：AES-256-GCM + PBKDF2（12 万次）加密远端文件；口令只存本机，远端看到的是 `SCENC1` 开头的二进制。
- **同步通知**：同步完成/失败发通知（低优先级，不响铃）。
- **手动操作**：设置页仍有「上传记忆 / 下载并合并」；另有导出/导入 `.md`。
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
仓库已放一份：`dist/SoloChat-Android-0.3.1.apk`（423,342 字节，证书 `CN=SoloChat`）

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
