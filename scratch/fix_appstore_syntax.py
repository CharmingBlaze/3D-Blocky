from pathlib import Path

p = Path('src/store/appStore.ts')
text = p.read_text(encoding='utf-8')

# Fix ensureTextureDocumentForObject — missing closing paren on set
text = text.replace(
    """    set((s) =>
    withPixelTextureBump(s, newId, {
      pixelDocuments: docs,
      pixelEditorDocId: newId,
      objectTextures: {
        ...s.objectTextures,
        [newId]: { url: '', name: 'Pixel texture', width: 64, height: 64 },
      },
    })
    return newId
  },""",
    """    set((s) =>
      withPixelTextureBump(s, newId, {
        pixelDocuments: docs,
        pixelEditorDocId: newId,
        objectTextures: {
          ...s.objectTextures,
          [newId]: { url: '', name: 'Pixel texture', width: 64, height: 64 },
        },
      })
    )
    return newId
  },""",
)

# Fix createNewPixelDocument — missing )
text = text.replace(
    """    set((s) => withPixelTextureBump(s, docId, {
      pixelDocuments: docs,
      pixelEditorDocId: docId,
      objectTextures: {
        ...s.objectTextures,
        [docId]: { url: '', name: 'Pixel texture', width, height },
      },
    })
    if (linkObjectId) {""",
    """    set((s) =>
      withPixelTextureBump(s, docId, {
        pixelDocuments: docs,
        pixelEditorDocId: docId,
        objectTextures: {
          ...s.objectTextures,
          [docId]: { url: '', name: 'Pixel texture', width, height },
        },
      })
    )
    if (linkObjectId) {""",
)

# Fix resize
text = text.replace(
    """    set((s) => withPixelTextureBump(s, pixelEditorDocId, {
      pixelDocuments: nextDocs,
      objectTextures: {
        ...s.objectTextures,
        [pixelEditorDocId]: {
          ...(s.objectTextures[pixelEditorDocId] ?? { url: '', name: 'Pixel texture' }),
          width,
          height,
        },
      },
    })
    get().commitHistory('Resize pixel canvas')""",
    """    set((s) =>
      withPixelTextureBump(s, pixelEditorDocId, {
        pixelDocuments: nextDocs,
        objectTextures: {
          ...s.objectTextures,
          [pixelEditorDocId]: {
            ...(s.objectTextures[pixelEditorDocId] ?? { url: '', name: 'Pixel texture' }),
            width,
            height,
          },
        },
      })
    )
    get().commitHistory('Resize pixel canvas')""",
)

# Fix import image new
text = text.replace(
    """        set((s) => withPixelTextureBump(s, docId, {
          pixelDocuments: docs,
          pixelEditorDocId: docId,
          objectTextures: {
            ...s.objectTextures,
            [docId]: { url: '', name: file.name, width: doc.width, height: doc.height },
          },
        })
        reconcileAppBlobUrls(get)""",
    """        set((s) =>
          withPixelTextureBump(s, docId, {
            pixelDocuments: docs,
            pixelEditorDocId: docId,
            objectTextures: {
              ...s.objectTextures,
              [docId]: { url: '', name: file.name, width: doc.width, height: doc.height },
            },
          })
        )
        reconcileAppBlobUrls(get)""",
)

# Fix hair
text = text.replace(
    """      set((s) => withPixelTextureBump(s, docId, {
        pixelDocuments: docs,
        objectTextures: {
          ...s.objectTextures,
          [docId]: { url: '', name: file.name, width: doc.width, height: doc.height },
        },
        hairTextureId: docId,
      })
      reconcileAppBlobUrls(get)""",
    """      set((s) =>
        withPixelTextureBump(s, docId, {
          pixelDocuments: docs,
          objectTextures: {
            ...s.objectTextures,
            [docId]: { url: '', name: file.name, width: doc.width, height: doc.height },
          },
          hairTextureId: docId,
        })
      )
      reconcileAppBlobUrls(get)""",
)

# Fix import project
text = text.replace(
    """      set((s) =>

    withPixelTextureBump(s, docId, {
        pixelDocuments: registerPixelDocument(s.pixelDocuments, doc),
        pixelEditorDocId: docId,
        objectTextures: {
          ...s.objectTextures,
          [docId]: {
            url: '',
            name: file.name.replace(/\\.[^.]+$/, ''),
            width: doc.width,
            height: doc.height,
          },
        },
      })
      reconcileAppBlobUrls(get)""",
    """      set((s) =>
        withPixelTextureBump(s, docId, {
          pixelDocuments: registerPixelDocument(s.pixelDocuments, doc),
          pixelEditorDocId: docId,
          objectTextures: {
            ...s.objectTextures,
            [docId]: {
              url: '',
              name: file.name.replace(/\\.[^.]+$/, ''),
              width: doc.width,
              height: doc.height,
            },
          },
        })
      )
      reconcileAppBlobUrls(get)""",
)

# Replace entire layer ops block
old_layers = """  addPixelEditorLayer: () => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) => withPixelTextureBump(s, docId, {
      pixelDocuments: addPixelLayer(s.pixelDocuments, docId),

    })

    )
  ,

  deletePixelEditorLayer: (layerId) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>

    withPixelTextureBump(s, docId, {
      pixelDocuments: deletePixelLayer(s.pixelDocuments, docId, layerId),

    })

    )
  ,

  duplicatePixelEditorLayer: (layerId) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>

    withPixelTextureBump(s, docId, {
      pixelDocuments: duplicatePixelLayer(s.pixelDocuments, docId, layerId),

    })

    )
  ,

  mergePixelEditorLayerDown: (layerId) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>

    withPixelTextureBump(s, docId, {
      pixelDocuments: mergeLayerDown(s.pixelDocuments, docId, layerId),

    })

    )
  ,

  reorderPixelEditorLayer: (layerId, toIndex) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>

    withPixelTextureBump(s, docId, {
      pixelDocuments: reorderPixelLayer(s.pixelDocuments, docId, layerId, toIndex),

    })

    )
  ,

  patchPixelEditorLayer: (layerId, patch) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>

    withPixelTextureBump(s, docId, {
      pixelDocuments: patchPixelLayer(s.pixelDocuments, docId, layerId, patch),

    })

    )
  ,"""

new_layers = """  addPixelEditorLayer: () => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>
      withPixelTextureBump(s, docId, {
        pixelDocuments: addPixelLayer(s.pixelDocuments, docId),
      })
    )
  },

  deletePixelEditorLayer: (layerId) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>
      withPixelTextureBump(s, docId, {
        pixelDocuments: deletePixelLayer(s.pixelDocuments, docId, layerId),
      })
    )
  },

  duplicatePixelEditorLayer: (layerId) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>
      withPixelTextureBump(s, docId, {
        pixelDocuments: duplicatePixelLayer(s.pixelDocuments, docId, layerId),
      })
    )
  },

  mergePixelEditorLayerDown: (layerId) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>
      withPixelTextureBump(s, docId, {
        pixelDocuments: mergeLayerDown(s.pixelDocuments, docId, layerId),
      })
    )
  },

  reorderPixelEditorLayer: (layerId, toIndex) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>
      withPixelTextureBump(s, docId, {
        pixelDocuments: reorderPixelLayer(s.pixelDocuments, docId, layerId, toIndex),
      })
    )
  },

  patchPixelEditorLayer: (layerId, patch) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) =>
      withPixelTextureBump(s, docId, {
        pixelDocuments: patchPixelLayer(s.pixelDocuments, docId, layerId, patch),
      })
    )
  },"""

if old_layers not in text:
    raise SystemExit('layers block not found')
text = text.replace(old_layers, new_layers, 1)

p.write_text(text, encoding='utf-8')
print('fixed')
