/** Incremental text visibility and strict parsing of the terminal tool-call section. */

import { LlmError } from '@deepseek-ai/dsh-llm'
import { TOOL_CALL_CLOSE, TOOL_CALL_OPEN } from './tagged-json-protocol.ts'

/** One validated call ready for the existing tool executor. */
export interface TaggedCall {
  name: string
  arguments: string
}

/** Non-transient failure for an invalid model-generated call section. */
export const TOOL_PROTOCOL_INVALID_CODE = 'TOOL_PROTOCOL_INVALID'

function invalid(detail: string, cause?: unknown): never {
  throw new LlmError(`Tool-call JSON is invalid: ${detail}. No tools from this response were executed; retry the response.`, TOOL_PROTOCOL_INVALID_CODE, { cause })
}

/** Decode one whole terminal section, so a later malformed call cannot leave earlier calls executable. */
function parseCalls(text: string, names: ReadonlySet<string>): TaggedCall[] {
  const calls: TaggedCall[] = []
  let remaining = text.trim()
  while (remaining.length > 0) {
    if (!remaining.startsWith(TOOL_CALL_OPEN)) invalid('expected a tool call')
    remaining = remaining.slice(TOOL_CALL_OPEN.length).trimStart()
    if (!remaining.startsWith('{')) invalid('expected an object')
    let depth = 0
    let quoted = false
    let escaped = false
    let end = -1
    for (let index = 0; index < remaining.length; index++) {
      const char = remaining[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === '{' || char === '[') depth++
      else if (char === '}' || char === ']') {
        depth--
        if (depth === 0) { end = index + 1; break }
      }
    }
    if (end === -1) invalid('incomplete object')
    let value: unknown
    try { value = JSON.parse(remaining.slice(0, end)) }
    catch (error) { invalid('invalid JSON', error) }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('expected an object')
    const call = value as Record<string, unknown>
    if (Object.keys(call).some(key => key !== 'name' && key !== 'arguments')) invalid('expected only name and arguments')
    if (typeof call['name'] !== 'string' || !names.has(call['name'])) invalid('unknown tool name')
    const args = call['arguments']
    if (typeof args !== 'object' || args === null || Array.isArray(args)) invalid('arguments must be an object')
    remaining = remaining.slice(end).trimStart()
    if (!remaining.startsWith(TOOL_CALL_CLOSE)) invalid('missing closing tag')
    remaining = remaining.slice(TOOL_CALL_CLOSE.length).trimStart()
    calls.push({ name: call['name'], arguments: JSON.stringify(args) })
  }
  return calls
}

/** One response's temporary parser; only text outside a fenced code example can start calls. */
export class TaggedJsonParser {
  private pending = ''
  private tail: string | undefined
  private lineStart = true
  private fence: { char: string; length: number } | undefined

  /**
   * Accept one ordinary-text delta.
   * @param text - next text fragment from the model.
   * @returns prose that cannot belong to the terminal call section.
   */
  push(text: string): string {
    if (this.tail !== undefined) { this.tail += text; return '' }
    this.pending += text
    return this.drain(false)
  }

  private drain(final: boolean): string {
    let visible = ''
    while (this.pending.length > 0) {
      if (this.lineStart) {
        const indent = this.pending.match(/^ {0,3}/)?.[0] ?? ''
        const head = this.pending.slice(indent.length)
        if (!final && (head.length === 0 || (this.fence === undefined && TOOL_CALL_OPEN.startsWith(head)))) break
        if (this.fence === undefined && head.startsWith(TOOL_CALL_OPEN)) {
          this.tail = head
          this.pending = ''
          break
        }
        if (final && this.fence === undefined && head.startsWith('<tool_') && TOOL_CALL_OPEN.startsWith(head)) invalid('incomplete opening tag')
        const marker = head.match(/^(`+|~+)/)?.[0]
        if (marker !== undefined) {
          // A fence only opens/closes once the complete header line is known.
          if (!final && marker.length >= 3 && !head.includes('\n')) break
          if (!final && marker.length === head.length) break
          if (marker.length >= 3) {
            if (this.fence === undefined) this.fence = { char: marker[0] as string, length: marker.length }
            else if (marker[0] === this.fence.char && marker.length >= this.fence.length
              && /^\s*(?:\n|$)/.test(head.slice(marker.length))) this.fence = undefined
          }
        }
        this.lineStart = false
      }
      const newline = this.pending.indexOf('\n')
      const end = newline === -1 ? this.pending.length : newline + 1
      visible += this.pending.slice(0, end)
      this.pending = this.pending.slice(end)
      if (newline !== -1) this.lineStart = true
    }
    return visible
  }

  /**
   * Finish only a successfully completed model response; failures never submit calls.
   * @param names - active tool names allowed in this request.
   * @returns remaining prose and the complete validated call list.
   */
  finish(names: ReadonlySet<string>): { text: string; calls: TaggedCall[] } {
    const text = this.drain(true)
    return { text, calls: this.tail === undefined ? [] : parseCalls(this.tail, names) }
  }
}
