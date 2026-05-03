const isDev = import.meta.env.DEV

export const API_BASE = isDev ? 'http://localhost:5174' : window.location.origin
export const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:5175`
