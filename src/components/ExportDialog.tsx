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
  DEFAULT_PROJECT_FILENAME,
  DEFAULT_STL_FILENAME,
  PROJECT_FILE_EXTENSION,
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
  initialTab?: 'project' | 'export' | 'import'
}

type DialogTab = 'project' | 'export' | 'import'

const EXPORT_ICONS: Record<ExportKind, string> = {
  glb: 'GLB',
  gltf: 'GLTF',
  'obj-mtl': 'OBJ',
  'obj-zip': 'ZIP',
  stl: 'STL',
  'textures-zip': 'TEX',
  'materials-json': 'MTL',
}

const IMPORT_ICONS: Record<ImportKind, string> = {
  'mesh-auto': 'AUTO',
  'mesh-obj': 'OBJ',
  'mesh-glb': 'GLB',
  'mesh-gltf': 'GLTF',
  'mesh-stl': 'STL',
  texture: 'TEX',
}

export function ExportDialog({ onClose, initialTab = 'export' }: ExportDialogProps) {
  const objects = useAppStore((s) => s.objects)
  const selectionObjectIds = useAppStore((s) => s.selectionObjectIds)
  const selectedObjectId = useAppStore((s) => s.selectedObjectId)
  const pixelDocuments = useAppStore((s) => s.pixelDocuments)
  const objectTextures = useAppStore((s) => s.objectTextures)
  const importSceneFile = useAppStore((s) => s.importSceneFile)
  const loadObjectTexture = useAppStore((s) => s.loadObjectTexture)
  const saveProject = useAppStore((s) => s.saveProject)
  const loadProjectFromDialog = useAppStore((s) => s.loadProjectFromDialog)
  const newProject = useAppStore((s) => s.newProject)

  const [tab, setTab] = useState<DialogTab>(initialTab)
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
  const objectCount = objects.length

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

  const runSaveProject = async () => {
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      const saved = await saveProject()
      if (saved) setStatus(`Project saved as ${DEFAULT_PROJECT_FILENAME}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const runOpenProject = async () => {
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      const loaded = await loadProjectFromDialog()
      if (loaded) {
        setStatus('Project opened.')
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Open failed')
    } finally {
      setBusy(false)
    }
  }

  const runNewProject = async () => {
    if (await newProject()) setStatus('New project created.')
  }

  return (
    <div className="ie-overlay" onClick={onClose}>
      <div
        className="ie-dialog bb-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="ie-title"
      >
        <header className="ie-header bb-dialog-header">
          <div>
            <h2 id="ie-title">File</h2>
            <p className="ie-subtitle">
              Save project, export models, or import geometry — same workflow as Blockbench.
            </p>
          </div>
          <button
            type="button"
            className="ie-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="bb-tabs" role="tablist">
          {(
            [
              ['project', 'Project'],
              ['export', 'Export'],
              ['import', 'Import'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`bb-tab ${tab === id ? 'active' : ''}`}
              onClick={() => {
                setTab(id)
                setError(null)
                setStatus(null)
              }}
              disabled={busy}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'project' && (
          <div className="bb-body">
            <div className="bb-format-list">
              <button
                type="button"
                className="bb-format-row"
                onClick={() => void runSaveProject()}
                disabled={busy}
              >
                <span className="bb-format-icon">SAVE</span>
                <span className="bb-format-meta">
                  <strong>Save Project</strong>
                  <em>
                    Native {PROJECT_FILE_EXTENSION} — meshes, textures, hair tools, and scene settings
                  </em>
                </span>
              </button>
              <button
                type="button"
                className="bb-format-row"
                onClick={() => void runOpenProject()}
                disabled={busy}
              >
                <span className="bb-format-icon">OPEN</span>
                <span className="bb-format-meta">
                  <strong>Open Project</strong>
                  <em>Load a saved {PROJECT_FILE_EXTENSION} file</em>
                </span>
              </button>
              <button
                type="button"
                className="bb-format-row"
                onClick={runNewProject}
                disabled={busy}
              >
                <span className="bb-format-icon">NEW</span>
                <span className="bb-format-meta">
                  <strong>New Project</strong>
                  <em>Clear the scene and start fresh</em>
                </span>
              </button>
            </div>
            <aside className="bb-detail">
              <h3>Project file</h3>
              <p>
                Saves the editable scene as <code>{DEFAULT_PROJECT_FILENAME}</code> — objects,
                painted textures, image planes, hair tool settings, references, and selection.
              </p>
              <dl className="ie-stats">
                <div>
                  <dt>Objects</dt>
                  <dd>{objectCount}</dd>
                </div>
                <div>
                  <dt>Textures</dt>
                  <dd>{Object.keys(objectTextures).length + Object.keys(pixelDocuments).length}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="ie-action primary bb-confirm"
                disabled={busy}
                onClick={() => void runSaveProject()}
              >
                {busy ? 'Saving…' : 'Save Project'}
              </button>
            </aside>
          </div>
        )}

        {tab === 'export' && (
          <div className="bb-body">
            <div className="bb-format-list" role="listbox" aria-label="Export format">
              {EXPORT_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  role="option"
                  aria-selected={exportKind === opt.kind}
                  className={`bb-format-row ${exportKind === opt.kind ? 'active' : ''}`}
                  onClick={() => setExportKind(opt.kind)}
                  disabled={busy}
                >
                  <span className="bb-format-icon">{EXPORT_ICONS[opt.kind]}</span>
                  <span className="bb-format-meta">
                    <strong>
                      {opt.label}
                      {opt.recommended ? ' ★' : ''}
                    </strong>
                    <em>{opt.extension}</em>
                  </span>
                </button>
              ))}
            </div>
            <aside className="bb-detail">
              <h3>{exportMeta.label}</h3>
              <p>{exportMeta.description}</p>

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

              {exportNeedsMesh && (
                <p className="ie-warn">Nothing to export — add or select mesh objects.</p>
              )}
              {exportNeedsTextures && !exportNeedsMesh && (
                <p className="ie-warn">No painted textures in the current scope.</p>
              )}

              <button
                type="button"
                className="ie-action primary bb-confirm"
                disabled={busy || exportNeedsMesh || exportNeedsTextures}
                onClick={() => void runExport()}
              >
                {busy ? 'Exporting…' : `Export ${exportMeta.extension}`}
              </button>
            </aside>
          </div>
        )}

        {tab === 'import' && (
          <div className="bb-body">
            <div className="bb-format-list" role="listbox" aria-label="Import format">
              {IMPORT_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  role="option"
                  aria-selected={importKind === opt.kind}
                  className={`bb-format-row ${importKind === opt.kind ? 'active' : ''}`}
                  onClick={() => setImportKind(opt.kind)}
                  disabled={busy}
                >
                  <span className="bb-format-icon">{IMPORT_ICONS[opt.kind]}</span>
                  <span className="bb-format-meta">
                    <strong>{opt.label}</strong>
                    <em>{opt.requiresObjectSelection ? 'Needs selection' : 'Scene import'}</em>
                  </span>
                </button>
              ))}
            </div>
            <aside className="bb-detail">
              <h3>{importMeta.label}</h3>
              <p>{importMeta.description}</p>
              {importNeedsSelection && (
                <p className="ie-warn">Select an object before importing a texture.</p>
              )}
              <button
                type="button"
                className="ie-action primary bb-confirm"
                disabled={busy || importNeedsSelection}
                onClick={() => void runImport()}
              >
                {busy ? 'Importing…' : 'Choose file…'}
              </button>
            </aside>
          </div>
        )}

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
