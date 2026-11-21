---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-22-deliver-response-attribution

[English](2026-11-22-deliver-response-attribution.md) | 中文

## 概述

在 Session 格式 V4 中新增符合归属规则的用户和开发者消息来源 `plugin:deliver-response`。插件用它标记用户角色历史中的投递清单。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-22-deliver-response-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-17-session-restart"
    after: "870edfadaaf6efb9c888057785134882a965b3957f37ceee042da680aea85dd1"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-17-session-restart"
    after: "c858e6f569ffbfda929b7db04052e1825fcb5f329af74a732143452defe27771"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-17-session-restart"
    after: "e8e88582418002b33fbfe12387274f28865ad5a11910c96cb996a350f6b256c5"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-17-session-restart"
    after: "d295670db83e0aabbdc722e6722f3381db27ef4d700f4026c514acc7d71645e2"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

旧版 V4 读取器接受非空的来源类型，即使未安装来源插件，也会保留来源 JSON 元数据，包括 `form: instructions`。旧读取器仍会派生出相同的已记录消息内容和工具交互；此来源不授予权限，也不要求读取器执行任何操作。新读取器照常接受已有的 V4 消息。可选插件仅通过此来源跟踪当前轮是否已记录清单；没有此来源时，读取器对旧记录的解释不变。

<a id="verification"></a>
## 验证

运行 `node node_modules/vitest/vitest.mjs run packages/session/session-persistence-jsonl/tests/native-source-admission.spec.ts packages/session/session-format-v3-to-v4/tests/attribution.spec.ts`：34 个测试全部通过。测试覆盖 JSONL 读写模式下的未知来源及其元数据，以及用户和开发者消息通过 V4 编解码器、Session 接纳和消息派生时的保留行为。

<a id="dev-note"></a>
## 开发备注

无。
