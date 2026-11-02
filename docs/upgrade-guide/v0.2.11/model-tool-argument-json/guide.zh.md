---
kind: upgrade-guide
description: "模型工具调用会拒绝空白、损坏或非对象 JSON 参数字符串，不再将其传给工具。"
---
# 模型工具调用参数使用 JSON 对象

[English](guide.md) | 中文

## 变更

模型发起的工具调用必须包含恰好一个 JSON 对象。空参数字符串不再变成 `{}`，损坏或非对象 JSON 也不会传给可能重新解释它的工具。每个被拒绝的调用都得到一个 `INVALID_ARGS` 结果；其他正常调用仍会执行，模型可以继续处理。依赖空白或标量模型参数的自定义 LLM 适配器及工具受到影响。直接通过编程方式执行工具不变。

## 迁移

1. 在自定义适配器中，将 `ToolCallBlock.arguments` 设为 JSON 对象字符串。对象参数使用 `JSON.stringify(args)`，无参调用使用 `'{}'`，不要使用空字符串。
2. 如果工具接受标量输入，在工具 schema 中声明 `input` 等对象参数，并传入 `{"input":"value"}`。执行器读取该字段，不再接收顶层标量。
3. 测试一次正常调用和一次损坏调用同时返回的情况。确认正常工具本体只运行一次，损坏调用的工具本体不运行，下一次模型请求包含各自的成功结果与 `INVALID_ARGS` 结果。既有 Session 日志和用户配置无需迁移。详见 [agent-loop 参数规则](../../../../packages/core/agent-loop/README.zh.md)。
