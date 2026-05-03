import { defineConfig } from 'vite'
// @ts-ignore
import react from '@vitejs/plugin-react'

// function arcadeInputPlugin() {
//   return {
//     name: 'arcade-input-plugin',
//
//     configureServer(server) {
//       server.middlewares.use('/input', (req, res) => {
//         if (req.method !== 'POST') {
//           res.statusCode = 405
//           res.end('Method Not Allowed')
//           return
//         }
//
//         let body = ''
//
//         req.on('data', chunk => {
//           body += chunk
//         })
//
//         req.on('end', () => {
//           try {
//             const payload = JSON.parse(body || '{}')
//
//             console.log('[ARCADE INPUT]', payload)
//
//             /**
//              * IMPORTANT:
//              * Vite HMR reliably transports STRINGS only.
//              * Always stringify payloads.
//              */
//             server.ws.send({
//               type: 'custom',
//               event: 'arcade-input',
//               data: JSON.stringify(payload),
//             })
//
//             res.statusCode = 200
//             res.end('OK')
//           } catch (err) {
//             console.error('[ARCADE INPUT] Invalid JSON:', body)
//             res.statusCode = 400
//             res.end('Invalid JSON')
//           }
//         })
//       })
//     },
//   }
// }

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'
  const isDev = !isProd
  console.log(isDev)
  return {
    base: './',
    plugins: [react()].filter(Boolean),
    server: {
      host: '0.0.0.0',
      port: 5173,
      watch: {
        usePolling: true,
        interval: 100,
      },
    },
  }
})
