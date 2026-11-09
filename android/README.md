# SoloChat Android（悬浮截图问答 + WebDAV 同步）

原生 Android 壳 + 现有 `index.html`：聊天界面走 WebView，悬浮球截屏走原生 `MediaProjection`。
**截图只在内存里，点「发送」才 base64 直传模型，不写相册、不经过中转服务器。**

当前版本 **0.2.0**（versionCode 2）。

## 功能

- **悬浮球**：蓝色 S，可拖动、贴边；点击截屏；旁边 ⚙ 小按钮进设置。
- **截屏问答**：点球 → 系统投屏授权 → 截一帧 → 拖动白框选区域 → 输入问题 → 发送 → 回答卡片（可复制/关闭）。
- **聊天**：WebView 加载内置 `index.html`，`AndroidBridge` 提供 `http`（流式）、`mem`、`notify` 三个能力；Soul 记忆写 App 私有目录 `files/memory/{USER,MEMORY,DREAMS}.md`。
- **记忆导入导出**：设置页「导出记忆 / 导入记忆」，走系统文件选择器。
- **WebDAV 同步（手动）**：设置页填 URL/用户名/密码/文件名，「上传记忆 / 下载记忆」；上传是一个合并的 Markdown，下载按 `# USER.md / # MEMORY.md / # DREAMS.md` 拆回文件（重启 App 生效）。
- **不落相册**：只用 `Bitmap` + `Base64`，没有 `MediaStore` 写入。
- **通知**：常驻通知带「设置」按钮，点一下也能进设置页。

## 构建

```bash
cd android
# Gradle 8.14.3（本机缓存路径见 README 根目录环境）
gradle assembleDebug     # 调试包
gradle assembleRelease   # 发布包（用 debug 签名，自用）
```

产物：`android/app/build/outputs/apk/release/app-release.apk`
仓库已放一份：`dist/SoloChat-Android-0.2.0.apk`（389,562 字节）

> 上架前需要换正式签名，并把 `applicationId` 改成自己的域名。

## 使用

1. 安装 APK → 首次启动按提示允许「显示在其他应用上层」。
2. 屏幕左侧出现蓝色 **S** 悬浮球，旁边有 ⚙。
3. 点球 → 系统弹「Start recording or casting」→ **Start now**。
4. 拖动白框选要问的区域 → 「就用这块」。
5. 输入问题 → 「发送」；回答出现后可复制。
6. **点 ⚙**（或长按球 / 通知里的「设置」）→ 填 Base URL / API Key / 模型（要支持图片输入），以及 WebDAV。

## 已验证（模拟器 Echo_API_34 / Pixel_6_API_34）

- 悬浮球 → 投屏授权 → 截屏 → 框选 → 提问：mock 服务收到 `image_url` 的 data URL（90 KB），回答卡片正常。
- 聊天：AndroidBridge 流式请求 mock 服务，消息正常流式显示。
- WebDAV：上传后服务端文件包含 `# USER.md/# MEMORY.md/# DREAMS.md`；下载后 App 的 `files/memory/MEMORY.md` 出现服务端新增条目。
- 通知「设置」按钮与 ⚙ 按钮均可进设置页。

## 权限

`SYSTEM_ALERT_WINDOW`（悬浮窗）、`FOREGROUND_SERVICE` + `specialUse`（常驻）、
`FOREGROUND_SERVICE_MEDIA_PROJECTION`（截屏）、`POST_NOTIFICATIONS`、`INTERNET`。

## 已知限制

- Android 14+ **每次截屏都要重新授权投屏**（系统行为）。
- 银行/支付/DRM 页面系统禁止截屏或悬浮，属正常。
- 手机端没有 Python/命令执行，Work 的 `run`、Agent 的 `cmd` 不可用；聊天与 Soul 记忆可用。
- release 包目前用 debug 签名，仅供自用/内测。
- WebDAV 密码存在 App 私有 `SharedPreferences`（未加密），建议用专用账号/应用密码。
- 悬浮球坐标受状态栏影响，拖动后可贴边；不同 ROM 可能需要微调。

## 目录

```
android/app/src/main/java/com/solochat/mobile/
  MainActivity.java            WebView + 权限
  Bridge.java                  http / mem / notify
  BubbleService.java           悬浮球 / 截屏 / 裁剪 / 提问 / 回答
  CropOverlayView.java         可拖动选框
  ProjectionRequestActivity.java 透明授权页
  SettingsActivity.java        Base/Key/模型/提示词 + 记忆导入导出
  Api.java                     视觉问答调用（非流式）
  Prefs.java                   本地配置
android/app/src/main/assets/index.html   构建产物 + WebView 桥 shim
```
