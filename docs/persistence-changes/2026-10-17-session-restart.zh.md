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
    previous: "2026-10-13-user-rpc-principal"
    after: "b08596252de8da01d294f13d52042316436059f88818ac940cdb9047f44ad554"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "1424e2aa08b65e430647a9640678543f5f6c675ebe84850f4103ddf810d037a2"
    decision: same-version
  - root: "event:session/restart"
    previous: null
    after: "ed0b8c3643d857e08619f651ff06e4b9e55222ff44ac4652fe6cb4224fb47f03"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "dee4f299f0300e89736777a0a9eee2f98fdc4e76d020fb9abd352e7c376f3f0e"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "865710b26fe6bf8ff74705b7d8f8d20a7847f6f6a8851d2acc9e6853f817f313"
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
