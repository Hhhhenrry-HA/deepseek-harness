---
kind: upgrade-guide
description: "Subagent model allowlists become one medium-tier model and a high tier that follows the main agent."
---

# Choose one medium-tier Subagent model

English | [中文](guide.zh.md)

## Change

Enabled Subagent model settings expose `model_tier: medium | high` instead of free provider, model, and reasoning-effort parameters. Omitted or null tiers use medium. Medium uses one user-selected model and its saved effort; high follows the main agent's current model and effort, including when a medium-tier child delegates again. Spawn, fork, and workflow use the same policy. A failed medium model does not switch to high.

The `subagent-model-selection-settings` namespace replaces `allowedModels` with `mediumModel` and `reasoningEffort`. A single saved route is read as medium. Multiple saved routes require an explicit choice. Existing Session policies stay pinned; settings apply to new conversations. `list_subagent_models` is no longer exposed.

## Migration

1. Open Plugins → Subagent, enable tiered models, select one medium model, optionally select its reasoning effort, and save. If you previously selected multiple models, select one again. Start a new conversation.
2. If you configure `cordis.yml` directly, replace `allowedModels` in `subagent-model-selection-settings` with `mediumModel: { provider: <provider>, model: <model> }` and `reasoningEffort: null` for the model default, or an effort advertised by that model.
3. In workflow scripts, replace child `provider` and `model` overrides with `model_tier: 'medium'` or `'high'` when tiered settings are enabled. Remove calls to `list_subagent_models`.
4. Confirm that the settings page shows exactly one selected model. In a new conversation, delegate without a tier and verify the child's model is the selected medium model; delegate with `high` to use the main agent's model.
