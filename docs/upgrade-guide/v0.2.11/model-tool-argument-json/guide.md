---
kind: upgrade-guide
description: "Model tool calls reject empty, malformed, and non-object JSON argument strings instead of passing them to tools."
---
# Use JSON objects for model tool-call arguments

English | [中文](guide.zh.md)

## Change

Model-originated tool calls require exactly one JSON object. Empty argument strings no longer become `{}`, and malformed or non-object JSON no longer reaches a tool that might reinterpret it. Each rejected call receives an `INVALID_ARGS` result; valid sibling calls still execute and the model can continue. Custom LLM adapters and tools that relied on empty or scalar model arguments are affected. Direct programmatic tool execution is unchanged.

## Migration

1. In custom adapters, set `ToolCallBlock.arguments` to a JSON object string. Use `JSON.stringify(args)` for object arguments and `'{}'` for a zero-argument call, not an empty string.
2. If a tool accepts scalar input, declare an object parameter such as `input` in its tool schema and pass `{"input":"value"}`. Read that field in the executor instead of expecting a scalar at the top level.
3. Test one valid call beside one malformed call. Confirm that the valid body runs once, the malformed body never runs, and the next model request contains the individual success and `INVALID_ARGS` results. Existing Session logs and user configuration require no migration. See the [agent-loop argument rules](../../../../packages/core/agent-loop/README.md).
