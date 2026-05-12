import { BACKEND_URL_DEFAULT, GRID_WIDTH, GRID_HEIGHT } from './constants'

export type PixelUpdate = {
    x: number
    y: number
    r: number
    g: number
    b: number
}

export type ImageRecord = {
    id: number
    filename: string
    original_name: string
    type: 'image' | 'gif'
    uploaded_at: string
}

export const state = {
    backendUrl: BACKEND_URL_DEFAULT,
    passkey: 'changeme',
    color: '#ff00000',
    currentPage: 'paint',
    ws: null as null | WebSocket, // WebSocket connection to backend. if null, we are not connected.
}

export function main() {
    const canvas = document.querySelector('canvas.matrix-canvas') as HTMLCanvasElement | null
    if (!canvas) {
        return
    }

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
    setupGalleryPage()

    setupWSPoller()
    switchPage('paint')
    setInterval(setupWSPoller, 3000)
}

export function setPasskey(passkey: string) {
    state.passkey = passkey
    localStorage.setItem('passkey', passkey)
}

function authHeaders(headers?: HeadersInit) {
    const merged = new Headers(headers)
    if (state.passkey) {
        merged.set('Authorization', `Bearer ${state.passkey}`)
    }
    return merged
}

async function requestJson<T>(path: string, options: RequestInit = {}) {
    const response = await fetch(`${state.backendUrl}${path}`, {
        ...options,
        headers: authHeaders(options.headers),
    })

    if (!response.ok) {
        let detail = response.statusText
        try {
            const body = await response.json()
            detail = body.detail || detail
        } catch {
            // Keep the HTTP status text when the server does not send JSON.
        }
        throw new Error(detail)
    }

    return response.json() as Promise<T>
}

async function listImages() {
    return requestJson<ImageRecord[]>('/api/images')
}

async function uploadImage(file: File) {
    const body = new FormData()
    body.append('file', file)
    return requestJson<ImageRecord>('/api/images/upload', {
        method: 'POST',
        body,
    })
}

async function displayImage(imageId: number) {
    return requestJson<{ status: string; id: number }>(`/api/images/${imageId}/display`, {
        method: 'POST',
    })
}

async function deleteImage(imageId: number) {
    return requestJson<ImageRecord>(`/api/images/${imageId}`, {
        method: 'DELETE',
    })
}

function imageUrl(imageId: number) {
    return `${state.backendUrl}/api/images/${imageId}/file`
}

function setPageVisibility(activePage: string) {
    state.currentPage = activePage

    document.querySelectorAll<HTMLElement>('[data-page-panel]').forEach((panel) => {
        panel.style.display = panel.dataset.pagePanel === activePage ? '' : 'none'
    })
}

function showGalleryStatus(message: string) {
    const status = document.getElementById('gallery-status')
    if (status) {
        status.textContent = message
    }
}

let galleryInitialized = false

function setupGalleryPage() {
    if (galleryInitialized) {
        return
    }

    const galleryPanel = document.querySelector<HTMLElement>('[data-page-panel="images"]')
    const dropZone = document.getElementById('gallery-drop-zone')
    const grid = document.getElementById('gallery-grid')
    const addButton = document.getElementById('gallery-add-button') as HTMLButtonElement | null
    const deleteModeButton = document.getElementById('gallery-delete-mode-button') as HTMLButtonElement | null
    const fileInput = document.getElementById('gallery-file-input') as HTMLInputElement | null

    if (!galleryPanel || !dropZone || !grid || !addButton || !deleteModeButton || !fileInput) {
        return
    }

    galleryInitialized = true

    const galleryState = {
        deleteMode: false,
        images: [] as ImageRecord[],
    }

    const updateDeleteModeLabel = () => {
        deleteModeButton.textContent = galleryState.deleteMode ? 'Delete mode: on' : 'Delete mode: off'
    }

    const setDropHighlight = (isHighlighted: boolean) => {
        dropZone.classList.toggle('border-primary', isHighlighted)
        dropZone.classList.toggle('bg-primary/5', isHighlighted)
    }

    const renderImages = () => {
        grid.replaceChildren()

        if (galleryState.images.length === 0) {
            const empty = document.createElement('p')
            empty.className = 'text-xs text-muted-foreground'
            empty.textContent = 'No uploads yet.'
            grid.append(empty)
            return
        }

        for (const image of galleryState.images) {
            const tile = document.createElement('button')
            tile.type = 'button'
            tile.className = 'group flex flex-col overflow-hidden border border-border bg-card text-left transition hover:-translate-y-px hover:border-foreground/30'
            tile.dataset.imageId = String(image.id)

            const preview = document.createElement('div')
            preview.className = 'aspect-[4/3] overflow-hidden bg-black'

            const previewImage = document.createElement('img')
            previewImage.src = imageUrl(image.id)
            previewImage.alt = image.original_name
            previewImage.loading = 'lazy'
            previewImage.className = 'h-full w-full object-cover'
            previewImage.style.imageRendering = 'pixelated'
            preview.append(previewImage)

            const meta = document.createElement('div')
            meta.className = 'flex flex-col gap-1 p-3'

            const title = document.createElement('div')
            title.className = 'text-xs font-medium'
            title.textContent = image.original_name

            const subtitle = document.createElement('div')
            subtitle.className = 'text-[11px] text-muted-foreground'
            subtitle.textContent = `${image.type.toUpperCase()} · ${new Date(image.uploaded_at).toLocaleString()}`

            meta.append(title, subtitle)
            tile.append(preview, meta)

            tile.addEventListener('click', async () => {
                try {
                    if (galleryState.deleteMode) {
                        const confirmed = window.confirm(`Delete ${image.original_name}?`)
                        if (!confirmed) {
                            return
                        }
                        await deleteImage(image.id)
                        showGalleryStatus(`Deleted ${image.original_name}`)
                        await refreshImages()
                        return
                    }

                    await displayImage(image.id)
                    showGalleryStatus(`Displayed ${image.original_name}`)
                } catch (error) {
                    showGalleryStatus(error instanceof Error ? error.message : 'Something went wrong')
                }
            })

            grid.append(tile)
        }
    }

    const refreshImages = async () => {
        try {
            showGalleryStatus('Loading images...')
            galleryState.images = await listImages()
            renderImages()
            showGalleryStatus(`${galleryState.images.length} image${galleryState.images.length === 1 ? '' : 's'} loaded`)
        } catch (error) {
            showGalleryStatus(error instanceof Error ? error.message : 'Unable to load images')
        }
    }

    const uploadFiles = async (files: File[]) => {
        const validFiles = files.filter((file) => file.type.startsWith('image/'))
        if (validFiles.length === 0) {
            showGalleryStatus('Please choose an image file.')
            return
        }

        try {
            showGalleryStatus(`Uploading ${validFiles.length} file${validFiles.length === 1 ? '' : 's'}...`)
            for (const file of validFiles) {
                await uploadImage(file)
            }
            await refreshImages()
            showGalleryStatus(`Uploaded ${validFiles.length} file${validFiles.length === 1 ? '' : 's'}`)
        } catch (error) {
            showGalleryStatus(error instanceof Error ? error.message : 'Upload failed')
        }
    }

    addButton.addEventListener('click', () => {
        fileInput.click()
    })

    deleteModeButton.addEventListener('click', () => {
        galleryState.deleteMode = !galleryState.deleteMode
        updateDeleteModeLabel()
        showGalleryStatus(galleryState.deleteMode ? 'Delete mode enabled. Click a tile to delete it.' : 'Delete mode disabled.')
    })

    fileInput.addEventListener('change', async () => {
        const files = Array.from(fileInput.files ?? [])
        fileInput.value = ''
        await uploadFiles(files)
    })

    dropZone.addEventListener('dragenter', (event) => {
        event.preventDefault()
        setDropHighlight(true)
    })

    dropZone.addEventListener('dragover', (event) => {
        event.preventDefault()
        setDropHighlight(true)
    })

    dropZone.addEventListener('dragleave', (event) => {
        event.preventDefault()
        setDropHighlight(false)
    })

    dropZone.addEventListener('drop', async (event) => {
        event.preventDefault()
        setDropHighlight(false)
        const files = Array.from(event.dataTransfer?.files ?? [])
        await uploadFiles(files)
    })

    grid.className = 'grid flex-1 auto-rows-min gap-3 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    dropZone.className = 'flex flex-1 min-h-0 flex-col overflow-hidden rounded-none border border-dashed border-border/60 bg-card/40 p-3 transition-all'

    updateDeleteModeLabel()
    renderImages()
    refreshImages()
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
    setPageVisibility(page)
}

export function switchColor(color: string) {
    state.color = color
    console.log('switching to color', color)
}