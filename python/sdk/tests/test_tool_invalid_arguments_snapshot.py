"""Project malformed tool arguments and recovery through the real Python SDK."""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / "apps" / "cli" / "lib" / "bin.js"
SCENARIO = ROOT / "snapshots" / "sdk" / "tool-invalid-arguments"
NODE = shutil.which("node")


def tool_outcomes(events: list[dict]) -> list[dict]:
    """Select stable per-call outcomes without runtime identities or successful path text."""
    return [
        {
            "call_id": event["data"]["message"]["toolCallId"],
            "is_error": event["data"]["message"].get("isError", False),
            "error_code": event["data"]["error"]["code"] if "error" in event["data"] else None,
        }
        for event in events if event["type"] == "tool/result"
    ]


@pytest.mark.skipif(not CLI.exists() or NODE is None, reason="requires the built dsh profile runtime and Node")
def test_tool_invalid_arguments_snapshot(tmp_path: Path) -> None:
    fixture = tmp_path / "replay.jsonl"
    fixture.write_text((SCENARIO / "session.v4.jsonl").read_text(encoding="utf-8").replace("{{cwd}}", tmp_path.as_posix()), encoding="utf-8")
    # Optional fixture plugins resolve from the temporary profile, not this checkout.
    replay_patch = tmp_path / "replay.cordis.yml"
    replay_plugin = ROOT / "packages" / "test-support" / "llm-replay" / "lib" / "index.js"
    replay_patch.write_text((SCENARIO / "cordis.snapshot.yml").read_text(encoding="utf-8").replace(
        "@deepseek-ai/dsh-llm-replay", replay_plugin.as_uri(),
    ), encoding="utf-8")
    patches = (SCENARIO / "cordis.yml", replay_patch)
    with DeepSeekHarness(
        _launch_args=(str(NODE), str(CLI), "--profile", "sdk", *(
            argument for patch in patches for argument in ("--patch", str(patch))
        )),
        cwd=str(tmp_path),
        provider="gateway",
        model="gemini-test",
        env={
            "DSH_HOME": str(tmp_path / "home"),
            "DSH_PERMISSION_MODE": "danger-full-access",
            "DSH_TELEMETRY_DISABLED": "1",
            "DSH_SNAPSHOT": "replay",
            "DSH_SNAPSHOT_FILE": str(fixture),
        },
        request_timeout_seconds=110,
    ) as harness:
        result = harness.run("Write first.txt and second.txt, then reply DONE.")
    notification_events = [
        notification.payload["event"] for notification in result.notifications
        if notification.method == "session.event"
    ]
    actual = {
        "final_response": result.final_response,
        "finish_reason": result.finish_reason,
        "arguments": [event["data"]["arguments"] for event in result.events if event["type"] == "tool/call"],
        "outcomes": tool_outcomes(result.events),
        "notification_outcomes": tool_outcomes(notification_events),
        "failed_attempts": sum(event["type"] == "assistant/attempt" for event in result.events),
        "workspace": {path.name: path.read_text(encoding="utf-8") for path in sorted(tmp_path.glob("*.txt"))},
    }
    expected = Path(__file__).with_name("expected") / "tool-invalid-arguments.json"
    assert actual["final_response"] == "DONE"
    assert actual["finish_reason"] == "completed"
    if os.environ.get("DSH_SNAPSHOT") == "refresh":
        expected.write_text(json.dumps(actual, indent=2) + "\n", encoding="utf-8")
    assert actual == json.loads(expected.read_text(encoding="utf-8"))
