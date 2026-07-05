import { createContext, useContext } from 'react'

export const ViewportDomContext = createContext<HTMLElement | null>(null)

export function useViewportDom(): HTMLElement | null {
  return useContext(ViewportDomContext)
}
