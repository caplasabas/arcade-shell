declare global {
  interface Window {
    __ARCADE_INPUT__?: (payload: any) => void
    __ARCADE_PENDING_INPUTS__?: any[]
  }
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import { API_BASE } from './lib/runtime'

import App from './App'

function connect() {
  const events = new EventSource(`${API_BASE}/events`)

  events.onopen = () => {}

  events.onmessage = e => {
    try {
      const payload = JSON.parse(e.data)
      if (typeof window.__ARCADE_INPUT__ === 'function') {
        window.__ARCADE_INPUT__(payload)
        return
      }

      if (!Array.isArray(window.__ARCADE_PENDING_INPUTS__)) {
        window.__ARCADE_PENDING_INPUTS__ = []
      }
      window.__ARCADE_PENDING_INPUTS__.push(payload)
    } catch {}
  }

  events.onerror = () => {
    events.close()
    setTimeout(connect, 1000)
  }
}

connect()

// if (import.meta.hot) {
//   import.meta.hot.accept()
//
//   import.meta.hot.on('arcade-input', (raw: any) => {
//     console.log('[ARCADE INPUT RAW]', raw)
//
//     let payload: any
//
//     try {
//       payload = typeof raw === 'string' ? JSON.parse(raw) : raw
//     } catch {
//       console.warn('[ARCADE INPUT] Invalid JSON:', raw)
//       return
//     }
//
//     // ✅ NORMALIZATION LAYER (CRITICAL)
//     // if (
//     //   payload?.type &&
//     //   payload.type !== 'ACTION' &&
//     //   payload.type !== 'COIN' &&
//     //   payload.type !== 'WITHDRAW_DISPENSE' &&
//     //   payload.type !== 'WITHDRAW_COMPLETE'
//     // ) {
//     //   payload = {
//     //     type: 'ACTION',
//     //     action: payload.type,
//     //   }
//     // }
//
//     window.__ARCADE_INPUT__?.(payload)
//   })
// }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
