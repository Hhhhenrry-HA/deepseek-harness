---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-18-tagged-json-tool-format

English | [中文](2026-10-18-tagged-json-tool-format.zh.md)

## Summary

Records adapter-owned, versioned tool serialization instructions in the optional requestFormat field of request/header call configuration.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-18-tagged-json-tool-format
baseline: false
changes:
  - root: "event:request/header"
    previous: "2026-09-16-session-format-v4"
    after: "1d4ec9fa37c28550a69a06ed17d118b1bf9cbe975311bd5b33f50d02bc3c1cef"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Current readers accept existing headers without requestFormat and resolve the currently configured mode before dispatch. Earlier readers ignore this optional metadata; stored assistant tool-call blocks and tool results retain their existing format and execution meaning. Earlier versions cannot reproduce the text-only wire serialization, but reading completed history does not re-execute calls. Downgrading the configured tagged-json adapter setting is not supported. No event discriminator or required payload changes.

<a id="verification"></a>
## Verification

Focused llm-pi-ai, Session, and agent-loop request-freeze tests passed (593 tests), including JSON-serialized seed restoration, preserved request instructions, unchanged tool results, and no repeated tool execution. Real SDK loopback tests cover switching back to native mode and configuration changes after call preparation.

<a id="dev-note"></a>
## Dev Note

None.
