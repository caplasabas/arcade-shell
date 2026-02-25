declare global {
  interface Window {
    __ARCADE_INPUT__?: (payload: any) => void
  }
}

import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import './styles/base.css'
import App from './App'

function connect() {
  const ws = new WebSocket('ws://localhost:5175')

  ws.onopen = () => {
    console.log(`[WS_OPEN]: ${'ws://localhost:5175'}`);
  }

  ws.onmessage = e => {
    try {
      const payload = JSON.parse(e.data)
      console.log('[WS_MESSAGE]:', payload)

      window.__ARCADE_INPUT__?.(payload)
    } catch {
    }
  }

  ws.onclose = () => {
    console.log('[WS_CLOSE]')
    setTimeout(connect, 1000)
  }

  ws.onerror = (error) => {
    console.log('[WS_ERROR]:', error)

    ws.close()
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
    <App/>
  </StrictMode>,
)
