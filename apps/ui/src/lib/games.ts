import { supabase } from './supabase'

function resolveGameArt(boxArtUrl: unknown) {
  const raw = String(boxArtUrl ?? '').trim()
  if (!raw) return raw

  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
    return raw
  }

  if (raw.startsWith('assets/boxart/')) {
    const fileName = raw.slice('assets/boxart/'.length)
    return `/roms/boxart/${fileName}`
  }

  return raw
}

export async function fetchCabinetGames(deviceId: string) {
  const normalizeGames = (data: any[]) =>
    (data ?? [])
      .map((row: any) => row.games ?? row)
      .filter(Boolean)
      .map((g: any) => ({
        id: g.id,
        name: g.name,
        type: g.type,
        price: g.price,
        join_mode: g.join_mode,
        art: resolveGameArt(g.box_art_url ?? g.art),
        emulator_core: g.emulator_core,
        rom_path: g.rom_path,
        package_url: g.package_url,
        version: g.version,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

  try {
    const { data, error } = await supabase
      .from('cabinet_games')
      .select(
        `
        device_id,
        game_id,
        games!inner(
          id,
          name,
          type,
          price,
          join_mode,
          box_art_url,
          emulator_core,
          rom_path,
          package_url,
          version,
          enabled
        )
      `,
      )
      .eq('device_id', deviceId)
      .eq('installed', true)
      .eq('games.enabled', true)

    if (error) throw error

    const directGames = normalizeGames(data ?? [])
    if (directGames.length > 0) return directGames
  } catch {
    // Fall through to the cabinet-local endpoint.
  }

  const response = await fetch(`http://127.0.0.1:5174/cabinet-games?deviceId=${encodeURIComponent(deviceId)}`)
  if (!response.ok) throw new Error(`cabinet-games fallback failed (${response.status})`)
  const payload = (await response.json()) as { games?: any[] }

  return normalizeGames(payload.games ?? [])
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
