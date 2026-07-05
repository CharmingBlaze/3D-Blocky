export interface LoadedImageFile {
  url: string
  name: string
  width: number
  height: number
}

export async function loadImageFile(file: File): Promise<LoadedImageFile> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please drop an image file (PNG, JPG, etc.)')
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not read image'))
      el.src = url
    })
    return {
      url,
      name: file.name.replace(/\.[^.]+$/, '') || 'Image',
      width: img.naturalWidth,
      height: img.naturalHeight,
    }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}
