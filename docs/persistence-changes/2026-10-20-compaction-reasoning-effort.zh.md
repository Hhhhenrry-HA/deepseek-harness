---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-20-compaction-reasoning-effort

[English](2026-10-20-compaction-reasoning-effort.md) | 中文

## 概述

压缩总结调用指定思考强度时，记录其解析后的强度。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-20-compaction-reasoning-effort
baseline: false
changes:
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "8cd2f19c03f77ae26dcd90dd62951c19d425a1a88f6695ff51372b7e9c117747"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

compaction/summary 事件新增可选的 reasoningEffort 字符串。已有记录无需此字段仍然有效；字段缺失不代表沿用会话的思考强度。该字段描述独立的总结请求，不改变检查点回放、会话表面替换或被替换内容的计量。未解释此字段的读取方仍得到相同的总结内容和事务关联。当前读取方保留可选事件数据；不修改历史格式定义或迁移。

<a id="verification"></a>
## 验证

compaction-basic 定向测试 166 项通过，覆盖真实 YAML Loader 组合、手动与自动压缩的实时偏好、显式及模型默认思考强度记录，以及总结模型不可用时拒绝调用而不回退到会话模型。

<a id="dev-note"></a>
## 开发备注

无。
