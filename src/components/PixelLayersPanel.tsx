import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import type { PixelBlendMode, PixelLayer } from '../pixel/pixelTypes'

const BLEND_MODES: { id: PixelBlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'add', label: 'Add' },
  { id: 'screen', label: 'Screen' },
]

function LayerIcon({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <svg
      className="px-layer-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <LayerIcon>
      {open ? (
        <>
          <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" />
          <circle cx="8" cy="8" r="1.8" />
        </>
      ) : (
        <>
          <path d="M2 2.5 13.5 14" />
          <path d="M6.2 4.1C6.8 3.9 7.4 3.5 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-2.1 2.3" />
          <path d="M4.1 5.9A11 11 0 0 0 1.5 8S4 12.5 8 12.5c.7 0 1.4-.2 2-.4" />
        </>
      )}
    </LayerIcon>
  )
}

function LayerThumb({
  layer,
  width,
  height,
  revision,
}: {
  layer: PixelLayer
  width: number
  height: number
  revision: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const size = 32
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, size, size)
    // Checkerboard for transparency
    const cell = 4
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        ctx.fillStyle = ((x / cell + y / cell) & 1) === 0 ? '#3a3a3a' : '#2a2a2a'
        ctx.fillRect(x, y, cell, cell)
      }
    }
    const img = ctx.createImageData(width, height)
    img.data.set(layer.pixels)
    const off = document.createElement('canvas')
    off.width = width
    off.height = height
    const offCtx = off.getContext('2d')
    if (!offCtx) return
    offCtx.putImageData(img, 0, 0)
    const scale = Math.min(size / width, size / height)
    const dw = Math.max(1, Math.floor(width * scale))
    const dh = Math.max(1, Math.floor(height * scale))
    const dx = Math.floor((size - dw) / 2)
    const dy = Math.floor((size - dh) / 2)
    ctx.imageSmoothingEnabled = false
    ctx.globalAlpha = layer.visible ? 1 : 0.35
    ctx.drawImage(off, dx, dy, dw, dh)
  }, [layer.pixels, layer.visible, width, height, revision])

  return <canvas ref={canvasRef} className="px-layer-thumb" width={32} height={32} aria-hidden />
}

/** Photoshop-style layers list for the Pixel Editor. */
export function PixelLayersPanel() {
  const store = useAppStore(
    useShallow((s) => ({
      docId: s.pixelEditorDocId,
      docs: s.pixelDocuments,
      revision: s.pixelTextureRevision,
      addLayer: s.addPixelEditorLayer,
      deleteLayer: s.deletePixelEditorLayer,
      duplicateLayer: s.duplicatePixelEditorLayer,
      mergeDown: s.mergePixelEditorLayerDown,
      reorderLayer: s.reorderPixelEditorLayer,
      patchLayer: s.patchPixelEditorLayer,
      setActiveLayer: s.setPixelEditorActiveLayer,
      beginEdit: s.beginPixelEdit,
      commitEdit: s.commitPixelEdit,
    }))
  )

  const doc = store.docId ? store.docs[store.docId] : null
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIdx, setDropIdx] = useState<number | null>(null)

  if (!doc) {
    return (
      <div className="px-layers">
        <div className="px-layers-head">
          <span>Layers</span>
        </div>
        <p className="px-layers-empty">Open a texture to manage layers.</p>
      </div>
    )
  }

  const layersTopFirst = [...doc.layers].reverse()
  const active = doc.layers.find((l) => l.id === doc.activeLayerId) ?? null
  const activeIdx = active ? doc.layers.findIndex((l) => l.id === active.id) : -1
  const canDelete = doc.layers.length > 1
  const canMergeDown = activeIdx > 0

  const startRename = (layer: PixelLayer) => {
    setRenamingId(layer.id)
    setRenameValue(layer.name)
  }

  const commitRename = () => {
    if (!renamingId) return
    const name = renameValue.trim() || 'Layer'
    store.patchLayer(renamingId, { name })
    store.commitEdit()
    setRenamingId(null)
  }

  const moveActive = (delta: number) => {
    if (!active || activeIdx < 0) return
    const to = Math.max(0, Math.min(doc.layers.length - 1, activeIdx + delta))
    if (to === activeIdx) return
    store.reorderLayer(active.id, to)
    store.commitEdit()
  }

  const onDropReorder = (targetVisualIdx: number) => {
    if (!dragId) return
    // visual index 0 = top = last in storage array
    const toStorageIdx = doc.layers.length - 1 - targetVisualIdx
    store.reorderLayer(dragId, toStorageIdx)
    store.commitEdit()
    setDragId(null)
    setDropIdx(null)
  }

  return (
    <div className="px-layers">
      <div className="px-layers-head">
        <span>Layers</span>
        <span className="px-layers-count">{doc.layers.length}</span>
      </div>

      <div className="px-layers-toolbar" role="toolbar" aria-label="Layer actions">
        <button
          type="button"
          className="px-layers-tool"
          title="New layer"
          aria-label="New layer"
          onClick={() => {
            store.addLayer()
            store.commitEdit()
          }}
        >
          <LayerIcon>
            <path d="M8 3v10M3 8h10" />
          </LayerIcon>
        </button>
        <button
          type="button"
          className="px-layers-tool"
          title="Duplicate layer"
          aria-label="Duplicate layer"
          disabled={!active}
          onClick={() => {
            if (!active) return
            store.duplicateLayer(active.id)
            store.commitEdit()
          }}
        >
          <LayerIcon>
            <rect x="5" y="5" width="8" height="8" rx="1" />
            <path d="M3 10V3.5A.5.5 0 0 1 3.5 3H10" />
          </LayerIcon>
        </button>
        <button
          type="button"
          className="px-layers-tool"
          title="Merge down"
          aria-label="Merge down"
          disabled={!canMergeDown}
          onClick={() => {
            if (!active || !canMergeDown) return
            store.mergeDown(active.id)
            store.commitEdit()
          }}
        >
          <LayerIcon>
            <path d="M3 4.5h10M3 8h10M5.5 11.5 8 14l2.5-2.5M8 8.5V14" />
          </LayerIcon>
        </button>
        <button
          type="button"
          className="px-layers-tool"
          title="Move up"
          aria-label="Move layer up"
          disabled={!active || activeIdx >= doc.layers.length - 1}
          onClick={() => moveActive(1)}
        >
          <LayerIcon>
            <path d="M8 12.5V3.5M4.5 7 8 3.5 11.5 7" />
          </LayerIcon>
        </button>
        <button
          type="button"
          className="px-layers-tool"
          title="Move down"
          aria-label="Move layer down"
          disabled={!active || activeIdx <= 0}
          onClick={() => moveActive(-1)}
        >
          <LayerIcon>
            <path d="M8 3.5v9M4.5 9 8 12.5 11.5 9" />
          </LayerIcon>
        </button>
        <button
          type="button"
          className="px-layers-tool danger"
          title="Delete layer"
          aria-label="Delete layer"
          disabled={!canDelete || !active}
          onClick={() => {
            if (!active || !canDelete) return
            store.deleteLayer(active.id)
            store.commitEdit()
          }}
        >
          <LayerIcon>
            <path d="M3.5 4.5h9M6 4.5V3.5h4v1M5 4.5l.5 8h5l.5-8" />
          </LayerIcon>
        </button>
      </div>

      <div className="px-layers-list" role="listbox" aria-label="Layers">
        {layersTopFirst.map((layer, visualIdx) => {
          const isActive = layer.id === doc.activeLayerId
          const storageIdx = doc.layers.length - 1 - visualIdx
          return (
            <div
              key={layer.id}
              role="option"
              aria-selected={isActive}
              className={`px-layer-row${isActive ? ' active' : ''}${!layer.visible ? ' hidden-layer' : ''}${
                dropIdx === visualIdx ? ' drop-target' : ''
              }`}
              draggable={renamingId !== layer.id}
              onDragStart={(e) => {
                setDragId(layer.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', layer.id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setDropIdx(null)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDropIdx(visualIdx)
              }}
              onDrop={(e) => {
                e.preventDefault()
                onDropReorder(visualIdx)
              }}
              onClick={() => store.setActiveLayer(layer.id)}
            >
              <button
                type="button"
                className="px-layer-vis"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
                onClick={(e) => {
                  e.stopPropagation()
                  store.patchLayer(layer.id, { visible: !layer.visible })
                  store.commitEdit()
                }}
              >
                <EyeIcon open={layer.visible} />
              </button>

              <LayerThumb
                layer={layer}
                width={doc.width}
                height={doc.height}
                revision={store.revision + storageIdx}
              />

              <div className="px-layer-main">
                {renamingId === layer.id ? (
                  <input
                    className="px-layer-rename"
                    value={renameValue}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="px-layer-name"
                    title="Double-click to rename"
                    onClick={(e) => {
                      e.stopPropagation()
                      store.setActiveLayer(layer.id)
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      startRename(layer)
                    }}
                  >
                    {layer.name}
                  </button>
                )}
                <span className="px-layer-meta">
                  {Math.round(layer.opacity * 100)}%
                  {layer.blendMode !== 'normal' ? ` · ${layer.blendMode}` : ''}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {active && (
        <div className="px-layer-props" aria-label={`Settings for ${active.name}`}>
          <label className="px-layer-props-blend" title={active.name}>
            <select
              className="shape-kind-select side-select"
              value={active.blendMode}
              aria-label="Blend mode"
              onChange={(e) => {
                store.patchLayer(active.id, { blendMode: e.target.value as PixelBlendMode })
                store.commitEdit()
              }}
            >
              {BLEND_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="px-layer-props-opacity">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={active.opacity}
              aria-label="Opacity"
              onPointerDown={() => store.beginEdit()}
              onChange={(e) => store.patchLayer(active.id, { opacity: Number(e.target.value) })}
              onPointerUp={() => store.commitEdit()}
            />
            <span className="px-layer-props-value">{Math.round(active.opacity * 100)}%</span>
          </label>
        </div>
      )}
    </div>
  )
}
