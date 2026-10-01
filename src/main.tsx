import 'core-js/stable' // organize-imports-ignore
import 'css/index.scss' // organize-imports-ignore
import './bootstrap/registerServiceWorker' // organize-imports-ignore
import App from 'components/App'
import { AppStatusProvider } from 'context/useAppStatus'
import { ThemeProvider } from 'context/useTheme'
import { createRoot } from 'react-dom/client'

/*
 * No StrictMode wrapper: the app has never had one, and introducing it would double-invoke every
 * effect and change runtime behaviour.
 */
const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

createRoot(container).render(
  <AppStatusProvider>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </AppStatusProvider>
)
