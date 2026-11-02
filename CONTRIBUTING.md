# 提交插件

## 目录结构

```
plugins/<id>/
├── manifest.json          # 必填
├── skills/*.md            # 可选
├── tools/*.json           # 可选（只能是声明式 HTTP）
├── agents/*.md            # 可选
└── prompts/*.md           # 可选
```

## manifest.json

```json
{
  "name": "插件名（也是导入后的包名，≤40 字）",
  "version": "1.0.0",
  "desc": "一句话说明",
  "author": "你的名字",
  "license": "MIT",
  "skills": ["skills/foo.md"],
  "tools": ["tools/bar.json"],
  "agents": ["agents/baz.md"],
  "prompts": ["prompts/qux.md"]
}
```

## 正文 frontmatter

技能 / 智能体 / 提示词的正文用 YAML frontmatter：

```markdown
---
name: repo-brief          # 必填，英文短名，导入后作为 id
title: 仓库速览            # 可选，显示名
desc: 一句话说明
modes: [work, agent]      # 适用模式
tools: [web, search]      # 仅智能体：可用工具白名单
maxTurns: 3
maxTokens: 1200
---
正文…
```

## 工具（声明式 HTTP）

```json
{
  "name": "github-repo",
  "title": "仓库概览",
  "desc": "GET /repos/{owner}/{repo}",
  "type": "http",
  "method": "GET",
  "url": "https://api.github.com/repos/{arg}",
  "headers": { "Accept": "application/vnd.github+json" },
  "modes": ["work", "agent"]
}
```

- `{arg}` 会被 URL 编码后替换；POST 时正文模板里同样可用。
- **禁止**：JS 代码工具、shell 命令、需要私有密钥的接口。

## 校验

```bash
node scripts/validate.mjs
```

会检查：manifest 合法、列出的文件都存在、工具符合声明式 HTTP 约定、正文有 frontmatter 的 `name`、index.json 与目录一致。

## 发布

1. 在 `index.json` 的 `plugins` 数组加一条（id/name/version/desc/author/license/path/tags/items）；
2. 跑校验；
3. 提 PR 到 `Plugin` 分支。
