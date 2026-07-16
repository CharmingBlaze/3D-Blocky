import { useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FloatingPanel } from './FloatingPanel'
import { useAppStore } from '../store/appStore'
import { useOutlinerUiStore } from '../store/outlinerUiStore'
import { isSceneObjectVisible } from '../scene/objectVisibility'
import { computeSelectionFitFrame } from '../viewport/fitViewports'
import type { SceneObject } from '../mesh/HalfEdgeMesh'

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M2 10c2.1-3.2 4.8-4.8 8-4.8s5.9 1.6 8 4.8c-2.1 3.2-4.8 4.8-8 4.8S4.1 13.2 2 10Z" />
      <circle cx="10" cy="10" r="2.6" />
      {!open && <path d="M3 3l14 14" className="outliner-eye-slash" />}
    </svg>
  )
}

function ObjectGlyph({ object }: { object: SceneObject }) {
  const isCurve = Boolean(object.sketchSource || object.vectorSource)
  return <span className={`outliner-glyph ${isCurve ? 'curve' : 'mesh'}`}>{isCurve ? '◇' : '⬡'}</span>
}

export function OutlinerPanel() {
  const { open, panel, setOpen, setPanel } = useOutlinerUiStore()
  const store = useAppStore(useShallow((s) => ({
    objects: s.objects,
    selectedObjectId: s.selectedObjectId,
    selectionObjectIds: s.selectionObjectIds,
    selectObject: s.selectObject,
    setSelection: s.setSelection,
    updateObject: s.updateObject,
    removeObject: s.removeObject,
    commitHistory: s.commitHistory,
    copySelection: s.copySelection,
    pasteClipboard: s.pasteClipboard,
    requestViewportFit: s.requestViewportFit,
  })))
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const anchorIdRef = useRef<string | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return store.objects
    return store.objects.filter((object) =>
      object.name.toLocaleLowerCase().includes(needle)
    )
  }, [store.objects, query])
  const selectedSet = useMemo(() => new Set(store.selectionObjectIds), [store.selectionObjectIds])
  const visibleCount = store.objects.filter(isSceneObjectVisible).length

  const selectRow = (object: SceneObject, event: React.MouseEvent) => {
    if (event.shiftKey && anchorIdRef.current) {
      const start = filtered.findIndex((entry) => entry.id === anchorIdRef.current)
      const end = filtered.findIndex((entry) => entry.id === object.id)
      if (start >= 0 && end >= 0) {
        const range = filtered.slice(Math.min(start, end), Math.max(start, end) + 1).map((entry) => entry.id)
        store.setSelection(event.ctrlKey || event.metaKey
          ? Array.from(new Set([...store.selectionObjectIds, ...range]))
          : range)
        return
      }
    }
    anchorIdRef.current = object.id
    store.selectObject(object.id, { additive: event.ctrlKey || event.metaKey })
  }

  const beginRename = (object: SceneObject) => {
    setEditingId(object.id)
    setDraftName(object.name)
  }
  const finishRename = (object: SceneObject) => {
    const next = draftName.trim()
    setEditingId(null)
    if (!next || next === object.name) return
    store.updateObject(object.id, { name: next })
    store.commitHistory('Rename object')
  }
  const toggleVisibility = (object: SceneObject) => {
    store.updateObject(object.id, { visible: !isSceneObjectVisible(object) })
    store.commitHistory(isSceneObjectVisible(object) ? 'Hide object' : 'Show object')
  }
  const setAllVisible = (visible: boolean) => {
    const changed = store.objects.filter((object) => isSceneObjectVisible(object) !== visible)
    if (!changed.length) return
    for (const object of changed) store.updateObject(object.id, { visible })
    store.commitHistory(visible ? 'Show all objects' : 'Hide all objects')
  }
  const frameSelection = () => {
    const frame = computeSelectionFitFrame(store.objects.filter(isSceneObjectVisible), store.selectionObjectIds)
    if (frame) store.requestViewportFit(frame)
  }
  const deleteSelected = () => {
    const ids = [...store.selectionObjectIds]
    for (const id of ids) store.removeObject(id)
  }

  return (
    <FloatingPanel
      title={`Outliner · ${store.objects.length}`}
      open={open}
      state={panel}
      minWidth={300}
      minHeight={280}
      onClose={() => setOpen(false)}
      onStateChange={setPanel}
    >
      <section className="outliner-panel">
        <div className="outliner-toolbar" role="toolbar" aria-label="Outliner actions">
          <button onClick={() => store.setSelection(store.objects.map((object) => object.id))} disabled={!store.objects.length} title="Select all objects">All</button>
          <button onClick={() => setAllVisible(true)} disabled={visibleCount === store.objects.length} title="Show every object">Show</button>
          <button onClick={() => setAllVisible(false)} disabled={!visibleCount} title="Hide every object">Hide</button>
          <button onClick={frameSelection} disabled={!store.selectionObjectIds.length} title="Frame selected objects in all viewports">Frame</button>
          <button onClick={() => { store.copySelection(); store.pasteClipboard() }} disabled={!store.selectionObjectIds.length} title="Duplicate selected objects">Duplicate</button>
          <button className="danger" onClick={deleteSelected} disabled={!store.selectionObjectIds.length} title="Delete selected objects">Delete</button>
        </div>

        <div className="outliner-search-wrap">
          <span aria-hidden>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search objects…"
            aria-label="Search objects"
          />
          {query && <button onClick={() => setQuery('')} title="Clear search">×</button>}
        </div>

        <div className="outliner-columns" aria-hidden>
          <span>Scene objects</span><span>Geometry</span><span>View</span><span />
        </div>
        <div className="outliner-list themed-scroll" role="tree" aria-label="Scene objects">
          {filtered.length === 0 ? (
            <div className="outliner-empty">{store.objects.length ? 'No matching objects' : 'Your scene is empty'}</div>
          ) : filtered.map((object) => {
            const selected = selectedSet.has(object.id)
            const visible = isSceneObjectVisible(object)
            return (
              <div
                key={object.id}
                className={`outliner-row${selected ? ' selected' : ''}${visible ? '' : ' hidden-object'}`}
                role="treeitem"
                aria-selected={selected}
                tabIndex={selected || object.id === store.selectedObjectId ? 0 : -1}
                onClick={(event) => selectRow(object, event)}
                onDoubleClick={() => beginRename(object)}
                onKeyDown={(event) => {
                  if (event.key === 'F2' || event.key === 'Enter') beginRename(object)
                  if (event.key === 'Delete') store.removeObject(object.id)
                }}
              >
                <div className="outliner-name-cell">
                  <ObjectGlyph object={object} />
                  {editingId === object.id ? (
                    <input
                      className="outliner-rename"
                      value={draftName}
                      autoFocus
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => finishRename(object)}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') event.currentTarget.blur()
                        if (event.key === 'Escape') setEditingId(null)
                      }}
                    />
                  ) : (
                    <span className="outliner-name" title={`${object.name} · double-click to rename`}>{object.name}</span>
                  )}
                  {object.topologyLocked && <span className="outliner-lock" title="Procedural topology is locked">◆</span>}
                </div>
                <span className="outliner-geometry" title={`${object.positions.length} vertices · ${object.faces.length} faces`}>
                  {object.positions.length}v&nbsp; {object.faces.length}f
                </span>
                <button
                  className={`outliner-icon-btn${visible ? '' : ' off'}`}
                  onClick={(event) => { event.stopPropagation(); toggleVisibility(object) }}
                  title={visible ? 'Hide object' : 'Show object'}
                  aria-label={visible ? `Hide ${object.name}` : `Show ${object.name}`}
                ><EyeIcon open={visible} /></button>
                <button
                  className="outliner-icon-btn outliner-delete"
                  onClick={(event) => { event.stopPropagation(); store.removeObject(object.id) }}
                  title={`Delete ${object.name}`}
                  aria-label={`Delete ${object.name}`}
                >×</button>
              </div>
            )
          })}
        </div>
        <footer className="outliner-status">
          <span>{store.selectionObjectIds.length} selected</span>
          <span>{visibleCount}/{store.objects.length} visible</span>
        </footer>
      </section>
    </FloatingPanel>
  )
}
