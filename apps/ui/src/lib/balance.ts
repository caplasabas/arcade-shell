import { supabase } from './supabase'

export async function fetchDeviceBalance(deviceId: string) {
  const { data, error } = await supabase
    .from('devices')
    .select('balance')
    .eq('device_id', deviceId)
    .single()

  if (error) throw error

  return data.balance ?? 0
}

export function subscribeToDeviceBalance(deviceId: string, onChange: (balance: number) => void) {
  const channel = supabase
    .channel(`device-balance-${deviceId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'devices',
        filter: `device_id=eq.${deviceId}`,
      },
      payload => {
        onChange(payload.new.balance)
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
