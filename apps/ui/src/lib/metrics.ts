import { supabase } from './supabase'

export type MetricEventType = 'coins_in' | 'hopper_in' | 'withdrawal' | 'bet' | 'win' | 'spin'

export type MetricEvent = {
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
  metadata?: Record<string, unknown>
}

const FLUSH_SOON_MS = Number(import.meta.env.VITE_METRIC_FLUSH_SOON_MS ?? 20)
const buckets = new Map<string, MetricBucket>()
let flushInFlight = false
let flushTimer: number | null = null

const shouldWriteLedger = import.meta.env.VITE_METRIC_WRITE_LEDGER === '1'

export async function applyMetricEventsDirect(
  events: MetricEvent[],
  writeLedger = shouldWriteLedger,
) {
  const { error } = await supabase.rpc('apply_metric_events', {
    p_events: events,
    p_write_ledger: writeLedger,
  })

  if (error) throw error
}

function getBucketKey(deviceId: string, eventType: MetricEventType) {
  return `${deviceId}::${eventType}`
}

function scheduleFlushSoon(delayMs = FLUSH_SOON_MS) {
  if (flushTimer) return

  flushTimer = window.setTimeout(
    () => {
      flushTimer = null
      void flushMetricEvents()
    },
    Math.max(0, delayMs),
  )
}

export function queueMetricEvent(
  deviceId: string,
  eventType: MetricEventType,
  amount: number,
  eventTs = new Date().toISOString(),
) {
  const safeAmount = Number(amount || 0)
  if (!deviceId || safeAmount <= 0) return

  console.log('[METRICS] queued', {
    deviceId,
    eventType,
    amount,
    size: buckets.size,
  })
  const key = getBucketKey(deviceId, eventType)
  const existing = buckets.get(key)

  if (existing) {
    existing.amount += safeAmount
  } else {
    buckets.set(key, {
      device_id: deviceId,
      event_type: eventType,
      amount: safeAmount,
      event_ts: eventTs,
    })
  }

  scheduleFlushSoon()
  void flushMetricEvents()
}

export async function flushMetricEvents() {
  if (flushInFlight) {
    console.warn('[METRICS] flush skipped (in flight)')
    return
  }
  if (buckets.size === 0) return

  flushInFlight = true

  const snapshot = [...buckets.values()].map(item => ({ ...item }))
  console.log('[METRICS] flushing', snapshot.length)
  buckets.clear()

  try {
    console.log('[METRICS] payload', snapshot)
    await applyMetricEventsDirect(snapshot as MetricEvent[], shouldWriteLedger)
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
