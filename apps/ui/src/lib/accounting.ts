import { supabase } from './supabase'

export async function logLedgerEvent({
  deviceId,
  type,
  amount,
  source,
  metadata,
}: {
  deviceId: string
  type: 'deposit' | 'withdrawal' | 'play' | 'bet' | 'win'
  amount: number
  source?: string
  metadata?: any
}) {
  const delta = type === 'withdrawal' || type === 'bet' ? -amount : amount

  const { error } = await supabase.from('device_ledger').insert({
    device_id: deviceId,
    type,
    amount,
    balance_delta: delta,
    source,
    metadata,
  })

  if (error) {
    console.error('[ledger] insert failed', error)
    throw error
  }
}
