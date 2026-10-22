---
kind: upgrade-guide
description: "Gemini models on custom OpenAI-compatible routes now receive an assistant message between a tool result and a following user message."
---

# Gemini tool-result continuation

English | [中文](guide.zh.md)

## Change

For `openai-completions` routes absent from the installed provider catalog, a model id containing `gemini` and not `deepseek` (case-insensitive) now defaults `compat.requiresAssistantAfterToolResult` to `true`. In native tool mode, a user message that directly follows a tool result receives a protocol assistant message between them, and an empty assistant content is serialized as `''` instead of `null`. Previously the user message followed the tool result directly, and a gateway forwarding to Gemini could reject that history with HTTP 400 `Requests ending with a model turn are not supported.`

The bridge adds no user content and no signature. Stored Sessions are unchanged and need no migration; the next request serializes their history with the new default. `toolMode: tagged-json` sends tool results as text and has no bridge. Installed catalog routes, including Gemini, GPT, Kimi, and DeepSeek models, are unchanged. Explicit route and model `compat` values override the default.

## Migration

1. Keep existing Gemini gateway configurations if the endpoint accepts the inserted assistant message.
2. If an endpoint rejects it, set `requiresAssistantAfterToolResult: false` in the affected model's or route's `compat` in the profile's `cordis.patch.yml` to restore the previous request messages.
3. Verify by sending a user message directly after a tool result through that model and confirming the gateway returns a response. A first reply with no preceding tool result does not exercise the bridge.
