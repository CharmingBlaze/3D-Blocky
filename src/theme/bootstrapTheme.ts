import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from './themes'

const THEME_STORAGE_KEY = 'lpo-theme'

export function readStoredThemeId(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored && isThemeId(stored)) return stored
  } catch {
    /* ignore */
  }
  // Fresh installs and cleared storage always start on Quadlo Pro.
  return DEFAULT_THEME_ID
}
