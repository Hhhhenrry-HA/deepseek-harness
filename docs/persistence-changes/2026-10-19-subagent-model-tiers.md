---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-19-subagent-model-tiers

English | [中文](2026-10-19-subagent-model-tiers.zh.md)

## Summary

Adds the log-only `subagent/model-tier-policy` event to pin a Session's enabled state, single medium model, and reasoning effort.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-19-subagent-model-tiers
baseline: false
changes:
  - root: "event:subagent/model-tier-policy"
    previous: null
    after: "5c2a9b86c53d317ca0e231612c40b119e478429ad74f1455f52a531c8aae4075"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing events and their schemas are unchanged. New readers retain the released `subagent/model-selection-policy` reader and convert a single route at the settings boundary; multiple routes require a new explicit selection. The new event has a distinct type, carries no model-history operation, and does not change the Session writer version. Older readers do not apply tier behavior; downgrading is not a way to preserve that behavior.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/subagent/tool-subagent/tests packages/client/ui-settings-subagent/tests --maxWorkers=2` passed. The existing settings tests exercise session-policy capture, child inheritance, restored sessions, and model-history exclusion. The updated controller save test also passed with multi-route migration, one selected model, and route-owned effort reset.

<a id="dev-note"></a>
## Dev Note

None.
