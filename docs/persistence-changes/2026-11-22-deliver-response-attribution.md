---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-22-deliver-response-attribution

English | [中文](2026-11-22-deliver-response-attribution.zh.md)

## Summary

Adds `plugin:deliver-response` as a qualified user/developer message source in Session format V4. The plugin uses it for delivery checklists in user-role history.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-22-deliver-response-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-17-session-restart"
    after: "870edfadaaf6efb9c888057785134882a965b3957f37ceee042da680aea85dd1"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-17-session-restart"
    after: "c858e6f569ffbfda929b7db04052e1825fcb5f329af74a732143452defe27771"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-17-session-restart"
    after: "e8e88582418002b33fbfe12387274f28865ad5a11910c96cb996a350f6b256c5"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-17-session-restart"
    after: "d295670db83e0aabbdc722e6722f3381db27ef4d700f4026c514acc7d71645e2"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Older V4 readers admit a non-empty source kind and preserve its JSON metadata, including `form: instructions`, without the producer installed. They derive the same recorded message content and tool exchanges; the source grants no authority and requires no reader-side action. New readers accept existing V4 messages unchanged. The optional plugin uses its source to track whether the current turn already recorded a checklist; absence of the source does not change how readers interpret older records.

<a id="verification"></a>
## Verification

Ran `node node_modules/vitest/vitest.mjs run packages/session/session-persistence-jsonl/tests/native-source-admission.spec.ts packages/session/session-format-v3-to-v4/tests/attribution.spec.ts`: all 34 tests passed. The cases cover unknown attribution and metadata in JSONL read/write modes, and user/developer messages through the V4 codec, Session adoption, and message derivation.

<a id="dev-note"></a>
## Dev Note

None.
