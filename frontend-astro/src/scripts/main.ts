import { BACKEND_URL_DEFAULT, GRID_WIDTH, GRID_HEIGHT } from './constants'

export type PixelUpdate = {
    x: number
    y: number
    r: number
    g: number
    b: number
}

export const state = {
    backendUrl: BACKEND_URL_DEFAULT,
    passkey: '',
    color: '#ff00000',
    ws: null as null | WebSocket, // WebSocket connection to backend. if null, we are not connected.
}

export function main() {
    let canvas = document.querySelector('canvas.matrix-canvas') as HTMLCanvasElement

    const passkey = localStorage.getItem('passkey')
    if (passkey) {
        state.passkey = passkey
    }

    const setupWSPoller = () => {
        if (!state.ws) {
            setupWSListener(state.backendUrl, (update) => putPixel(canvas, update))
        }
    }

    // Setup mouse drawing
    setupCanvasDrawing(canvas)

    setupWSPoller()
    setInterval(setupWSPoller, 3000)
}

export function setPasskey(passkey: string) {
    state.passkey = passkey
    localStorage.setItem('passkey', passkey)
}

function setupWSListener(backendUrl: string, pixelUpdate: (update: PixelUpdate) => void) {
    state.ws?.close()
    state.ws = null
    // Convert http/https to ws/wss
    const wsUrl = backendUrl
        .replace(/^http:/, 'ws:')
        .replace(/^https:/, 'wss:') + '/ws'
    
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => { state.ws = ws; console.log('websocket opened') }
    ws.onclose = () => { 
        console.log('websocket closed')
        state.ws = null
    }
    ws.onmessage = (event) => {
        const parsed = JSON.parse(event.data) as PixelUpdate[]
        parsed.forEach(pixelUpdate)
    }
    ws.onerror = (event) => {
        console.error('websocket error', event)
    }
}

function putPixel(canvas: HTMLCanvasElement, update : PixelUpdate) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return
    const id = ctx.createImageData(1, 1);
    const d = id.data;

    // Set RGBA values (0-255)
    d[0] = update.r; // Red
    d[1] = update.g;   // Green
    d[2] = update.b;   // Blue
    d[3] = 255; // Alpha (Opacity)

    // Paint the pixel onto the canvas at (x, y)
    ctx.putImageData(id, update.x, update.y);
}

function setupCanvasDrawing(canvas: HTMLCanvasElement) {
    let isDrawing = false

    const getPixelFromMouse = (e: MouseEvent): { x: number; y: number } | null => {
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        // Calculate which pixel was clicked based on canvas dimensions
        const pixelX = Math.floor((x / rect.width) * GRID_WIDTH)
        const pixelY = Math.floor((y / rect.height) * GRID_HEIGHT)

        // Check bounds
        if (pixelX < 0 || pixelX >= GRID_WIDTH || pixelY < 0 || pixelY >= GRID_HEIGHT) {
            return null
        }

        return { x: pixelX, y: pixelY }
    }

    const drawPixel = (pixelCoords: { x: number; y: number }) => {
        // Parse color from hex to RGB
        const color = state.color.replace('#', '')
        const r = parseInt(color.substring(0, 2), 16)
        const g = parseInt(color.substring(2, 4), 16)
        const b = parseInt(color.substring(4, 6), 16)

        const update: PixelUpdate = {
            x: pixelCoords.x,
            y: pixelCoords.y,
            r,
            g,
            b,
        }

        // Draw locally first
        putPixel(canvas, update)

        // Send to backend via WebSocket
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
                x: pixelCoords.x,
                y: pixelCoords.y,
                r,
                g,
                b,
                auth: state.passkey,
            }))
        }
    }

    canvas.addEventListener('mousedown', (e) => {
        isDrawing = true
        const pixel = getPixelFromMouse(e)
        if (pixel) {
            drawPixel(pixel)
        }
    })

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return
        const pixel = getPixelFromMouse(e)
        if (pixel) {
            drawPixel(pixel)
        }
    })

    canvas.addEventListener('mouseup', () => {
        isDrawing = false
    })

    canvas.addEventListener('mouseleave', () => {
        isDrawing = false
    })

    // Touch support for mobile
    canvas.addEventListener('touchstart', (e) => {
        isDrawing = true
        const touch = e.touches[0]
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY,
        })
        canvas.dispatchEvent(mouseEvent)
    })

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault()
        if (!isDrawing) return
        const touch = e.touches[0]
        const pixel = getPixelFromMouse(new MouseEvent('', {
            clientX: touch.clientX,
            clientY: touch.clientY,
        }))
        if (pixel) {
            drawPixel(pixel)
        }
    })

    canvas.addEventListener('touchend', () => {
        isDrawing = false
    })
}

export function switchPage(page: string) {
    console.log('switching to page', page)
}

export function switchColor(color: string) {
    state.color = color
    console.log('switching to color', color)
}