# Python 3.11 运行时插件

`kind: runtime` 的运行时插件，本体为 `python-3.11.9-runtime.zip`，由根目录
[`runtimes.json`](../../runtimes.json) 登记；它不是主应用自带的运行时，也不是扩展包
（不含 `manifest.json` / `skills` / `tools` / `agents` / `prompts`）。

## 内容

| 项 | 说明 |
|---|---|
| 运行时 | 官方 CPython 3.11.9 Windows x64 **embeddable package**（来源：python.org） |
| 附带 | `uv.exe`（uv，随包分发） |
| 入口 | `python.exe`（见压缩包内 `plugin.json`） |
| id / 版本 | `python-3.11` / `3.11.9` |
| 许可 | PSF License（Python）、MIT / Apache-2.0（uv），见包内 `LICENSE.txt` |

## 安装与用途

- 解压到 `%LOCALAPPDATA%\OpenPage\runtimes`（其下按 id 建子目录，如 `python-3.11`）。
- **不写 PATH、不改注册表、不需要管理员权限**；纯便携解压，卸载即删目录。
- 供 Agent 模式的 `python` 工具执行脚本：以**工作区为 cwd**，`stdout` / `stderr` 原样回传。

## 作为依赖前置

其它扩展需要 Python 时，在自身清单用 `requires` 声明前置运行时，id 固定为 `python-3.11`。

## 隔离边界（请勿夸大）

| 已有约束 | 说明 |
|---|---|
| 便携隔离 | 独立目录，不污染系统 Python / PATH / 注册表 |
| 工作目录约定 | 脚本 cwd 约定为工作区 |
| 120s 超时 | 单次执行超时即终止 |
| 进程树清理 | 结束时清理残留子进程 |

> **这不是 OS 级安全沙箱。** 上述只是便携性与执行约定：Python 进程仍以当前用户身份运行，
> 对该用户可读 / 可写的文件与网络都有完整权限，不能当作不可信代码的安全边界。

## 校验

| 校验项 | 值 |
|---|---|
| `sha256` | `3ab929da23d57ec8ce581d3b6d7297a8d069b2b1661425c6c26008d11113b28f` |
| `size` | `26128140` 字节 |
| 压缩包内 `plugin.json` 的 `entry` | `python.exe` |

```bash
sha256sum python-3.11.9-runtime.zip               # 应等于上面 sha256
stat -c %s python-3.11.9-runtime.zip             # 应等于 26128140
unzip -p python-3.11.9-runtime.zip plugin.json  # 确认 id/kind/entry/version
```

Windows PowerShell 可用 `Get-FileHash -Algorithm SHA256` 与 `Expand-Archive` 做同样核对。
