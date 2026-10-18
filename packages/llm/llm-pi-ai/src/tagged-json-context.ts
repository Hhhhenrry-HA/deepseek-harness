/** Project pi-ai history to text tool calls while retaining its normal image conversion. */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmRequestFormat } from '@deepseek-ai/dsh-llm'
import type { Context, Message, TextContent } from '@earendil-works/pi-ai'
import { protocolJson, TAGGED_JSON_FORMAT, TOOL_CALL_CLOSE, TOOL_CALL_OPEN, TOOL_RESULT_CLOSE, TOOL_RESULT_OPEN } from './tagged-json-protocol.ts'

/**
 * Remove every native declaration, call, and result from one wire context.
 * @param context - native conversion, including resolved request images.
 * @param format - exact instructions captured in the durable request header.
 * @returns a context containing only text/image messages and no native tools.
 */
export function taggedJsonContext(context: Context, format: LlmRequestFormat): Context {
  if (format.id !== TAGGED_JSON_FORMAT.id || format.version !== TAGGED_JSON_FORMAT.version) {
    throw new LlmError('This tool-call format is not supported by this adapter version', 'UNSUPPORTED_TOOL_FORMAT')
  }
  const messages: Message[] = []
  for (const message of context.messages) {
    switch (message.role) {
      case 'assistant': {
        const content = message.content.map(block => block.type === 'toolCall'
          ? { type: 'text' as const, text: `\n${TOOL_CALL_OPEN}${protocolJson({ id: block.id, name: block.name, arguments: block.arguments })}${TOOL_CALL_CLOSE}` }
          : block)
        messages.push({ ...message, content, stopReason: 'stop' })
        break
      }
      case 'toolResult': {
        const text: TextContent = {
          type: 'text',
          text: `${TOOL_RESULT_OPEN}${protocolJson({
            id: message.toolCallId,
            name: message.toolName,
            isError: message.isError,
            content: message.content.filter(block => block.type === 'text').map(block => block.text).join(''),
          })}${TOOL_RESULT_CLOSE}`,
        }
        const images = message.content.filter(block => block.type === 'image')
        messages.push({ role: 'user', content: images.length === 0 ? text.text : [text, ...images], timestamp: message.timestamp })
        break
      }
      case 'system': {
        if (message.toolsAdded !== undefined || message.toolsRemoved !== undefined) {
          throw new LlmError('Text tool mode requires complete tool declarations, not native tool updates', 'INVALID_REQUEST')
        }
        messages.push(message)
        break
      }
      case 'user':
        messages.push(message)
        break
    }
  }
  const tools = context.tools ?? []
  const systemPrompt = tools.length === 0 ? context.systemPrompt : [
    context.systemPrompt,
    format.instructions,
    protocolJson(tools),
  ].filter(Boolean).join('\n\n')
  return { ...systemPrompt === undefined ? {} : { systemPrompt }, messages }
}
