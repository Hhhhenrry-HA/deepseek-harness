---
kind: upgrade-guide
description: "自定义 OpenAI 兼容路由中的 Gemini 模型，现在会在工具结果与随后的用户消息之间收到一条 assistant 消息。"
---

# Gemini 工具结果续接

[English](guide.md) | 中文

## 变更

未收录于已安装提供方目录的 `openai-completions` 路由中，id 包含 `gemini` 且不含 `deepseek`（不区分大小写）的模型，现在将 `compat.requiresAssistantAfterToolResult` 默认为 `true`。在原生工具模式下，紧跟工具结果的用户消息之前会插入一条协议 assistant 消息，空的 assistant 内容序列化为 `''` 而非 `null`。此前用户消息直接跟在工具结果之后，转发到 Gemini 的网关可能以 HTTP 400 `Requests ending with a model turn are not supported.` 拒绝该历史。

该桥接不添加用户内容和签名。已存储的会话不变，无需迁移；下一次请求按新默认值序列化其历史。`toolMode: tagged-json` 以文本发送工具结果，没有桥接。已安装目录路由（包括 Gemini、GPT、Kimi 和 DeepSeek 模型）不变。显式路由和模型 `compat` 值覆盖该默认值。

## 迁移

1. 如果端点接受插入的 assistant 消息，保留现有 Gemini 网关配置。
2. 如果端点拒绝，在 profile 的 `cordis.patch.yml` 中给受影响模型或路由的 `compat` 设置 `requiresAssistantAfterToolResult: false`，恢复此前的请求消息。
3. 通过该模型在工具结果之后直接发送一条用户消息，确认网关返回响应来验证。没有前置工具结果的首次回复不会触发该桥接。
