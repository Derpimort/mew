import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/tailwind.css'
import './ui/tokens.css'
import './ui/primitives/primitives.css'
import './ui/components/components.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
