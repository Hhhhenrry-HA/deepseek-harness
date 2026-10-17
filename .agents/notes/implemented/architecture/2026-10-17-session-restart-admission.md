# Agent Note: Admit same-session restarts through the existing message surface

Status: implemented

English | [中文](2026-10-17-session-restart-admission.zh.md)

## Problem

Editing an earlier input or regenerating an answer must exclude the superseded response from later model requests without destroying the original record. A failed request preparation must not prematurely replace the visible conversation.

## Decision

The [Session Controller](../../../../packages/api/session-controller/README.md) owns restart selection, durable intent, and request-identity deduplication. The existing inbox owns pending input. The loop accepts a generic replacement intent at pre-step and commits it through the existing surface replacement operation only after request preparation. Chat derives retired ranges from the intent and admitted message; drafts remain local.

## Alternatives considered

**Mutate or truncate the log.** This destroys previous responses and breaks append-only persistence.

**Fork for every edit.** This preserves records but creates another conversation instead of restarting the conversation the user selected.

**Replace history in the Remote handler.** This removes the previous branch before route resolution can fail and duplicates loop admission ownership.

## Consequences

The event log remains the sole durable history. Original messages remain inspectable while only the admitted branch reaches the model. Required restart events make unaware readers refuse the log before execution. Tool and filesystem effects are not rolled back. Inputs removed by compaction are unavailable for editing. Deduplication acknowledges accepted work, not successful execution; an explicitly canceled request needs a new identity to run again.

## Verification

The owning Host tests cover branch reconstruction, duplicate admission, latest-turn selection, provider failure, and preparation failure. Chat tests cover replay, streaming updates, backward pagination, canceled drafts, and last-turn actions. The assembled browser scenario exercises the public controls and reload in an isolated profile.
