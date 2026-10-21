---
kind: upgrade-guide
description: "Custom OpenAI-compatible Gemini and DeepSeek model names use model-specific request defaults instead of generic OpenAI fields."
---

# Gemini and DeepSeek gateway defaults

English | [中文](guide.zh.md)

## Change

For `openai-completions` routes absent from the installed provider catalog, model ids containing `gemini` or `deepseek` (case-insensitive) use `max_tokens`, omit `store`, and send instructions as `system`. DeepSeek retains recognized gateway reasoning dialects, otherwise uses its `thinking` control, and supplies `reasoning_content` when replaying tool calls. These defaults also apply to `toolMode: tagged-json`; they neither enable reasoning nor change declared effort levels. Previously these models inherited generic OpenAI parameter detection from the gateway name and URL. Installed catalog routes and other model families are unchanged.

Explicit route and model `compat` values override the new defaults. Native Gemini tool signatures are retained for same-model replay; signatures missing from old recorded responses cannot be recovered.

## Migration

1. Keep existing Gemini or DeepSeek gateway configurations if the endpoint expects these model-specific fields.
2. If an endpoint deliberately expects generic OpenAI fields, set the affected model's `compat` in the profile's `cordis.patch.yml` to `supportsStore: true`, `supportsDeveloperRole: true`, and `maxTokensField: max_completion_tokens`. For DeepSeek, also set `thinkingFormat: openai` and `requiresReasoningContentOnAssistantMessages: false` to retain the former detection behavior.
3. Verify one response and one tool-result continuation through that model. A successful first response alone does not verify tool replay. No Session migration or deletion is required.
