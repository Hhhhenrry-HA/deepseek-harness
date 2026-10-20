import { LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'

/** Deterministic provider I/O with exact-model reasoning defaults and request receipts. */
export class SelectionAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (model === 'missing') return Promise.reject(new LlmError('model unavailable', 'MODEL_NOT_FOUND'))
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 2_000 },
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('low'),
      },
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'checkpoint' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
