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
  const channel = supabase
    .channel(`games-${deviceId}`)
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
    .subscribe()

  return () => supabase.removeChannel(channel)
}

export function subscribeToCabinetGames(deviceId: string, onChange: () => void) {
  const channel = supabase
    .channel(`cabinet-games-${deviceId}`)
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
    .subscribe()

  return () => supabase.removeChannel(channel)
}
