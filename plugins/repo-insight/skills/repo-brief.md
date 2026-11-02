---
name: repo-brief
title: 仓库速览
desc: 用一个仓库地址产出定位、活跃度、关键文件导读
modes: [work, agent]
---
# 仓库速览

输入是一个 GitHub 地址（`owner/repo` 或完整 URL）时，按这个顺序做：

1. 用 ```github-repo owner/repo``` 拿元数据：stars、forks、open issues、语言、最近 push 时间、许可证。
2. 用 ```web <仓库主页>``` 读 README 首屏，确认它到底解决什么问题。
3. 判断活跃度：最近 push 距今多久、issues 是否长期无人回、是否有 release。
4. 输出四段，不超过 200 字每段。

## 输出格式

- **这是什么**：一句话，别复述 README 标题。
- **活跃度**：最近提交时间、issue 处理情况、release 节奏（有数据就给数据）。
- **适合谁**：能拿来干什么，不适合什么。
- **怎么上手**：一条最省事的路径（安装命令 / 在线 demo / 最小示例）。

## 纪律

- 元数据必须来自工具结果，不许凭印象写 stars。
- 拿不到 README 就写「没读到 README」，不要编造功能。
- 不想读代码时不要假装读过；需要结论就给结论。
