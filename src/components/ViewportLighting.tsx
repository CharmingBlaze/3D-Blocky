import { useAppStore } from '../store/appStore'
import { VIEWPORT_DISPLAY_CONFIG } from '../rendering/viewportDisplay'
import { useTheme } from '../theme/useTheme'

export function ViewportLighting() {
  const mode = useAppStore((s) => s.viewportDisplayMode)
  const cfg = VIEWPORT_DISPLAY_CONFIG[mode]
  const { text, css } = useTheme()
  const sky = text
  const ground = css['--viewport-bg-deep']
  const fill = css['--grid-section']

  if (!cfg.gameLighting && mode === 'unlit') {
    return null
  }

  if (mode === 'model') {
    return (
      <>
        <ambientLight intensity={0.85} />
        <hemisphereLight color={sky} groundColor={ground} intensity={0.45} />
        <directionalLight position={[100, 150, 80]} intensity={0.65} />
        <directionalLight position={[-80, 60, -100]} intensity={0.2} />
      </>
    )
  }

  if (cfg.gameLighting) {
    return (
      <>
        <ambientLight intensity={0.72} />
        <hemisphereLight color={sky} groundColor={ground} intensity={0.55} />
        <directionalLight position={[80, 120, 60]} intensity={0.45} color={text} />
        <directionalLight position={[-40, 40, -80]} intensity={0.12} color={fill} />
      </>
    )
  }

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[100, 150, 80]} intensity={0.9} />
      <directionalLight position={[-80, -50, -100]} intensity={0.3} />
    </>
  )
}
