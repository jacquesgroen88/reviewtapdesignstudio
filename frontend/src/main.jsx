import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/index.css'

// A deploy rotates asset hashes; a tab opened before the deploy can no longer
// fetch lazy chunks (the SPA fallback returns index.html instead of a 404).
// Core libs (QR, PDF, TIFF) are bundled statically, so this only fires for
// the remaining lazy deps (e.g. background removal). Tell the user instead
// of failing silently — never auto-reload, that would lose unsaved canvas work.
window.addEventListener('vite:preloadError', () => {
  alert('ReviewTap Studio was updated since this tab was opened.\nSave your design, then refresh the page to continue.')
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
