# SoloChat 插件市场

SoloChat 的扩展包集合。每个 `plugins/<id>` 就是一个可以直接导入的扩展包：
`manifest.json` + `skills/` + `tools/` + `agents/` + `prompts/`。

## 安装

**方式一：导入文件夹（推荐）**

1. 下载本分支（Code → Download ZIP）并解压；
2. SoloChat → 设置 → 扩展 → 插件 → `导入文件夹…`；
3. 选中 `plugins/<插件名>`（一次一个包，选到具体插件目录）。

**方式二：拿到文件后拖入**

把插件目录里的 `manifest.json` 和 `skills/ tools/ agents/ prompts/` 整组拖进「插件」页的拖放区。

**方式三：离线分发**

在插件页点 `导出到桌面` 得到同样的目录结构，别人拿到就能导入。

## 清单

| id | 名称 | 版本 | 内容 | 需要联网 |
|---|---|---|---|---|
| `repo-insight` | 仓库速览 | 1.0.0 | 工具 1 · 技能 1 · 提示词 1 | 是（GitHub API） |
| `release-notes` | 更新日志 | 1.0.0 | 工具 1 · 技能 1 · 智能体 1 · 提示词 1 | 是（GitHub API） |
| `weather-brief` | 出行简报 | 1.0.0 | 工具 1 · 技能 1 · 提示词 1 | 是（wttr.in） |

机器可读索引见 [`index.json`](index.json)。

## 运行时插件

`index.json` 之外还有 `kind: runtime` 的**运行时插件**：由根目录
[`runtimes.json`](runtimes.json) 登记，本体在 [`runtimes/python-311/`](runtimes/python-311/)。
它和扩展包一样是插件，**不是主应用自带的 runtime**，也没有另起
`runtime/python-311` 之类的分支或独立类别；只是 `kind` 不同、换了一份清单登记。

| id | 名称 | 版本 | 内容 | 入口 |
|---|---|---|---|---|
| `python-3.11` | Python 3.11 | 3.11.9 | 官方 CPython 3.11.9 便携包 + uv | `python.exe` |

**与扩展包的区别**

| | 扩展包 | 运行时插件 |
|---|---|---|
| 清单 | `manifest.json` | `plugin.json`（`kind: runtime`） |
| 内容 | `skills/ tools/ agents/ prompts/` | 可执行运行时压缩包（`.zip`） |
| 登记 | `index.json` | `runtimes.json` |
| 作用 | 为智能体增加工具 / 能力 | 为 Agent 模式提供脚本执行环境 |
| 安装 | 导入到应用扩展目录 | 解压到 `%LOCALAPPDATA%\OpenPage\runtimes` |

- 「工具只能是声明式 HTTP、不含可执行代码」是**扩展包 `tools/`** 的约束；运行时插件走另一条执行通道，
  隔离边界见 [`runtimes/python-311/README.md`](runtimes/python-311/README.md)——**并非 OS 级安全沙箱**。
- 其它扩展如需 Python，可在自身清单用 `requires` 声明前置，id 为 `python-3.11`。

## 安全模型

- **工具只能是声明式 HTTP**：`{ "type": "http", "method": "GET", "url": "https://…/{arg}" }`。
  市场里不允许出现可执行代码（JS/shell），应用侧也不会执行。
- 只读类 API 优先；需要密钥的服务不放进市场，改为让用户自己填。
- 智能体的工具白名单在 `tools` 里显式列出，越权调用会被调度器拦下。
- 提交前请跑 `node scripts/validate.mjs`（本地校验，零依赖）。

## 提交新插件

见 [CONTRIBUTING.md](CONTRIBUTING.md)。一句话：新建 `plugins/<id>/`，写好 `manifest.json`，
在 `index.json` 里加一条，跑校验脚本，提 PR 到 `ext/plugins` 分支。

## 许可

MIT，见 [LICENSE](LICENSE)。各插件的作者与许可见其 `manifest.json`。
