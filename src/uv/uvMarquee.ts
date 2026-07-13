export type Point2 = { x: number; y: number }

export type MarqueeRect = { x0: number; y0: number; x1: number; y1: number }

function normalized(rect: MarqueeRect) {
  return {
    minX: Math.min(rect.x0, rect.x1),
    minY: Math.min(rect.y0, rect.y1),
    maxX: Math.max(rect.x0, rect.x1),
    maxY: Math.max(rect.y0, rect.y1),
  }
}

function pointInRect(point: Point2, rect: ReturnType<typeof normalized>): boolean {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
}

function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-12) + a.x
    ) {
      inside = !inside
    }
  }
  return inside
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  const epsilon = 1e-9
  if (Math.abs(o1) <= epsilon && pointInRect(c, normalized({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }))) return true
  if (Math.abs(o2) <= epsilon && pointInRect(d, normalized({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }))) return true
  if (Math.abs(o3) <= epsilon && pointInRect(a, normalized({ x0: c.x, y0: c.y, x1: d.x, y1: d.y }))) return true
  if (Math.abs(o4) <= epsilon && pointInRect(b, normalized({ x0: c.x, y0: c.y, x1: d.x, y1: d.y }))) return true
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)
}

/** True for containment in either direction or any polygon/rectangle edge crossing. */
export function polygonIntersectsMarquee(polygon: Point2[], marquee: MarqueeRect): boolean {
  if (polygon.length < 3) return false
  const rect = normalized(marquee)
  if (polygon.some((point) => pointInRect(point, rect))) return true

  const corners: Point2[] = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ]
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    for (let j = 0; j < corners.length; j++) {
      if (segmentsIntersect(a, b, corners[j]!, corners[(j + 1) % corners.length]!)) return true
    }
  }
  return false
}
