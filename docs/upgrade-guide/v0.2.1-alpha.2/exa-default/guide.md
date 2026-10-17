---
kind: upgrade-guide
description: "The fork uses built-in Exa search instead of the DeepSeek search provider and standalone Exa addon."
---

# Built-in Exa web search

English | [中文](guide.zh.md)

## Change

The fork's base-backed profiles use Exa for web search. The old standalone `@hhhhenrry-ha/dsh-exa-search` bundle is retired automatically when a profile loads. Its installed files are left untouched; its selected bundle entry is removed. Existing `web-search-exa` settings and `EXA_API_KEY` credentials retain their identities. DeepSeek chat credentials do not enable Exa search.

## Migration

1. Install the fork update without uninstalling the existing application. No addon installation is needed.
2. Open **Plugins > EXA Web Search** and save your Exa API key. Existing Exa keys are reused; no personal key ships in the application.
3. Request a web search to confirm results. Custom patches targeting `web-search-deepseek` must target `web-search-exa` instead; Exa uses `numResults` for a default result count, not DeepSeek's `maxUses` search budget.
