import os from 'node:os'

import type { NetworkInfo } from '../types.js'

export function getNetworkInfo(isPi: boolean): NetworkInfo {
  const nets = os.networkInterfaces()

  const getExternalIpv4 = (name: string) => {
    const entries = nets[name] || []
    return entries.find(entry => entry && entry.family === 'IPv4' && !entry.internal) || null
  }

  if (!isPi) {
    const entries = Object.entries(nets)
      .map(([name, list]) => ({
        name,
        ipv4:
          (list || []).find(entry => entry && entry.family === 'IPv4' && !entry.internal) || null,
      }))
      .filter(entry => entry.ipv4)

    const wifiEntry =
      entries.find(entry => /^(wi-?fi|wlan|wl|airport|en0)$/i.test(entry.name)) || null
    const ethernetEntry =
      entries.find(
        entry => entry.name !== wifiEntry?.name && /^(eth|en|bridge|lan)/i.test(entry.name),
      ) || null
    const fallbackEntry = entries[0] || null

    return {
      ethernet:
        ethernetEntry?.ipv4?.address || (!wifiEntry ? fallbackEntry?.ipv4?.address || null : null),
      wifi: wifiEntry?.ipv4?.address || null,
      ethernet_name: ethernetEntry?.name || (!wifiEntry ? fallbackEntry?.name || null : null),
      wifi_name: wifiEntry?.name || null,
    }
  }

  return {
    ethernet: getExternalIpv4('eth0')?.address || null,
    wifi: getExternalIpv4('wlan0')?.address || null,
    ethernet_name: getExternalIpv4('eth0') ? 'ETHERNET' : null,
    wifi_name: getExternalIpv4('wlan0') ? 'wlan0' : null,
  }
}
