import { supabase } from './supabase'

export type DeviceBalanceSnapshot = {
  balance: number
  deploymentMode: string | null
  updatedAt: string | null
  revision: number
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function computeDeviceRevision(raw: Record<string, unknown>): number {
  return (
    toNumber(raw.coins_in_total) +
    toNumber(raw.hopper_in_total) +
    toNumber(raw.hopper_out_total) +
    toNumber(raw.bet_total) +
    toNumber(raw.win_total) +
    toNumber(raw.withdraw_total) +
    toNumber(raw.spins_total)
  )
}

export async function fetchDeviceBalance(deviceId: string): Promise<DeviceBalanceSnapshot> {
  const { data, error } = await supabase
    .from('device_stats_live')
    .select(
      'balance, deployment_mode, updated_at, coins_in_total, hopper_in_total, hopper_out_total, bet_total, win_total, withdraw_total, spins_total',
    )
    .eq('device_id', deviceId)
    .single()

  if (error) throw error

  return {
    balance: toNumber(data.balance),
    deploymentMode:
      data.deployment_mode === null || data.deployment_mode === undefined
        ? null
        : String(data.deployment_mode || '').trim() || null,
    updatedAt: data.updated_at ?? null,
    revision: computeDeviceRevision(data as Record<string, unknown>),
  }
}

export function subscribeToDeviceBalance(
  deviceId: string,
  onChange: (snapshot: DeviceBalanceSnapshot) => void,
) {
  let disposed = false
  let reconnectTimer: number | null = null
  let channel: ReturnType<typeof supabase.channel> | null = null

  const syncLatest = async () => {
    try {
      const latest = await fetchDeviceBalance(deviceId)
      if (!disposed) {
        onChange(latest)
      }
    } catch {
      // Keep subscription alive; periodic/app-level recovery handles retries.
    }
  }

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      if (!disposed) {
        connect()
      }
    }, 1500)
  }

  const connect = () => {
    if (disposed) return
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }

    channel = supabase
      .channel(`device-balance-${deviceId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'devices',
          filter: `device_id=eq.${deviceId}`,
        },
        () => {
          void syncLatest()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'device_daily_stats',
          filter: `device_id=eq.${deviceId}`,
        },
        () => {
          void syncLatest()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'device_admin_ledger_entries',
          filter: `device_id=eq.${deviceId}`,
        },
        () => {
          void syncLatest()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'device_arcade_events',
          filter: `device_id=eq.${deviceId}`,
        },
        () => {
          void syncLatest()
        },
      )
      .subscribe(status => {
        if (disposed) return

        if (status === 'SUBSCRIBED') {
          syncLatest()
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleReconnect()
        }
      })
  }

  connect()

  return () => {
    disposed = true
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }
}
