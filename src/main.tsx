import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { applyTheme } from './theme/applyTheme'
import { readStoredThemeId } from './theme/bootstrapTheme'

applyTheme(readStoredThemeId())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
