---
description: "Optional response delivery tools, settings, and activity cards."
kind: "package-bundle"
---

# Response delivery bundle

English | [中文](README.zh.md)

Enable **Response delivery** from **Plugins → More**, then open its details to edit **Additional work requirements**. Save applies the staged text; reset removes the user override and restores the inherited default. Disabling the bundle stops new deliveries. Previously delivered replies remain readable in Chat.

The bundle composes the [delivery runtime](../deliver-response/README.md) and [settings and activity cards](../client-ui-deliver-response/README.md). It is absent from shipped default profiles. Existing profile settings infrastructure persists the requirements; the bundle introduces no separate data store. Its artwork reuses the standard generic plugin symbol.

## Model Experience

Indirectly, through the [delivery runtime](../deliver-response/README.md), which owns prompt, tool-schema, prefilled-exchange, and token effects; the bundle adds no model content of its own.

#### KV Cache effect

The runtime owns changes to requirements and per-turn messages. This composition adds no further cache effects.

## Known Limitations and Deferred Work

- This is an opt-in experimental composition. Native tool delivery and its provider constraints are documented by the runtime; enabling the bundle does not force a model to call the delivery tool.

### Dev Note

None.
