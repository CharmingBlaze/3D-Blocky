import { APP_NAME } from '../app/branding'

/** Compact Quadlo mark: Q inside a lined box (matches app icon). */
export function AppBrandMark({
  className = '',
  showLabel = true,
}: {
  className?: string
  showLabel?: boolean
}) {
  return (
    <span className={`app-brand-mark ${className}`.trim()} title={APP_NAME} aria-label={APP_NAME}>
      <img
        className="app-brand-mark-icon"
        src="./brand-mark.png"
        width={18}
        height={18}
        alt=""
        draggable={false}
      />
      {showLabel ? <span className="app-brand-mark-label">{APP_NAME}</span> : null}
    </span>
  )
}
