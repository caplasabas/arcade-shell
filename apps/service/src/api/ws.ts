export interface LocalSocketMessage<T = unknown> {
  type: string
  payload: T
}

export type LocalSocketListener = (message: LocalSocketMessage) => void

export interface LocalWebSocketHub {
  subscribe(listener: LocalSocketListener): () => void
  broadcast<T>(message: LocalSocketMessage<T>): void
}

export function createLocalWebSocketHub(): LocalWebSocketHub {
  const listeners = new Set<LocalSocketListener>()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    broadcast(message) {
      console.log('[WS] broadcast scaffold', message.type)
      for (const listener of listeners) {
        listener(message)
      }
    },
  }
}
