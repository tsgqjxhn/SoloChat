# SoloChat Android（悬浮截图问答）

原生 Android 壳 + 现有 `index.html`：聊天界面走 WebView，悬浮球截屏走原生 `MediaProjection`。
**截图只在内存里，点「发送」才 base64 直传模型，不写相册、不经过中转服务器。**

## 功能

- **悬浮球**：蓝色 S，可拖动、贴边；点击截屏，长按进设置。
- **截屏问答**：点球 → 系统投屏授权 → 截一帧 → 拖动白框选区域 → 输入问题 → 发送 → 回答卡片（可复制/关闭）。
- **聊天**：WebView 加载内置 `index.html`，`AndroidBridge` 提供 `http`（流式）、`mem`、`notify` 三个能力；Soul 记忆写 App 私有目录 `files/memory/{USER,MEMORY,DREAMS}.md`。
- **记忆导入导出**：设置页「导出记忆 / 导入记忆」，走系统文件选择器。
- **不落相册**：只用 `Bitmap` + `Base64`，没有 `MediaStore` 写入。

## 构建

```bash
cd android
# Gradle 8.14.3（本机缓存路径见 README 根目录环境）
gradle assembleDebug     # 调试包
gradle assembleRelease   # 发布包（用 debug 签名，自用）
```

产物：`android/app/build/outputs/apk/release/app-release.apk`
仓库已放一份：`dist/SoloChat-Android-0.1.0.apk`

> 上架前需要换正式签名，并把 `applicationId` 改成自己的域名。

## 使用

1. 安装 APK → 首次启动按提示允许「显示在其他应用上层」。
2. 屏幕左侧出现蓝色 **S** 悬浮球。
3. 点球 → 系统弹「Start recording or casting」→ **Start now**。
4. 拖动白框选要问的区域 → 「就用这块」。
5. 输入问题 → 「发送」；回答出现后可复制。
6. **长按球** → 填 Base URL / API Key / 模型（要支持图片输入，如 `gpt-4o-mini`、`qwen-vl-max`）。

## 权限

`SYSTEM_ALERT_WINDOW`（悬浮窗）、`FOREGROUND_SERVICE` + `specialUse`（常驻）、
`FOREGROUND_SERVICE_MEDIA_PROJECTION`（截屏）、`POST_NOTIFICATIONS`、`INTERNET`。

## 已知限制

- Android 14+ **每次截屏都要重新授权投屏**（系统行为）。
- 银行/支付/DRM 页面系统禁止截屏或悬浮，属正常。
- 手机端没有 Python/命令执行，Work 的 `run`、Agent 的 `cmd` 不可用；聊天与 Soul 记忆可用。
- release 包目前用 debug 签名，仅供自用/内测。
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
