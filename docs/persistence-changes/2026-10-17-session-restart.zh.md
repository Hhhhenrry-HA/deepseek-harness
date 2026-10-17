---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-17-session-restart

[English](2026-10-17-session-restart.md) | 中文

## 概述

记录同会话重发意图，并将排队的人类输入关联到替换接纳。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-17-session-restart
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-05-working-directory-attribution"
    after: "19c67413c99d9c6e694a662b91ad389302b8b0a80ba6adb68989ece52098b599"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "fadf223fa364e6e0cefa3acf5db61870f0472cb1e3b60068bf6ab72ee0cb513b"
    decision: same-version
  - root: "event:session/restart"
    previous: null
    after: "ed0b8c3643d857e08619f651ff06e4b9e55222ff44ac4652fe6cb4224fb47f03"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "02ea0913d376cc6c262e8fb389d0a69b3b6cb339fc4f419c7c592f9ddd498dcf"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "61924525bcb2ea851d89d0392df3e5e9c01c050858ed958dadbd8b63764bf2a0"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

不含 restartSeq 的既有 V4 记录保留原行为。新记录在关联入队前使用必需的 session/restart 判别符。旧读取器在执行或修复日志前拒绝该不支持的必需事件。新读取器保留原事件，并通过已有 surface 替换操作推导生效历史；可选来源引用本身不授权替换。

<a id="verification"></a>
## 验证

重发相关 Host 与 Client 定向测试共 91 项通过，覆盖 Session 重建、重复接纳、失败请求恢复及 Chat 实时、回放、向前分页投影。

<a id="dev-note"></a>
## 开发备注

无。
