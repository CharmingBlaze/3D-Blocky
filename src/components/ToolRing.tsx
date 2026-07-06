import { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, type ToolCategory } from '../store/appStore'
import { activeExtrudeMode } from '../stroke/drawExtrudeMode'
import {
  isToolRingEntryDisabled,
  TOOL_RING_BRANCHES,
  TOOL_RING_CATEGORIES,
  toolRingEntryKey,
  type ToolRingEntry,
} from '../tools/toolRingConfig'

interface ToolRingProps {
  onClose: () => void
}

const RING_SIZE = 440
const RING_CENTER = RING_SIZE / 2
const CATEGORY_RADIUS = 108
const CATEGORY_SIZE = 68

function categoryAngle(index: number, total: number): number {
  return -90 + (360 / total) * index
}

function polarToPosition(angleDeg: number, radius: number, size: number) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    left: Math.cos(rad) * radius + RING_CENTER - size / 2,
    top: Math.sin(rad) * radius + RING_CENTER - size / 2,
  }
}

export function ToolRing({ onClose }: ToolRingProps) {
  const {
    activeTool,
    selectionMode,
    activePrimitiveKind,
    activeShapeKind,
    strokeMode,
    polyDrawMode,
    drawInputMode,
    sketchExtrudeMode,
    penExtrudeMode,
    uvEditorOpen,
    selectionObjectIds,
    selectedObjectId,
    meshSelection,
    objects,
    clipboard,
    activateToolRingEntry,
  } = useAppStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      selectionMode: s.selectionMode,
      activePrimitiveKind: s.activePrimitiveKind,
      activeShapeKind: s.activeShapeKind,
      strokeMode: s.strokeMode,
      polyDrawMode: s.polyDrawMode,
      drawInputMode: s.drawInputMode,
      sketchExtrudeMode: s.sketchExtrudeMode,
      penExtrudeMode: s.penExtrudeMode,
      uvEditorOpen: s.uvEditorOpen,
      selectionObjectIds: s.selectionObjectIds,
      selectedObjectId: s.selectedObjectId,
      meshSelection: s.meshSelection,
      objects: s.objects,
      clipboard: s.clipboard,
      activateToolRingEntry: s.activateToolRingEntry,
    }))
  )

  const [hoveredCategory, setHoveredCategory] = useState<ToolCategory | null>(null)
  const [pinnedCategory, setPinnedCategory] = useState<ToolCategory | null>(null)

  const openCategory = pinnedCategory ?? hoveredCategory
  const openCategoryMeta = useMemo(
    () =>
      openCategory
        ? TOOL_RING_CATEGORIES.find((c) => c.id === openCategory) ?? null
        : null,
    [openCategory]
  )

  const disabledContext = useMemo(
    () => ({
      selectionMode,
      selectionObjectIds,
      selectedObjectId,
      meshSelection,
      objects,
      clipboard,
      uvEditorOpen,
    }),
    [
      selectionMode,
      selectionObjectIds,
      selectedObjectId,
      meshSelection,
      objects,
      clipboard,
      uvEditorOpen,
    ]
  )

  const isEntryActive = useCallback(
    (entry: ToolRingEntry): boolean => {
      switch (entry.kind) {
        case 'tool':
          if (entry.tool.startsWith('select-')) {
            return selectionMode === entry.selectionMode
          }
          return activeTool === entry.tool
        case 'primitive':
          return activeTool === 'primitive-box' && activePrimitiveKind === entry.primitive
        case 'shape':
          return activeTool === 'vector-shape' && activeShapeKind === entry.shape
        case 'polyMode':
          return activeTool === 'poly-draw' && polyDrawMode === entry.mode
        case 'stroke':
          return activeTool === 'draw' && strokeMode === entry.mode && drawInputMode === 'regular'
        case 'drawInput':
          return entry.mode === 'vector-pen'
            ? activeTool === 'vector-pen'
            : activeTool === 'draw' && drawInputMode === 'regular'
        case 'action':
          if (entry.id === 'extrude') {
            return activeExtrudeMode({ drawInputMode, sketchExtrudeMode, penExtrudeMode })
          }
          if (entry.id === 'uv-editor') return uvEditorOpen
          return false
        default:
          return false
      }
    },
    [
      activeTool,
      selectionMode,
      activePrimitiveKind,
      activeShapeKind,
      strokeMode,
      polyDrawMode,
      drawInputMode,
      sketchExtrudeMode,
      penExtrudeMode,
      uvEditorOpen,
    ]
  )

  const handleCategoryClick = (cat: ToolCategory, e: React.MouseEvent) => {
    e.stopPropagation()
    setPinnedCategory((prev) => (prev === cat ? null : cat))
    setHoveredCategory(cat)
  }

  const handleEntryPointerDown = (
    category: ToolCategory,
    entry: ToolRingEntry,
    e: React.PointerEvent
  ) => {
    e.preventDefault()
    e.stopPropagation()
    if (isToolRingEntryDisabled(disabledContext, entry)) return
    const ok = activateToolRingEntry(category, entry)
    if (ok) onClose()
  }

  const branchAngle = openCategory
    ? categoryAngle(
        TOOL_RING_CATEGORIES.findIndex((c) => c.id === openCategory),
        TOOL_RING_CATEGORIES.length
      )
    : 0
  const branchPos = openCategory
    ? polarToPosition(branchAngle, 196, 0)
    : { left: RING_CENTER, top: RING_CENTER }

  return (
    <div className="tool-ring-overlay" onClick={onClose}>
      <div className="tool-ring-shell" onClick={(e) => e.stopPropagation()}>
        <div className="tool-ring">
          <div className="tool-ring-center">
            <span className="tool-ring-center-label">{openCategoryMeta?.label ?? 'Tools'}</span>
            <span className="tool-ring-center-hint">Tab · Esc</span>
          </div>

          {TOOL_RING_CATEGORIES.map(({ id, label }, index) => {
            const angle = categoryAngle(index, TOOL_RING_CATEGORIES.length)
            const pos = polarToPosition(angle, CATEGORY_RADIUS, CATEGORY_SIZE)
            const isOpen = openCategory === id

            return (
              <button
                key={id}
                type="button"
                className={`tool-ring-segment${isOpen ? ' open' : ''}`}
                style={{ left: pos.left, top: pos.top, width: CATEGORY_SIZE, height: CATEGORY_SIZE }}
                onMouseEnter={() => setHoveredCategory(id)}
                onClick={(e) => handleCategoryClick(id, e)}
              >
                {label}
              </button>
            )
          })}

          {openCategory && openCategoryMeta && (
            <div
              className="tool-ring-branch"
              style={{ left: branchPos.left, top: branchPos.top }}
              onMouseEnter={() => setHoveredCategory(openCategory)}
            >
              <div className="tool-ring-branch-title">{openCategoryMeta.label}</div>
              <div className="tool-ring-branch-grid">
                {TOOL_RING_BRANCHES[openCategory].map((entry) => {
                  const disabled = isToolRingEntryDisabled(disabledContext, entry)
                  return (
                    <button
                      key={toolRingEntryKey(entry)}
                      type="button"
                      className={`tool-ring-branch-item${isEntryActive(entry) ? ' active' : ''}`}
                      disabled={disabled}
                      onPointerDown={(e) => handleEntryPointerDown(openCategory, entry, e)}
                    >
                      {entry.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
