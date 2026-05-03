import { startService } from './index.js'

const server = startService()

function shutdown(signal: string) {
  console.log(`[SERVICE:TS] shutdown requested (${signal})`)
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
