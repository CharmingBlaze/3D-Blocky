interface MarqueeOverlayProps {
  rect: { x0: number; y0: number; x1: number; y1: number } | null
}

export function MarqueeOverlay({ rect }: MarqueeOverlayProps) {
  if (!rect) return null
  const left = Math.min(rect.x0, rect.x1)
  const top = Math.min(rect.y0, rect.y1)
  const width = Math.abs(rect.x1 - rect.x0)
  const height = Math.abs(rect.y1 - rect.y0)
  if (width < 2 && height < 2) return null

  return (
    <div
      className="marquee-overlay"
      style={{ left, top, width, height }}
    />
  )
}
