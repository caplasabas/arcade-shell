import { loadServiceConfig } from './config.js'
import { createBackendClient } from './device/backend.js'
import { loadDeviceIdentity } from './device/identity.js'
import { createDevicePresenceTracker } from './device/presence.js'
import { createHttpApi } from './api/http.js'
import { createLocalWebSocketHub } from './api/ws.js'
import { createGameLauncher } from './runtime/launcher.js'
import { createOsIntegration } from './runtime/osIntegration.js'
import { createProcessSupervisor } from './runtime/processSupervisor.js'
import { createBalanceStore } from './state/balanceStore.js'
import { createRuntimeStateStore } from './state/runtimeState.js'
import { createSessionManager } from './session/sessionManager.js'

export function createServiceApp() {
  const config = loadServiceConfig()
  const identity = loadDeviceIdentity({
    isPi: config.isPi,
    devInputBypassEnabled: config.devInputBypassEnabled,
  })
  const balanceStore = createBalanceStore()
  const runtimeStateStore = createRuntimeStateStore()
  const presenceTracker = createDevicePresenceTracker()
  const processSupervisor = createProcessSupervisor()
  const launcher = createGameLauncher(config)
  const backendClient = createBackendClient({
    config,
    identity,
    presenceTracker,
    balanceStore,
    processSupervisor,
    launcher,
  })
  const sessionManager = createSessionManager(balanceStore)
  const eventHub = createLocalWebSocketHub()
  const osIntegration = createOsIntegration(config.isPi)

  const app = createHttpApi({
    config,
    identity,
    backendClient,
    balanceStore,
    sessionManager,
    runtimeStateStore,
    presenceTracker,
    processSupervisor,
    launcher,
    eventHub,
  })

  return {
    app,
    config,
    identity,
    runtimeStateStore,
    presenceTracker,
    processSupervisor,
    eventHub,
    osIntegration,
  }
}

export function startService() {
  const { app, config } = createServiceApp()
  return app.listen(config.port, config.host, () => {
    console.log(`[SERVICE:TS] ${config.localApiOrigin}`)
  })
}
