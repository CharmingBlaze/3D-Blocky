import { useAppStore } from '../store/appStore'
import { THEMES, type ThemeGroup, type ThemeId } from '../theme/themes'

const THEME_GROUPS: ThemeGroup[] = ['Classic', 'Game Systems']

export function ThemePicker() {
  const themeId = useAppStore((s) => s.themeId)
  const setThemeId = useAppStore((s) => s.setThemeId)
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]!

  return (
    <div className="side-theme-picker">
      <ThemePickerControls
        themeId={themeId}
        setThemeId={setThemeId}
        themeName={theme.name}
        theme={theme}
      />
    </div>
  )
}

function ThemePickerControls({
  themeId,
  setThemeId,
  themeName,
  theme,
}: {
  themeId: ThemeId
  setThemeId: (id: ThemeId) => void
  themeName: string
  theme: (typeof THEMES)[number]
}) {
  return (
    <>
      <label className="theme-picker">
        <select
          className="theme-select side-select shape-kind-select"
          value={themeId}
          onChange={(e) => setThemeId(e.target.value as ThemeId)}
          aria-label="Color theme"
        >
          {THEME_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {THEMES.filter((t) => t.group === group).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="theme-preview" title={themeName} aria-hidden>
        <span className="theme-preview-swatch" style={{ background: theme.css['--accent'] }} />
        <span
          className="theme-preview-swatch"
          style={{ background: theme.css['--accent-green'] }}
        />
        <span
          className="theme-preview-swatch"
          style={{ background: theme.css['--accent-orange'] }}
        />
        <span
          className="theme-preview-swatch"
          style={{ background: theme.css['--bg-panel'] }}
        />
      </div>
    </>
  )
}

/** @deprecated Use ThemePicker instead */
export const ThemeBar = ThemePicker
