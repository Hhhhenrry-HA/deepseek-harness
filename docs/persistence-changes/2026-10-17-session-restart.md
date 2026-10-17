---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-17-session-restart

English | [中文](2026-10-17-session-restart.zh.md)

## Summary

Records same-session restart intent and links queued human input to replacement admission.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-17-session-restart
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "b08596252de8da01d294f13d52042316436059f88818ac940cdb9047f44ad554"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "1424e2aa08b65e430647a9640678543f5f6c675ebe84850f4103ddf810d037a2"
    decision: same-version
  - root: "event:session/restart"
    previous: null
    after: "ed0b8c3643d857e08619f651ff06e4b9e55222ff44ac4652fe6cb4224fb47f03"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "dee4f299f0300e89736777a0a9eee2f98fdc4e76d020fb9abd352e7c376f3f0e"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "865710b26fe6bf8ff74705b7d8f8d20a7847f6f6a8851d2acc9e6853f817f313"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing V4 records without restartSeq retain their behavior. New records use the required session/restart discriminator before any linked inbox insertion. Older readers refuse this unsupported required event before executing or repairing the log. New readers retain original events and derive active history with existing surface replacement operations; the optional source reference alone does not authorize replacement.

<a id="verification"></a>
## Verification

The focused restart Host and Client tests passed: 91 tests, including Session reconstruction, duplicate admission, failed-request recovery, and live/replay/prepend Chat projection.

<a id="dev-note"></a>
## Dev Note

None.
