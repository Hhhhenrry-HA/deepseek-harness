/** Delivered Markdown appears in the Turn, independently of work-detail visibility. */
import { useMemo, useState } from 'react'
import { Button, MarkdownText, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DELIVERY } from './delivery-definition.ts'
import type { NS } from './locales.ts'
import css from './DeliveryRow.module.css'

/** Slot inputs of the dedicated Chat reply. */
export type DeliveredReplyProps = PropsRuntime<'conversation.chat.node', typeof DELIVERY> & PropsLocale<typeof NS>

/**
 * Render the accepted delivery with the shared Markdown typography and controls.
 * @param props - The projected Chat node and locale.
 * @returns The delivered reply.
 */
export function DeliveredReply({ node, t }: DeliveredReplyProps) {
  const labels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: {
      codeLabel: t('codeBlock.title'), wrapLabel: t('codeBlock.wrap'), unwrapLabel: t('codeBlock.unwrap'),
    } },
    footnotes: t('markdown.footnotes'),
  }), [t])
  const [copyResult, setCopyResult] = useState<'copied' | 'copyFailed'>()
  async function copyReply(): Promise<void> {
    setCopyResult(await writeClipboard(node.data.body) ? 'copied' : 'copyFailed')
  }
  return <div className={css.reply}>
    <MarkdownText text={node.data.body} labels={labels} />
    <div className={css.replyActions}>
      <Button size="sm" onClick={() => { void copyReply() }}>{t('copyReply')}</Button>
      {copyResult !== undefined && <span role="status">{t(copyResult)}</span>}
    </div>
  </div>
}
