/** Turn text protocol output into the same guarded tool-call stream as native adapters. */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, StreamChunk, ToolCallId, ToolSchema, TokenUsage } from '@deepseek-ai/dsh-llm'
import { TaggedJsonParser, TOOL_PROTOCOL_INVALID_CODE } from './tagged-json-parser.ts'

/**
 * Keep prose streaming, but submit no tool blocks until the whole response is valid.
 * Provider failures, truncation, and cancellation preserve their original finish reason.
 * @param source - native SDK stream, requested without native tools.
 * @param tools - the currently available declarations.
 * @returns harness tool events; native block-index replay metadata is deliberately not reused.
 */
export async function* taggedJsonStream(source: AsyncIterable<StreamChunk>, tools: readonly ToolSchema[]): AsyncGenerator<StreamChunk> {
  const parser = new TaggedJsonParser()
  const names = new Set(tools.filter(tool => !tool.deferLoading).map(tool => tool.name))
  let nextIndex = 0
  let prose: { index: number; text: string } | undefined
  let usage: TokenUsage | undefined
  const indexes = new Map<number, number>()

  function* show(text: string): Generator<StreamChunk> {
    if (text.length === 0) return
    if (prose === undefined) {
      prose = { index: nextIndex++, text: '' }
      yield { type: 'block-start', index: prose.index, blockType: 'text' }
    }
    prose.text += text
    yield { type: 'text-delta', index: prose.index, text }
  }
  function* closeProse(): Generator<StreamChunk> {
    if (prose === undefined) return
    yield { type: 'block-end', index: prose.index, block: { type: 'text', text: prose.text } }
    prose = undefined
  }

  for await (const chunk of source) {
    switch (chunk.type) {
      case 'block-start':
        if (chunk.blockType === 'tool-call') throw new LlmError('The text-only tool request returned a native tool call', TOOL_PROTOCOL_INVALID_CODE)
        if (chunk.blockType !== 'text') {
          yield* closeProse()
          const index = nextIndex++
          indexes.set(chunk.index, index)
          yield { ...chunk, index }
        }
        break
      case 'text-delta':
        yield* show(parser.push(chunk.text))
        break
      case 'reasoning-delta':
        yield { ...chunk, index: indexes.get(chunk.index) as number }
        break
      case 'tool-call-delta':
        throw new LlmError('The text-only tool request returned a native tool call', TOOL_PROTOCOL_INVALID_CODE)
      case 'block-end':
        if (chunk.block.type !== 'text') yield { ...chunk, index: indexes.get(chunk.index) as number }
        break
      case 'usage':
        usage = chunk.usage
        break
      case 'finish': {
        let calls: { name: string; arguments: string }[] = []
        let reason = chunk.reason
        if (reason.kind === 'stop') {
          try {
            const parsed = parser.finish(names)
            yield* show(parsed.text)
            calls = parsed.calls
          } catch (error) {
            if (!(error instanceof LlmError)) throw error
            reason = { kind: 'error', failure: { code: error.code, message: error.message } }
          }
        }
        yield* closeProse()
        for (const call of calls) {
          const index = nextIndex++
          const block: ContentBlock = { type: 'tool-call', id: brandString<ToolCallId>(randomUUID()), ...call }
          yield { type: 'block-start', index, blockType: 'tool-call' }
          yield { type: 'block-end', index, block }
        }
        if (usage !== undefined) yield { type: 'usage', usage }
        yield { type: 'finish', reason: calls.length > 0 ? { kind: 'tool-calls' } : reason }
        return
      }
    }
  }
}
