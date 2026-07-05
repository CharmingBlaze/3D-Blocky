import { useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import {
  downloadSceneGLB,
  downloadSceneGLTF,
  downloadSceneOBJ,
  downloadSceneOBJBundle,
  downloadSceneSTL,
  type TextureExportContext,
} from '../io/sceneExport'
import {
  downloadMaterialsJson,
  downloadTexturesZip,
  textureCountForObjects,
} from '../io/materialTextureExport'
import {
  DEFAULT_EXPORT_BASENAME,
  DEFAULT_GLB_FILENAME,
  DEFAULT_GLTF_FILENAME,
  DEFAULT_STL_FILENAME,
} from '../app/branding'
import { pickOpenFile } from '../io/fileDialogs'
import {
  EXPORT_OPTIONS,
  IMPORT_OPTIONS,
  type ExportKind,
  type ImportKind,
  validateImportFile,
} from '../io/importExportCatalog'

interface ExportDialogProps {
  onClose: () => void
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const objects = useAppStore((s) => s.objects)
  const selectionObjectIds = useAppStore((s) => s.selectionObjectIds)
  const selectedObjectId = useAppStore((s) => s.selectedObjectId)
  const pixelDocuments = useAppStore((s) => s.pixelDocuments)
  const objectTextures = useAppStore((s) => s.objectTextures)
  const importSceneFile = useAppStore((s) => s.importSceneFile)
  const loadObjectTexture = useAppStore((s) => s.loadObjectTexture)

  const [importKind, setImportKind] = useState<ImportKind>('mesh-auto')
  const [exportKind, setExportKind] = useState<ExportKind>('glb')
  const [scope, setScope] = useState<'all' | 'selected'>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const importMeta = useMemo(
    () => IMPORT_OPTIONS.find((o) => o.kind === importKind) ?? IMPORT_OPTIONS[0]!,
    [importKind]
  )
  const exportMeta = useMemo(
    () => EXPORT_OPTIONS.find((o) => o.kind === exportKind) ?? EXPORT_OPTIONS[0]!,
    [exportKind]
  )

  const exportObjects =
    scope === 'selected' && selectionObjectIds.length > 0
      ? objects.filter((o) => selectionObjectIds.includes(o.id))
      : selectedObjectId && scope === 'selected'
        ? objects.filter((o) => o.id === selectedObjectId)
        : objects

  const textureCtx: TextureExportContext = useMemo(
    () => ({ pixelDocuments, objectTextures }),
    [pixelDocuments, objectTextures]
  )

  const textureCount = useMemo(
    () => textureCountForObjects(exportObjects, textureCtx),
    [exportObjects, textureCtx]
  )

  const textureTargetId = selectedObjectId ?? selectionObjectIds[0] ?? null
  const vertexCount = exportObjects.reduce((s, o) => s + o.positions.length, 0)
  const faceCount = exportObjects.reduce((s, o) => s + o.faces.length, 0)

  const canImportTexture = importKind === 'texture'
  const importNeedsSelection = importMeta.requiresObjectSelection && !textureTargetId
  const exportNeedsMesh = Boolean(exportMeta.needsMesh) && exportObjects.length === 0
  const exportNeedsTextures = Boolean(exportMeta.needsTextures) && textureCount === 0

  const savedLabel = (label: string) => `${label} saved successfully.`

  const runExport = async () => {
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      let saved = false
      let label = exportMeta.label

      switch (exportKind) {
        case 'glb':
          saved = await downloadSceneGLB(exportObjects, DEFAULT_GLB_FILENAME, textureCtx)
          break
        case 'gltf':
          saved = await downloadSceneGLTF(exportObjects, DEFAULT_GLTF_FILENAME, textureCtx)
          break
        case 'obj-mtl':
          saved = await downloadSceneOBJ(exportObjects, DEFAULT_EXPORT_BASENAME, textureCtx)
          break
        case 'obj-zip':
          saved = await downloadSceneOBJBundle(exportObjects, DEFAULT_EXPORT_BASENAME, textureCtx)
          break
        case 'stl':
          saved = await downloadSceneSTL(exportObjects, DEFAULT_STL_FILENAME, textureCtx)
          break
        case 'textures-zip':
          await downloadTexturesZip(exportObjects, textureCtx)
          saved = true
          label = `${textureCount} texture${textureCount === 1 ? '' : 's'}`
          break
        case 'materials-json':
          saved = await downloadMaterialsJson(exportObjects, textureCtx)
          break
      }

      if (saved) setStatus(savedLabel(label))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const runImport = async () => {
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      const file = await pickOpenFile({
        title: canImportTexture ? 'Import texture' : 'Import mesh',
        filters: importMeta.filters,
      })
      if (!file) return

      validateImportFile(importKind, file.name)

      if (canImportTexture) {
        if (!textureTargetId) throw new Error('Select an object before importing a texture.')
        await loadObjectTexture(textureTargetId, file)
        setStatus(`Applied ${file.name} as texture on the selected object.`)
        return
      }

      const count = await importSceneFile(file)
      setStatus(`Imported ${count} object${count === 1 ? '' : 's'} from ${file.name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ie-overlay" onClick={onClose}>
      <div className="ie-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="ie-title">
        <header className="ie-header">
          <div>
            <h2 id="ie-title">Import &amp; Export</h2>
            <p className="ie-subtitle">
              Pick a file type, then choose where to save or which file to open — your system file
              dialog is used whenever the app supports it.
            </p>
          </div>
          <button type="button" className="ie-close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </header>

        <div className="ie-panels">
          <section className="ie-panel">
            <h3 className="ie-panel-title">Import</h3>
            <label className="ie-field">
              <span>File type</span>
              <select
                className="side-select shape-kind-select ie-select"
                value={importKind}
                onChange={(e) => setImportKind(e.target.value as ImportKind)}
                disabled={busy}
              >
                {IMPORT_OPTIONS.map((opt) => (
                  <option key={opt.kind} value={opt.kind}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="ie-desc">{importMeta.description}</p>
            {importNeedsSelection && (
              <p className="ie-warn">Select an object in the scene before importing a texture.</p>
            )}
            <button
              type="button"
              className="ie-action primary"
              disabled={busy || importNeedsSelection}
              onClick={() => void runImport()}
            >
              {busy ? 'Working…' : 'Choose file…'}
            </button>
          </section>

          <section className="ie-panel">
            <h3 className="ie-panel-title">Export</h3>
            <label className="ie-field">
              <span>File type</span>
              <select
                className="side-select shape-kind-select ie-select"
                value={exportKind}
                onChange={(e) => setExportKind(e.target.value as ExportKind)}
                disabled={busy}
              >
                {EXPORT_OPTIONS.map((opt) => (
                  <option key={opt.kind} value={opt.kind}>
                    {opt.recommended ? `${opt.label} ★` : opt.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="ie-desc">{exportMeta.description}</p>

            <fieldset className="ie-scope" disabled={busy}>
              <legend>Scope</legend>
              <label className="ie-radio">
                <input
                  type="radio"
                  name="ie-export-scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                />
                <span>Entire scene</span>
              </label>
              <label className="ie-radio">
                <input
                  type="radio"
                  name="ie-export-scope"
                  checked={scope === 'selected'}
                  onChange={() => setScope('selected')}
                  disabled={selectionObjectIds.length === 0 && !selectedObjectId}
                />
                <span>Selection only</span>
              </label>
            </fieldset>

            <dl className="ie-stats">
              <div>
                <dt>Objects</dt>
                <dd>{exportObjects.length}</dd>
              </div>
              <div>
                <dt>Vertices</dt>
                <dd>{vertexCount}</dd>
              </div>
              <div>
                <dt>Faces</dt>
                <dd>{faceCount}</dd>
              </div>
              <div>
                <dt>Textures</dt>
                <dd>{textureCount}</dd>
              </div>
            </dl>

            {exportNeedsMesh && <p className="ie-warn">Nothing to export — add or select mesh objects.</p>}
            {exportNeedsTextures && !exportNeedsMesh && (
              <p className="ie-warn">No painted textures in the current scope.</p>
            )}

            <button
              type="button"
              className="ie-action primary"
              disabled={busy || exportNeedsMesh || exportNeedsTextures}
              onClick={() => void runExport()}
            >
              {busy ? 'Working…' : 'Export…'}
            </button>
          </section>
        </div>

        {(error || status) && (
          <footer className="ie-footer">
            {error && <p className="ie-error">{error}</p>}
            {status && <p className="ie-success">{status}</p>}
          </footer>
        )}
      </div>
    </div>
  )
}
