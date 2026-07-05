import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore, type ActiveTool, type ViewType } from '../store/appStore'
import type { ReferenceImage } from '../images/imageDropTypes'

const IMAGE_EDIT_TOOLS: ActiveTool[] = ['select-object', 'move', 'rotate', 'scale']

interface ReferenceImageOverlayProps {
  view: ViewType
  containerRef: React.RefObject<HTMLDivElement | null>
}

type DragKind = 'move' | 'resize'

export function ReferenceImageOverlay({ view, containerRef }: ReferenceImageOverlayProps) {
  const referenceImages = useAppStore((s) => s.referenceImages)
  const selectedReferenceImageId = useAppStore((s) => s.selectedReferenceImageId)
  const imageDropMode = useAppStore((s) => s.imageDropMode)
  const activeTool = useAppStore((s) => s.activeTool)
  const selectReferenceImage = useAppStore((s) => s.selectReferenceImage)
  const updateReferenceImage = useAppStore((s) => s.updateReferenceImage)
  const commitReferenceImageEdit = useAppStore((s) => s.commitReferenceImageEdit)

  const [layoutTick, setLayoutTick] = useState(0)
  const dragRef = useRef<{
    id: string
    kind: DragKind
    startX: number
    startY: number
    snapshot: ReferenceImage
  } | null>(null)
  const movedRef = useRef(false)

  const viewImages = referenceImages.filter((img) => img.view === view)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const bump = () => setLayoutTick((n) => n + 1)
    const observer = new ResizeObserver(bump)
    observer.observe(el)
    window.addEventListener('resize', bump)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', bump)
    }
  }, [containerRef])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag || !containerRef.current) return
      e.preventDefault()
      e.stopPropagation()
      movedRef.current = true

      const bounds = containerRef.current.getBoundingClientRect()
      const dx = (e.clientX - drag.startX) / bounds.width
      const dy = (e.clientY - drag.startY) / bounds.height
      const snap = drag.snapshot

      if (drag.kind === 'move') {
        updateReferenceImage(drag.id, {
          x: snap.x + dx,
          y: snap.y + dy,
        })
        return
      }

      const nextWidth = Math.max(0.08, snap.width + dx)
      updateReferenceImage(drag.id, { width: nextWidth })
    },
    [containerRef, updateReferenceImage]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return
      const didMove = movedRef.current
      dragRef.current = null
      movedRef.current = false
      e.currentTarget.releasePointerCapture(e.pointerId)
      if (didMove) commitReferenceImageEdit()
    },
    [commitReferenceImageEdit]
  )

  if (viewImages.length === 0 && imageDropMode !== 'reference') return null

  const canEdit =
    IMAGE_EDIT_TOOLS.includes(activeTool) || imageDropMode === 'reference'

  const rect = containerRef.current?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null

  void layoutTick

  const beginDrag = (
    e: React.PointerEvent,
    img: ReferenceImage,
    kind: DragKind
  ) => {
    if (!canEdit) return
    e.preventDefault()
    e.stopPropagation()
    selectReferenceImage(img.id)
    movedRef.current = false
    dragRef.current = {
      id: img.id,
      kind,
      startX: e.clientX,
      startY: e.clientY,
      snapshot: { ...img },
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  return (
    <div
      className="reference-image-layer"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {viewImages.map((img) => {
        const selected = img.id === selectedReferenceImageId
        const heightFrac = img.width / img.aspect / (rect.width / rect.height)
        const left = (img.x - img.width / 2) * 100
        const top = (img.y - heightFrac / 2) * 100

        return (
          <div
            key={img.id}
            className={`reference-image-item${selected ? ' selected' : ''}`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${img.width * 100}%`,
              aspectRatio: String(img.aspect),
              opacity: img.opacity,
              zIndex: selected ? 4 : 2,
              pointerEvents: canEdit ? 'auto' : 'none',
              cursor: canEdit ? 'move' : 'default',
            }}
            onPointerDown={(e) => beginDrag(e, img, 'move')}
            onClick={(e) => {
              if (!canEdit) return
              e.stopPropagation()
              selectReferenceImage(img.id)
            }}
          >
            <img src={img.url} alt={img.name} draggable={false} />
            {selected && (
              <>
                <div
                  className="reference-image-handle"
                  title="Drag to resize"
                  onPointerDown={(e) => beginDrag(e, img, 'resize')}
                />
                <span className="reference-image-label">{img.name}</span>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
