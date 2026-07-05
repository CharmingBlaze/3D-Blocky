import { useCallback, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { SideButtonDropdown } from './SideButtonDropdown'

export function SidePanelFileMenu() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const hasContent = useAppStore(
    (s) =>
      s.objects.length > 0 ||
      s.referenceImages.length > 0 ||
      s.billboardImages.length > 0 ||
      Object.keys(s.pixelDocuments).length > 0
  )
  const newProject = useAppStore((s) => s.newProject)
  const saveProject = useAppStore((s) => s.saveProject)
  const loadProjectFromDialog = useAppStore((s) => s.loadProjectFromDialog)

  const confirmDiscard = useCallback(() => {
    if (!hasContent) return true
    return window.confirm('Discard the current project? Unsaved changes will be lost.')
  }, [hasContent])

  const runSave = useCallback(async () => {
    setMessage(null)
    setBusy(true)
    try {
      const saved = await saveProject()
      if (saved) {
        setMessage('Project saved.')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }, [saveProject])

  const runNew = useCallback(() => {
    if (!confirmDiscard()) return
    setMessage(null)
    newProject()
    setMessage('New project.')
  }, [confirmDiscard, newProject])

  const runLoad = useCallback(async () => {
    setMessage(null)
    setBusy(true)
    try {
      const loaded = await loadProjectFromDialog()
      if (loaded) setMessage('Project loaded.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Load failed.')
    } finally {
      setBusy(false)
    }
  }, [loadProjectFromDialog])

  const handleSelect = useCallback(
    (action: string) => {
      if (busy) return
      if (action === 'new') runNew()
      else if (action === 'save') void runSave()
      else if (action === 'load') void runLoad()
    },
    [busy, runLoad, runNew, runSave]
  )

  return (
    <SideButtonDropdown
      label={busy ? 'File…' : 'File'}
      options={[
        { value: 'new', label: 'New' },
        { value: 'save', label: 'Save…' },
        { value: 'load', label: 'Open…' },
      ]}
      onSelect={handleSelect}
      disabled={busy}
      title="New, save, or open a project"
      footer={message ? <p className="side-color-hint muted side-file-status">{message}</p> : null}
    />
  )
}
