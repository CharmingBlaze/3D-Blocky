import { getTheme, type ThemeId } from './themes'

export function applyTheme(themeId: ThemeId): void {
  const root = document.documentElement
  const { css } = getTheme(themeId)
  for (const [key, value] of Object.entries(css)) {
    root.style.setProperty(key, value)
  }
  root.dataset.theme = themeId
}
