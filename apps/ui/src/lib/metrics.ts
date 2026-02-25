import { supabase } from './supabase'

export type MetricEventType = 'coins_in' | 'hopper_in' | 'withdrawal' | 'bet' | 'win'

type MetricEvent = {
  device_id: string
  event_type: MetricEventType
  amount: number
  event_ts: string
  metadata?: Record<string, unknown>
}

type MetricBucket = {
  device_id: string
  event_type: MetricEventType
  amount: number
  event_ts: string
}

const buckets = new Map<string, MetricBucket>()
let flushInFlight = false

const shouldWriteLedger = import.meta.env.VITE_METRIC_WRITE_LEDGER === '1'

function getBucketKey(deviceId: string, eventType: MetricEventType) {
  return `${deviceId}::${eventType}`
}

export function queueMetricEvent(
  deviceId: string,
  eventType: MetricEventType,
  amount: number,
  eventTs = new Date().toISOString(),
) {
  const safeAmount = Number(amount || 0)
  if (!deviceId || safeAmount <= 0) return

  const key = getBucketKey(deviceId, eventType)
  const existing = buckets.get(key)

  if (existing) {
    existing.amount += safeAmount
    existing.event_ts = eventTs
    return
  }

  buckets.set(key, {
    device_id: deviceId,
    event_type: eventType,
    amount: safeAmount,
    event_ts: eventTs,
  })
}

export async function flushMetricEvents() {
  if (flushInFlight) return
  if (buckets.size === 0) return

  flushInFlight = true

  const snapshot = [...buckets.values()].map(item => ({ ...item }))
  buckets.clear()

  try {
    const { error } = await supabase.rpc('apply_metric_events', {
      p_events: snapshot as MetricEvent[],
      p_write_ledger: shouldWriteLedger,
    })

    if (error) {
      throw error
    }
  } catch (error) {
    // Requeue the failed batch so transient outages do not drop counters.
    for (const item of snapshot) {
      queueMetricEvent(item.device_id, item.event_type, item.amount, item.event_ts)
    }

    console.error('[metrics] flush failed', error)
  } finally {
    flushInFlight = false
  }
}
