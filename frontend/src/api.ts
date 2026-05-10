export type Pixel = [number, number, number]

export type ImageRecord = {
  id: number
  filename: string
  original_name: string
  type: 'image' | 'gif'
  width: number
  height: number
  uploaded_at: string
}

export const WIDTH = 20
export const HEIGHT = 15
export const LED_COUNT = WIDTH * HEIGHT

export function getDefaultBaseUrl() {
  const { hostname, origin, port, protocol } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8000'
  }
  if (port && port !== '8000') {
    return `${protocol}//${hostname}:8000`
  }
  if (hostname) {
    return origin
  }
  return 'http://ledmatrix.local:8000'
}

export function getBaseUrl() {
  const saved = localStorage.getItem('led_host')
  const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  if (isLocalDev && saved?.includes('ledmatrix.local')) {
    return getDefaultBaseUrl()
  }
  return saved || getDefaultBaseUrl()
}

export function getWsUrl() {
  const base = new URL(getBaseUrl())
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = '/ws'
  base.search = ''
  return base.toString()
}

export function getPasskey() {
  return localStorage.getItem('led_passkey') || ''
}

function authHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers)
  const passkey = getPasskey()
  if (passkey) {
    merged.set('Authorization', `Bearer ${passkey}`)
  }
  return merged
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: authHeaders(options.headers),
  })
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = body.detail || detail
    } catch {
      // Leave the HTTP status text in place.
    }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export function frameUrl(imageId: number) {
  return `${getBaseUrl()}/api/images/${imageId}/file`
}

export function clearFrame() {
  return request<{ pixels: Pixel[] }>('/api/clear', {
    method: 'POST',
  })
}

export function setBrightness(brightness: number) {
  return request<{ brightness: number }>('/api/brightness', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ brightness }),
  })
}

export function listImages() {
  return request<ImageRecord[]>('/api/images')
}

export function uploadImage(file: File) {
  const body = new FormData()
  body.append('file', file)
  return request<ImageRecord>('/api/images/upload', {
    method: 'POST',
    body,
  })
}

export function displayImage(id: number) {
  return request<{ status: string; id: number }>(`/api/images/${id}/display`, {
    method: 'POST',
  })
}

export function deleteImage(id: number) {
  return request<ImageRecord>(`/api/images/${id}`, {
    method: 'DELETE',
  })
}

export async function fetchImageBlob(imageId: number) {
  const response = await fetch(`${getBaseUrl()}/api/images/${imageId}/file`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = body.detail || detail
    } catch {
      // Leave the HTTP status text in place.
    }
    throw new Error(detail)
  }
  return response.blob()
}
