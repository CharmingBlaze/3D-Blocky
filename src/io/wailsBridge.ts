type WailsAppApi = {
  PickOpenFile: (
    title: string,
    filterName: string,
    extensions: string[]
  ) => Promise<string>
  PickSaveFile: (
    title: string,
    defaultName: string,
    filterName: string,
    extensions: string[]
  ) => Promise<string>
  ReadFileBase64: (path: string) => Promise<string>
  WriteFileBase64: (path: string, encoded: string) => Promise<void>
  WriteTextFile: (path: string, content: string) => Promise<void>
}

function appApi(): WailsAppApi {
  const api = (
    window as Window & {
      go?: { main?: { App?: Partial<WailsAppApi> } }
    }
  ).go?.main?.App
  if (
    !api?.PickOpenFile ||
    !api.PickSaveFile ||
    !api.ReadFileBase64 ||
    !api.WriteFileBase64 ||
    !api.WriteTextFile
  ) {
    throw new Error('Quadlo desktop file API is unavailable.')
  }
  return api as WailsAppApi
}

export const wailsPickOpen = (
  title: string,
  filterName: string,
  extensions: string[]
): Promise<string> => appApi().PickOpenFile(title, filterName, extensions)

export const wailsPickSave = (
  title: string,
  defaultName: string,
  filterName: string,
  extensions: string[]
): Promise<string> =>
  appApi().PickSaveFile(title, defaultName, filterName, extensions)

export const wailsReadBase64 = (path: string): Promise<string> =>
  appApi().ReadFileBase64(path)

export const wailsWriteBase64 = (
  path: string,
  encoded: string
): Promise<void> => appApi().WriteFileBase64(path, encoded)

export const wailsWriteText = (
  path: string,
  content: string
): Promise<void> => appApi().WriteTextFile(path, content)
