import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { APP_NAME } from './app/branding'
import { applyTheme } from './theme/applyTheme'
import { readStoredThemeId } from './theme/bootstrapTheme'

document.title = APP_NAME
applyTheme(readStoredThemeId())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
