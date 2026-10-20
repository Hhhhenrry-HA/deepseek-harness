---
kind: upgrade-guide
description: "Explicit default-tier Subagent and workflow calls use default instead of medium."
---

# Rename the default Subagent tier

English | [中文](guide.zh.md)

## Change

The Subagent tools and workflow `agent()` hook accept `model_tier: 'default' | 'high'`. The explicit value `medium` is replaced by `default`; the settings page calls this tier **Default**. Omitted or null still selects the user-configured model and reasoning effort. High still follows the main agent's current model and effort.

The saved `mediumModel` settings key and recorded Session policies are unchanged. No settings or Session-data migration is required.

## Migration

1. Replace `model_tier: 'medium'` with `model_tier: 'default'` in saved workflow scripts and direct tool calls. TypeScript callers of `SubagentStartRequest` replace `modelTier: 'medium'` with `modelTier: 'default'`.
2. Keep `mediumModel`, the selected model, and its reasoning effort unchanged in settings and `cordis.yml`.
3. Run one delegation with `default` and one with `high`. Open each child conversation and inspect its read-only model and reasoning-effort display at the bottom: default uses the selected model, while high uses the main agent's model.
