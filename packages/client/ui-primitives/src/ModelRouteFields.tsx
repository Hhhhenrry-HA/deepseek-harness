/** Grouped model radios and their adapter-owned reasoning effort. */
import { useId } from 'react'
import type { ModelRouteCandidate } from './model-route.ts'
import css from './ModelRouteFields.module.css'

/** Locale-owned copy supplied by the consuming settings page. */
export interface ModelRouteFieldsLabels {
  title: string
  unavailable: string
  unavailableGroup: string
  effort: string
  defaultEffort: string
}

/** Plain choices and actions; directory loading and saving belong to the caller. */
export interface ModelRouteFieldsProps {
  candidates: readonly ModelRouteCandidate[]
  reasoningEffort: string | null
  disabled: boolean
  labels: ModelRouteFieldsLabels
  defaultChoice?: { label: string; selected: boolean }
  onSelect: (key: string | null) => void
  onEffort: (effort: string | null) => void
}

/**
 * Render exact routes, retaining unavailable saved choices, and effort for the selected route.
 * @param props - Localized labels, current candidates, and staged-edit callbacks.
 * @returns A grouped radio selector with an optional default route and reasoning-effort select.
 */
export function ModelRouteFields(props: ModelRouteFieldsProps) {
  const groupName = useId()
  const effortId = useId()
  const { candidates, labels, disabled } = props
  const groups = new Map<string, { name: string; candidates: ModelRouteCandidate[] }>()
  const unavailable: ModelRouteCandidate[] = []
  for (const candidate of candidates) {
    if (!candidate.available) { unavailable.push(candidate); continue }
    const group = groups.get(candidate.provider)
    if (group === undefined) groups.set(candidate.provider, { name: candidate.providerName, candidates: [candidate] })
    else group.candidates.push(candidate)
  }
  const selected = candidates.find(candidate => candidate.selected)
  const renderCandidate = (candidate: ModelRouteCandidate) => (
    <label key={candidate.key} className={css.model}>
      <input type="radio" name={groupName} checked={candidate.selected} disabled={disabled}
        onChange={() => { props.onSelect(candidate.key) }} />
      <span className={css.nameCell}>
        <span className={css.modelName}>{candidate.modelName}</span>
        <span className={css.route}>
          {`${candidate.providerName} · ${candidate.provider}/${candidate.model}`}
        </span>
      </span>
      {!candidate.available ? <span className={css.unavailable}>{labels.unavailable}</span> : null}
    </label>
  )
  return (
    <div className={css.selection}>
      <fieldset className={css.models}>
        <legend>{labels.title}</legend>
        {props.defaultChoice === undefined ? null : (
          <label className={css.model}>
            <input type="radio" name={groupName} checked={props.defaultChoice.selected} disabled={disabled}
              onChange={() => { props.onSelect(null) }} />
            <span className={css.modelName}>{props.defaultChoice.label}</span>
          </label>
        )}
        {[...groups].map(([provider, group]) => (
          <div key={provider} className={css.modelGroup}>
            <div className={css.providerName}>{group.name}</div>
            {group.candidates.map(renderCandidate)}
          </div>
        ))}
        {unavailable.length === 0 ? null : (
          <div className={css.modelGroup}>
            <div className={css.providerName}>{labels.unavailableGroup}</div>
            {unavailable.map(renderCandidate)}
          </div>
        )}
      </fieldset>
      {selected === undefined || (selected.efforts.length === 0 && props.reasoningEffort === null) ? null : (
        <div className={css.effort}>
          <label htmlFor={effortId}>{labels.effort}</label>
          <select id={effortId} value={props.reasoningEffort ?? ''} disabled={disabled}
            onChange={(event) => { props.onEffort(event.target.value || null) }}>
            <option value="">{labels.defaultEffort}</option>
            {props.reasoningEffort !== null && !selected.efforts.some(effort => effort.id === props.reasoningEffort)
              ? <option value={props.reasoningEffort}>{props.reasoningEffort} · {labels.unavailable}</option> : null}
            {selected.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}
