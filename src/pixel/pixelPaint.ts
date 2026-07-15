/**
 * Unified document paint API — one entry for 2D panel and 3D viewport strokes.
 */

import type { Rgba4 } from '../material/materialTypes'
import type { PixelBrushShape } from './pixelBrushTypes'
import type { PixelDocument } from './pixelTypes'
import { getActiveLayer } from './pixelDocument'
import {
  drawStrokeWithSymmetry,
  mirrorPixelCoords,
  paintWithSymmetry,
  rgbaToBytes,
} from './pixelTools'
import type { SoftBrushParams } from './softBrush'
import {
  beginSoftBrushStroke,
  continueSoftBrushStroke,
  paintSoftBrushDab,
  resetSoftBrushStroke,
} from './softBrush'
import { scheduleDocPreview } from './pixelPreview'
import { strokePointsDirtyRect, type PixelDirtyRect } from './pixelDirtyRect'
import type { PixelTool } from './pixelTypes'

export type DocumentPaintConfig = {
  points: readonly { x: number; y: number }[]
  color: Rgba4
  tool: PixelTool | 'eraser'
  brushSize: number
  brushShape: PixelBrushShape
  brushHardness: number
  brushOpacity: number
  brushFlow: number
  pixelPerfect: boolean
  symH: boolean
  symV: boolean
  /** Soft brush: restart spacing state (first dab of stroke). */
  restart?: boolean
  /** Upload to GPU mid-stroke (false when only 2D editor is active). */
  syncGpu?: boolean
  round?: boolean
}

function paintLiveOnActiveLayer(
  docs: Record<string, PixelDocument>,
  docId: string,
  paint: (pixels: Uint8ClampedArray, doc: PixelDocument) => PixelDirtyRect | null,
  syncGpu = true
): boolean {
  const doc = docs[docId]
  if (!doc) return false
  const layer = getActiveLayer(doc)
  if (!layer) return false
  const dirty = paint(layer.pixels, doc)
  scheduleDocPreview(docs, docId, dirty, { gpu: syncGpu })
  return true
}

/** Apply a paint stroke to the active layer in-place (no Zustand publish). */
export function applyDocumentPaint(
  docs: Record<string, PixelDocument>,
  docId: string,
  config: DocumentPaintConfig
): void {
  const {
    points,
    color,
    tool,
    brushSize,
    brushShape,
    brushHardness,
    brushOpacity,
    brushFlow,
    pixelPerfect,
    symH,
    symV,
    restart,
    syncGpu = true,
    round = true,
  } = config
  if (points.length === 0) return

  if (tool === 'paintBrush') {
    if (restart) resetSoftBrushStroke()
    const brushColor = rgbaToBytes(color) as [number, number, number, number]
    const params: SoftBrushParams = {
      size: brushSize,
      hardness: brushHardness,
      opacity: brushOpacity,
      flow: brushFlow,
      shape: brushShape,
    }
    paintLiveOnActiveLayer(
      docs,
      docId,
      (pixels, doc) => {
        const stampMirrors =
          symH || symV
            ? (px: number, py: number) => {
                for (const c of mirrorPixelCoords(px, py, doc.width, doc.height, symH, symV)) {
                  if (Math.abs(c.x - px) < 1e-6 && Math.abs(c.y - py) < 1e-6) continue
                  paintSoftBrushDab(pixels, doc.width, doc.height, c.x, c.y, brushColor, params, false)
                }
              }
            : undefined

        const first = points[0]!
        if (points.length === 1 || restart) {
          beginSoftBrushStroke(
            pixels,
            doc.width,
            doc.height,
            first.x,
            first.y,
            brushColor,
            params,
            false,
            stampMirrors
          )
          for (let i = 1; i < points.length; i++) {
            const p = points[i]!
            continueSoftBrushStroke(
              pixels,
              doc.width,
              doc.height,
              p.x,
              p.y,
              brushColor,
              params,
              false,
              stampMirrors
            )
          }
        } else {
          for (let i = 0; i < points.length; i++) {
            const p = points[i]!
            continueSoftBrushStroke(
              pixels,
              doc.width,
              doc.height,
              p.x,
              p.y,
              brushColor,
              params,
              false,
              stampMirrors
            )
          }
        }
        return strokePointsDirtyRect(
          points,
          brushSize,
          doc.width,
          doc.height,
          symH,
          symV,
          true
        )
      },
      syncGpu
    )
    return
  }

  const hardTool = tool === 'eraser' ? 'eraser' : 'pencil'
  const bytes =
    hardTool === 'eraser'
      ? ([0, 0, 0, 0] as [number, number, number, number])
      : rgbaToBytes(color)

  if (points.length === 1) {
    const p = points[0]!
    paintLiveOnActiveLayer(
      docs,
      docId,
      (pixels, doc) => {
        const fx = Math.floor(p.x)
        const fy = Math.floor(p.y)
        paintWithSymmetry(pixels, doc.width, doc.height, fx, fy, brushSize, bytes, symH, symV, round)
        return strokePointsDirtyRect(
          [{ x: fx, y: fy }],
          brushSize,
          doc.width,
          doc.height,
          symH,
          symV,
          false
        )
      },
      syncGpu
    )
    return
  }

  paintLiveOnActiveLayer(
    docs,
    docId,
    (pixels, doc) => {
      const floored = points.map((p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) }))
      drawStrokeWithSymmetry(
        pixels,
        doc.width,
        doc.height,
        floored,
        brushSize,
        bytes,
        pixelPerfect,
        symH,
        symV,
        round
      )
      return strokePointsDirtyRect(floored, brushSize, doc.width, doc.height, symH, symV, false)
    },
    syncGpu
  )
}

export { resetSoftBrushStroke } from './softBrush'
