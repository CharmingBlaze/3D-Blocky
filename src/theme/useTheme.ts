import { useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { darkenHex } from './colorUtils'
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
  /** Edit/draw vertex handles — derived from theme mesh/accent colors, slightly darkened. */
  vertexIdle: string
  vertexIdleBorder: string
  vertexHover: string
  vertexHoverBorder: string
  vertexSelected: string
  vertexSelectedBorder: string
  vertexDraft: string
  vertexDraftHover: string
  /** Object selection outline — primary / multi-select secondary. */
  objectSelectOutline: string
  objectSelectOutlineSecondary: string
  /** Edge selection overlay (idle / hover / selected). */
  edgeIdle: string
  edgeHover: string
  edgeSelected: string
  /** Face selection overlay fill and boundary wire. */
  faceIdleFill: string
  faceIdleWire: string
  faceHoverFill: string
  faceHoverWire: string
  faceSelectedFill: string
  faceSelectedWire: string
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
      vertexIdle: darkenHex(css['--mesh-outline-secondary'], 0.22),
      vertexIdleBorder: darkenHex(css['--mesh-outline'], 0.32),
      vertexHover: darkenHex(css['--mesh-hover'], 0.24),
      vertexHoverBorder: darkenHex(css['--accent-orange'], 0.22),
      vertexSelected: darkenHex(css['--mesh-selected'], 0.2),
      vertexSelectedBorder: darkenHex(css['--accent'], 0.36),
      vertexDraft: darkenHex(css['--accent'], 0.24),
      vertexDraftHover: darkenHex(css['--mesh-hover'], 0.28),
      // Object pick outline follows --mesh-selected (theme accent), not wireframe --mesh-outline
      objectSelectOutline: css['--mesh-selected'],
      objectSelectOutlineSecondary: darkenHex(css['--mesh-selected'], 0.28),
      edgeIdle: darkenHex(css['--mesh-outline-secondary'], 0.28),
      edgeHover: darkenHex(css['--accent-green'], 0.22),
      edgeSelected: darkenHex(css['--accent'], 0.24),
      faceIdleFill: darkenHex(css['--mesh-outline-secondary'], 0.38),
      faceIdleWire: darkenHex(css['--mesh-outline'], 0.3),
      faceHoverFill: darkenHex(css['--mesh-hover'], 0.26),
      faceHoverWire: darkenHex(css['--accent-orange'], 0.22),
      faceSelectedFill: darkenHex(css['--accent-orange'], 0.16),
      faceSelectedWire: darkenHex(css['--accent'], 0.34),
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
