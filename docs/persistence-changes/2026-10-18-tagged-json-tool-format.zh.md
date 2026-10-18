---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-18-tagged-json-tool-format

[English](2026-10-18-tagged-json-tool-format.md) | 中文

## 概述

在 request/header 调用配置的可选 requestFormat 字段中记录适配器拥有的、带版本的工具序列化指令。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-18-tagged-json-tool-format
baseline: false
changes:
  - root: "event:request/header"
    previous: "2026-09-16-session-format-v4"
    after: "1d4ec9fa37c28550a69a06ed17d118b1bf9cbe975311bd5b33f50d02bc3c1cef"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

当前读取器接受没有 requestFormat 的已有请求头，并在分派前解析当前配置的模式。旧读取器忽略这项可选元数据；已存助手工具调用块和工具结果保留原有格式及执行语义。旧版本不能重建纯文本协议请求，但读取已完成历史不会重新执行工具。带 tagged-json 适配器设置的配置不支持降级。事件判别字段及必需载荷没有变化。

<a id="verification"></a>
## 验证

llm-pi-ai、Session 和 agent-loop 请求冻结的定向测试通过，共 593 项，覆盖 JSON 序列化后的种子恢复、请求指令保留、工具结果不变及不重复执行。真实 SDK 的本地回环测试覆盖切回原生模式，以及准备调用后的配置变化。

<a id="dev-note"></a>
## 开发备注

无。
