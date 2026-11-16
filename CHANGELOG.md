# CHANGELOG

## 1.1.0 — 2026-11-16

- 清单改用 v1 `items[]`；旧四数组仍兼容。
- `manifest.config` 支持包级配置；条目级 `config` 支持工具 JSON / frontmatter / items。
- `schemas/plugin.schema.json` 覆盖 `items[]`、`config`、`mcp`、`requires`。
- `scripts/validate.mjs` 支持 v1 清单并检查配置字段。
- 新增 [`docs/扩展规范.md`](docs/扩展规范.md)。

## 1.0.0 — 2026-11-02

- 初始市场：repo-insight / release-notes / weather-brief
- 索引格式 solochat-plugin-market/1
- 校验脚本 scripts/validate.mjs
