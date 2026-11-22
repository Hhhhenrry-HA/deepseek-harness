/** Display delivery activity without duplicating the final reply body. */
import { Button, DisclosureRow, IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { NS } from './locales.ts'
import css from './DeliveryRow.module.css'

/** Slot inputs for one delivery call. */
export type DeliveryRowProps = ToolCallViewProps & PropsLocale<typeof NS>

function hasDeliveredBody(meta: unknown): boolean {
  return typeof meta === 'object' && meta !== null && 'kind' in meta
    && meta.kind === 'deliver-response' && 'body' in meta && typeof meta.body === 'string'
}

/**
 * Show call status and diagnostics without revealing uncommitted arguments.
 * @param props - Current call phase, result, and locale from the tool slot.
 * @returns A compact status row.
 */
export function DeliveryRow(props: DeliveryRowProps) {
  const { t, inspect, useDisclosure } = props
  const { expanded, toggle } = useDisclosure()
  const result = props.phase === 'result' ? props.block : undefined
  const title = result === undefined ? t('pending') : result.error?.code === 'interrupted' ? t('stopped')
    : result.isError ? t('failed') : hasDeliveredBody(result.meta) ? t('delivered') : t('bodyUnavailable')
  const details = result?.content.flatMap(item => item.type === 'text' ? [item.text] : []).join('\n')
    || result?.error?.reason || result?.error?.code
  const expandable = Boolean(details) || inspect !== undefined
  return <DisclosureRow title={title} icon={<IconDeliverDocRegular size={14} />}
    open={expanded && expandable} expandable={expandable} onToggle={toggle} running={result === undefined} expandOnRowClick>
    {details && <pre className={css.details}>{details}</pre>}
    {inspect !== undefined && <Button size="sm" onClick={inspect}>{t('inspect')}</Button>}
  </DisclosureRow>
}
