import { supabase } from './supabase'

export async function fetchCabinetGames(deviceId: string) {
  const { data, error } = await supabase
    .from('cabinet_visible_games')
    .select('*')
    .eq('device_id', deviceId)
    .order('name')

  if (error) throw error
  return (data ?? []).map(g => ({
    id: g.id,
    name: g.name,
    type: g.type,
    price: g.price,
    art: g.box_art_url,
    emulator_core: g.emulator_core,
    rom_path: g.rom_path,
  }))
}

export function subscribeToGames(
  deviceId: string,
  onChange: () => void,
  onDisable?: (gameId: string) => void,
) {
  let disposed = false
  let reconnectTimer: number | null = null
  let channel: ReturnType<typeof supabase.channel> | null = null

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
      .channel(`games-${deviceId}-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games' }, payload => {
        const oldRow = payload.old
        const newRow = payload.new

        const relevant = oldRow.enabled !== newRow.enabled || oldRow.version !== newRow.version
        if (!relevant) return

        if (newRow.enabled === false && onDisable) {
          onDisable(newRow.id)
        }

        onChange()
      })
      .subscribe(status => {
        if (disposed) return

        if (status === 'SUBSCRIBED') {
          onChange()
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

export function subscribeToCabinetGames(deviceId: string, onChange: () => void) {
  let disposed = false
  let reconnectTimer: number | null = null
  let channel: ReturnType<typeof supabase.channel> | null = null

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
      .channel(`cabinet-games-${deviceId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cabinet_games',
          filter: `device_id=eq.${deviceId}`,
        },
        () => {
          onChange()
        },
      )
      .subscribe(status => {
        if (disposed) return

        if (status === 'SUBSCRIBED') {
          onChange()
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
