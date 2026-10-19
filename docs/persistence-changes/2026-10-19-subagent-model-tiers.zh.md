---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-19-subagent-model-tiers

[English](2026-10-19-subagent-model-tiers.md) | 中文

## 概述

新增仅记日志的 `subagent/model-tier-policy` 事件，固定 Session 的启用状态、单个中级模型和思考强度。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-19-subagent-model-tiers
baseline: false
changes:
  - root: "event:subagent/model-tier-policy"
    previous: null
    after: "5c2a9b86c53d317ca0e231612c40b119e478429ad74f1455f52a531c8aae4075"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有事件及其 schema 不变。新读取方保留已发布的 `subagent/model-selection-policy` 读取逻辑，在设置边界将单个路由转换为中级；多个路由必须重新明确选择。新事件使用独立类型，不携带模型历史操作，不改变 Session 写入版本。旧读取方不执行分级行为；降级不能保留该行为。

<a id="verification"></a>
## 验证

`pnpm exec vitest run packages/subagent/tool-subagent/tests packages/client/ui-settings-subagent/tests --maxWorkers=2` 已通过。现有设置测试覆盖会话策略捕获、子级继承、会话恢复和排除模型历史。更新后的控制器保存测试也已通过，覆盖多路由迁移、单选模型和切换路由时重置思考强度。

<a id="dev-note"></a>
## 开发备注

无。
