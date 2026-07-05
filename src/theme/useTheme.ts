import { useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { getTheme, hexToNumber, type ThemeCssVars } from './themes'

export interface ThemeColors {
  css: ThemeCssVars
  accent: string
  accentNum: number
  accentGreen: string
  accentGreenNum: number
  accentOrange: string
  accentOrangeNum: number
  accentPink: string
  accentPinkNum: number
  danger: string
  dangerNum: number
  text: string
  textMuted: string
  bgPanel: string
  bgDark: string
  meshOutline: string
  meshOutlineSecondary: string
  meshSelected: string
  meshHover: string
  symmetryPlane: string
  gridCell: string
  gridSection: string
  uvCanvasBg: string
  uvGridA: string
  uvGridB: string
  /** Viewport axis line colors (X/Y/Z). */
  axisX: string
  axisY: string
  axisZ: string
}

export function useTheme(): ThemeColors {
  const themeId = useAppStore((s) => s.themeId)
  return useMemo(() => {
    const css = getTheme(themeId).css
    return {
      css,
      accent: css['--accent'],
      accentNum: hexToNumber(css['--accent']),
      accentGreen: css['--accent-green'],
      accentGreenNum: hexToNumber(css['--accent-green']),
      accentOrange: css['--accent-orange'],
      accentOrangeNum: hexToNumber(css['--accent-orange']),
      accentPink: css['--accent-pink'],
      accentPinkNum: hexToNumber(css['--accent-pink']),
      danger: css['--danger'],
      dangerNum: hexToNumber(css['--danger']),
      text: css['--text'],
      textMuted: css['--text-muted'],
      bgPanel: css['--bg-panel'],
      bgDark: css['--bg-dark'],
      meshOutline: css['--mesh-outline'],
      meshOutlineSecondary: css['--mesh-outline-secondary'],
      meshSelected: css['--mesh-selected'],
      meshHover: css['--mesh-hover'],
      symmetryPlane: css['--symmetry-plane'],
      gridCell: css['--grid-cell'],
      gridSection: css['--grid-section'],
      uvCanvasBg: css['--uv-canvas-bg'],
      uvGridA: css['--uv-grid-a'],
      uvGridB: css['--uv-grid-b'],
      axisX: css['--accent-pink'],
      axisY: css['--accent-green'],
      axisZ: css['--accent'],
    }
  }, [themeId])
}
