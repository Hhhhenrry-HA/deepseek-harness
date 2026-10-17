/** Local submission state shared by edit/resend and last-turn regeneration. */
import { useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { SessionRestartRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { ChatKey } from '../locale.ts'

/** Registration-owned command callback; components never receive the Remote service. */
export interface MessageRestartInjected {
  /** Submit a restart and return a typed rejection, or null after admission. */
  restartMessage: (request: SessionRestartRequest) => Promise<RemoteFailure | null>
}

/**
 * Keep a draft's request identity across uncertain transport failures.
 * @param restart - registration-owned Remote callback.
 * @returns local pending/error state and the guarded submission action.
 */
export function useMessageRestart(restart: MessageRestartInjected['restartMessage']) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ChatKey | null>(null)
  const active = useRef(false)
  const attempt = useRef<{ signature: string; id: SessionRequestId } | null>(null)
  const submit = async (request: Omit<SessionRestartRequest, 'requestId'>): Promise<void> => {
    if (active.current) return
    active.current = true
    setPending(true)
    setError(null)
    const signature = JSON.stringify(request)
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, id: randomUUID() as SessionRequestId }
    }
    try {
      const failure = await restart({ ...request, requestId: attempt.current.id })
      if (failure === null) {
        attempt.current = null
      } else {
        setError(failure.code === 'session/agent-busy' ? 'message.restart.busy'
          : failure.code === 'session/restart-unavailable' ? 'message.restart.unavailable'
            : 'message.restart.failed')
      }
    } catch {
      // The outcome is unknown; retain the same id so a repeated click is idempotent.
      setError('message.restart.failed')
    } finally {
      active.current = false
      setPending(false)
    }
  }
  return { pending, error, submit }
}
