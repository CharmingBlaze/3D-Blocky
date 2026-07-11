import { isLightHex } from './colorUtils'
import { getTheme, type ThemeId } from './themes'

export function applyTheme(themeId: ThemeId): void {
  const root = document.documentElement
  const { css } = getTheme(themeId)
  for (const [key, value] of Object.entries(css)) {
    root.style.setProperty(key, value)
  }
  root.dataset.theme = themeId
  // Drive contrast-aware chrome: light panels get dark text, dark panels get light text.
  const light = isLightHex(css['--bg-panel'])
  root.dataset.themeContrast = light ? 'light' : 'dark'
  // Match OS overlay scrollbars + form controls to theme brightness.
  root.style.colorScheme = light ? 'light' : 'dark'
}
