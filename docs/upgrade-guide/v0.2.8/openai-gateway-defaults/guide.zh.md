---
kind: upgrade-guide
description: "自定义 OpenAI 兼容路由中的 Gemini 和 DeepSeek 模型名采用模型专用请求默认值，不再使用通用 OpenAI 字段。"
---

# Gemini 和 DeepSeek 网关默认值

[English](guide.md) | 中文

## 变更

未收录于已安装提供方目录的 `openai-completions` 路由中，id 包含 `gemini` 或 `deepseek`（不区分大小写）的模型使用 `max_tokens`、省略 `store`，并用 `system` 承载指令。DeepSeek 保留已识别网关的专用推理格式，否则使用自身的 `thinking` 控制，并在回放工具调用时携带 `reasoning_content`。这些默认值也适用于 `toolMode: tagged-json`；它们不会启用思考或改变已声明的努力级别。此前这些模型按网关名称和网址继承通用 OpenAI 参数检测。已安装目录路由和其他模型家族不变。

显式路由和模型 `compat` 值覆盖新的默认值。原生 Gemini 工具签名会保留用于同模型回放；旧回复记录中缺失的签名无法恢复。

## 迁移

1. 如果端点接受这些模型专用字段，保留现有 Gemini 或 DeepSeek 网关配置。
2. 如果端点明确要求通用 OpenAI 字段，在 profile 的 `cordis.patch.yml` 中给受影响模型的 `compat` 设置 `supportsStore: true`、`supportsDeveloperRole: true` 和 `maxTokensField: max_completion_tokens`。DeepSeek 还需设置 `thinkingFormat: openai` 和 `requiresReasoningContentOnAssistantMessages: false`，以保留原有检测行为。
3. 通过该模型验证一次回复和一次工具结果续接。仅首次回复成功不足以验证工具回放。无需迁移或删除会话。
