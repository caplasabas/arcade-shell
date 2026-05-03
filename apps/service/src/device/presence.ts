export interface DevicePresenceSnapshot {
  lastSeenAt: string | null
  lastActivityAt: string | null
}

export interface DevicePresenceTracker {
  touchSeen(now?: Date): DevicePresenceSnapshot
  touchActivity(now?: Date): DevicePresenceSnapshot
  getSnapshot(): DevicePresenceSnapshot
}

export function createDevicePresenceTracker(): DevicePresenceTracker {
  let lastSeenAt: string | null = null
  let lastActivityAt: string | null = null

  return {
    touchSeen(now = new Date()) {
      lastSeenAt = now.toISOString()
      return { lastSeenAt, lastActivityAt }
    },
    touchActivity(now = new Date()) {
      const iso = now.toISOString()
      lastSeenAt = iso
      lastActivityAt = iso
      return { lastSeenAt, lastActivityAt }
    },
    getSnapshot() {
      return { lastSeenAt, lastActivityAt }
    },
  }
}
