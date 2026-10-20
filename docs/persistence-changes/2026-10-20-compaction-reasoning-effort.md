---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-20-compaction-reasoning-effort

English | [中文](2026-10-20-compaction-reasoning-effort.zh.md)

## Summary

Records the resolved reasoning effort of a compaction summary call when one is specified.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-20-compaction-reasoning-effort
baseline: false
changes:
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "8cd2f19c03f77ae26dcd90dd62951c19d425a1a88f6695ff51372b7e9c117747"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The compaction/summary event gains an optional reasoningEffort string. Existing records remain valid without it; absence does not imply the conversation's reasoning effort. The field describes the auxiliary summary request and does not affect checkpoint replay, surface replacement, or shadow pricing. Readers that do not interpret the field retain the same summary content and transaction relationships. The current reader retains optional event data; no historical format schema or migration is changed.

<a id="verification"></a>
## Verification

Focused compaction-basic tests: 166 passed, including real YAML Loader composition, live preferences across manual and automatic compaction, explicit and model-default effort logging, and rejection of unavailable summary models without conversation-model fallback.

<a id="dev-note"></a>
## Dev Note

None.
