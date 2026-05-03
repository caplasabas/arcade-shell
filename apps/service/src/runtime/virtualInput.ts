import { spawn } from 'node:child_process'

export function createVirtualInputRuntime(options: any) {
  const {
    logger = console,
    isPi,
    helperPath,
    staggerMs,
    setVirtualP1,
    setVirtualP2,
  } = options

  function startVirtualDevice(name: any) {
    if (!isPi) {
      logger.log(`[VIRTUAL] compat-mode skipping ${name}`)
      return null
    }

    const proc = spawn(helperPath, [name], {
      stdio: ['pipe', 'ignore', 'ignore'],
    })

    proc.on('spawn', () => {
      logger.log(`[VIRTUAL] ${name} created (pid=${proc.pid})`)
    })

    proc.on('error', err => {
      logger.error(`[VIRTUAL] ${name} failed (${helperPath})`, err.message)
    })

    return proc
  }

  function sleep(ms: any) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async function startVirtualDevices() {
    setVirtualP1(startVirtualDevice('Arcade Virtual P1'))
    await sleep(staggerMs)
    setVirtualP2(startVirtualDevice('Arcade Virtual P2'))
    logger.log('[VIRTUAL] P1 then P2 initialized')
  }

  return {
    startVirtualDevice,
    startVirtualDevices,
  }
}
