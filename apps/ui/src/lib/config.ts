import { supabase } from './supabase'

export async function fetchLiveConfig() {
  const { data } = await supabase.from('live_config').select('*').eq('id', true).single()

  return data
}

export function subscribeLiveConfig(onUpdate: (cfg: any) => void) {
  return supabase
    .channel('live-config')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'live_config',
      },
      payload => {
        onUpdate(payload.new)
      },
    )
    .subscribe()
}
