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
    previous: "2026-10-05-working-directory-attribution"
    after: "19c67413c99d9c6e694a662b91ad389302b8b0a80ba6adb68989ece52098b599"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "fadf223fa364e6e0cefa3acf5db61870f0472cb1e3b60068bf6ab72ee0cb513b"
    decision: same-version
  - root: "event:session/restart"
    previous: null
    after: "ed0b8c3643d857e08619f651ff06e4b9e55222ff44ac4652fe6cb4224fb47f03"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "02ea0913d376cc6c262e8fb389d0a69b3b6cb339fc4f419c7c592f9ddd498dcf"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "61924525bcb2ea851d89d0392df3e5e9c01c050858ed958dadbd8b63764bf2a0"
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
