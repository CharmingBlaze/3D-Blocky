import { ViewportViewPicker } from '../ViewportViewPicker'
import type { SelectableViewType, ViewType } from '../../scene/viewTypes'

export function ViewportStats({
  view,
  statsLabel,
  onSelectView,
}: {
  view: ViewType
  statsLabel: string
  onSelectView: (next: SelectableViewType) => void
}) {
  return (
    <div className="viewport-view-chrome">
      <span className="viewport-stats">{statsLabel}</span>
      <ViewportViewPicker view={view} onSelect={onSelectView} />
    </div>
  )
}
