import { SideButtonDropdown } from './SideButtonDropdown'
import { useAppStore } from '../store/appStore'
import { THEMES, getTheme, type ThemeGroup, type ThemeId } from '../theme/themes'

const THEME_GROUPS: ThemeGroup[] = [
  'Classic',
  'Studio',
  'Movie Screens',
  'Game Systems',
  'Operating Systems',
  'pixaCAD',
]

const THEME_OPTIONS = THEME_GROUPS.flatMap((group) =>
  THEMES.filter((t) => t.group === group).map((t) => ({
    value: t.id,
    label: t.name,
    group,
  }))
)

export function ThemePicker() {
  const themeId = useAppStore((s) => s.themeId)
  const setThemeId = useAppStore((s) => s.setThemeId)
  const theme = getTheme(themeId)
  const css = theme.css

  return (
    <div className="side-theme-picker">
      <SideButtonDropdown
        className="side-theme-dropdown"
        label="Theme"
        value={themeId}
        options={THEME_OPTIONS}
        onSelect={(id) => setThemeId(id as ThemeId)}
        title={`Theme: ${theme.name}`}
        active
        menuClassName="side-theme-dropdown-menu themed-scroll"
        leading={
          <span
            className="theme-trigger-swatch"
            style={{ background: css['--accent'] }}
            aria-hidden
          />
        }
        footer={
          <div className="theme-preview-card" aria-hidden>
            <div
              className="theme-preview-stage"
              style={{
                background: `linear-gradient(135deg, ${css['--bg-dark']} 0%, ${css['--bg-panel']} 55%, ${css['--bg-hover']} 100%)`,
                borderColor: css['--border'],
              }}
            >
              <span className="theme-preview-dot" style={{ background: css['--accent'] }} />
              <span className="theme-preview-dot" style={{ background: css['--accent-green'] }} />
              <span className="theme-preview-dot" style={{ background: css['--accent-orange'] }} />
              <span
                className="theme-preview-chip"
                style={{
                  background: css['--accent-soft'],
                  color: css['--accent'],
                  borderColor: css['--accent'],
                }}
              >
                {theme.name}
              </span>
            </div>
          </div>
        }
      />
    </div>
  )
}

/** @deprecated Use ThemePicker instead */
export const ThemeBar = ThemePicker
