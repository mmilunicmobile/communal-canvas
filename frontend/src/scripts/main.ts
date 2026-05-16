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

type PermissionFeature =
    | 'view_board'
    | 'draw_board'
    | 'clear_board'
    | 'list_images'
    | 'view_images'
    | 'upload_images'
    | 'display_images'
    | 'delete_images'
    | 'set_brightness'
    | 'run_commands'

type PermissionSettings = Record<PermissionFeature, boolean>

type PermissionAvailability = {
    passkey_valid: boolean
    permissions: Record<PermissionFeature, {
        requires_passkey: boolean
        available: boolean
    }>
}

const permissionLabels: Record<PermissionFeature, string> = {
    view_board: 'View board',
    draw_board: 'Draw on board',
    clear_board: 'Clear board',
    list_images: 'List images',
    view_images: 'View image files',
    upload_images: 'Upload images',
    display_images: 'Display images',
    delete_images: 'Delete images',
    set_brightness: 'Set brightness',
    run_commands: 'Run commands',
}

const permissionFeatures = Object.keys(permissionLabels) as PermissionFeature[]

export const state = {
    backendUrl: BACKEND_URL_DEFAULT,
    passkey: '',
    color: '#ff00000',
    currentPage: 'paint',
    canDraw: false,
    ws: null as null | WebSocket, // WebSocket connection to backend. if null, we are not connected.
}

function getBackendBaseUrl() {
    const configuredHost = state.backendUrl.trim()
    if (!configuredHost) {
        return window.location.origin
    }

    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${configuredHost}`
}

function getBackendWebSocketUrl() {
    const baseUrl = new URL(getBackendBaseUrl())
    baseUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    baseUrl.pathname = '/ws'
    baseUrl.search = ''
    baseUrl.hash = ''
    return baseUrl.toString()
}

export function main() {
    const canvas = document.querySelector('canvas.matrix-canvas') as HTMLCanvasElement | null
    if (!canvas) {
        return
    }

    const backendUrl = localStorage.getItem('backendUrl')
    if (backendUrl !== null) {
        state.backendUrl = backendUrl
    }

    const passkey = localStorage.getItem('passkey')
    if (passkey) {
        state.passkey = passkey
    }

    const setupWSPoller = () => {
        if (!state.ws) {
            setupWSListener((update) => putPixel(canvas, update))
        }
    }

    // Setup mouse drawing
    setupCanvasDrawing(canvas)
    setupGalleryPage()
    setupCommandsPage()
    setupSettingsPage()
    refreshPaintAccess()

    setupWSPoller()
    switchPage('paint')
    setInterval(setupWSPoller, 3000)
}

export function setPasskey(passkey: string) {
    state.passkey = passkey
    localStorage.setItem('passkey', passkey)
    state.ws?.close()
    state.ws = null
    refreshPaintAccess()
}

export function setBackendUrl(url: string) {
    state.backendUrl = url
    localStorage.setItem('backendUrl', url)
    // Close existing connection to trigger reconnect on next poll
    state.ws?.close()
    state.ws = null
    refreshPaintAccess()
}

function authHeaders(headers?: HeadersInit) {
    const merged = new Headers(headers)
    if (state.passkey) {
        merged.set('Authorization', `Bearer ${state.passkey}`)
    }
    return merged
}

async function requestJson<T>(path: string, options: RequestInit = {}, includeAuth = true) {
    const response = await fetch(`${getBackendBaseUrl()}${path}`, {
        ...options,
        headers: includeAuth ? authHeaders(options.headers) : new Headers(options.headers),
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
    const url = new URL(`${getBackendBaseUrl()}/api/images/${imageId}/file`)
    if (state.passkey) {
        url.searchParams.set('auth', state.passkey)
    }
    return url.toString()
}

function sendWebSocketMessage(payload: Record<string, unknown>) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket is not connected.')
    }

    state.ws.send(JSON.stringify(payload))
}

async function getBrightness() {
    return requestJson<{ brightness: number }>('/api/brightness')
}

async function getPermissionSettings() {
    return requestJson<{ permissions: PermissionSettings }>('/api/permissions/settings')
}

async function updatePermissionSetting(feature: PermissionFeature, requiresPasskey: boolean) {
    return requestJson<{ permissions: PermissionSettings }>('/api/permissions/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: { [feature]: requiresPasskey } }),
    })
}

async function getPermissionAvailability(includeCurrentPasskey = true) {
    return requestJson<PermissionAvailability>('/api/permissions/availability', {}, includeCurrentPasskey)
}

async function runCommand(command: string) {
    return requestJson<{ status: string; message: string }>('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
    })
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

function applyDrawAccess(canDraw: boolean) {
    state.canDraw = canDraw

    const palette = document.getElementById('paint-color-switcher')
    if (palette) {
        palette.style.display = canDraw ? '' : 'none'
    }
}

async function refreshPaintAccess() {
    try {
        const availability = await getPermissionAvailability(true)
        applyDrawAccess(availability.permissions.draw_board.available)
    } catch {
        applyDrawAccess(false)
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

let commandsInitialized = false
let refreshCommandsPermissions = async () => {}

function setupCommandsPage() {
    if (commandsInitialized) {
        return
    }

    const status = document.getElementById('commands-status')
    const brightnessInput = document.getElementById('commands-brightness') as HTMLInputElement | null
    const brightnessValue = document.getElementById('commands-brightness-value')
    const permissionsContainer = document.getElementById('commands-permissions')
    const commandForm = document.getElementById('commands-form') as HTMLFormElement | null
    const commandInput = document.getElementById('commands-input') as HTMLInputElement | null
    const commandOutput = document.getElementById('commands-output')

    if (!brightnessInput || !brightnessValue || !permissionsContainer || !commandForm || !commandInput || !commandOutput) {
        return
    }

    commandsInitialized = true

    const showStatus = (message: string) => {
        if (status) {
            status.textContent = message
        }
    }

    let lastBrightnessSent: number | null = null
    let brightnessDeadlineTimer: number | undefined
    let brightnessPending = false

    const flushBrightness = () => {
        window.clearTimeout(brightnessDeadlineTimer)
        brightnessDeadlineTimer = undefined

        const percent = Number(brightnessInput.value)
        try {
            sendWebSocketMessage({
                type: 'brightness',
                brightness: percent / 100,
                auth: state.passkey,
            })
            lastBrightnessSent = percent
            brightnessPending = false
            showStatus(`Brightness set to ${percent}%`)
        } catch (error) {
            brightnessPending = true
            showStatus(error instanceof Error ? error.message : 'Unable to set brightness')
        }
    }

    const scheduleBrightnessSend = () => {
        const percent = Number(brightnessInput.value)
        brightnessValue.textContent = `${percent}%`

        if (lastBrightnessSent === null || Math.abs(percent - lastBrightnessSent) >= 5) {
            flushBrightness()
            return
        }

        brightnessPending = true
        if (brightnessDeadlineTimer === undefined) {
            brightnessDeadlineTimer = window.setTimeout(() => {
                if (brightnessPending) {
                    flushBrightness()
                }
            }, 100)
        }
    }

    const syncBrightnessFromBackend = async () => {
        try {
            const response = await getBrightness()
            const percent = Math.round(response.brightness * 100)
            brightnessInput.value = String(percent)
            brightnessValue.textContent = `${percent}%`
            lastBrightnessSent = percent
        } catch (error) {
            showStatus(error instanceof Error ? error.message : 'Unable to load brightness')
        }
    }

    const renderPermissionToggles = (settings: PermissionSettings) => {
        permissionsContainer.replaceChildren()

        for (const feature of permissionFeatures) {
            const label = document.createElement('label')
            label.className = 'flex min-h-11 items-center justify-between gap-3 border border-border bg-background px-3 py-2 text-xs'

            const text = document.createElement('span')
            text.textContent = permissionLabels[feature]

            const toggle = document.createElement('input')
            toggle.type = 'checkbox'
            toggle.checked = settings[feature]
            toggle.className = 'h-4 w-4 accent-primary'
            toggle.addEventListener('change', async () => {
                toggle.disabled = true
                try {
                    const response = await updatePermissionSetting(feature, toggle.checked)
                    renderPermissionToggles(response.permissions)
                    showStatus(`${permissionLabels[feature]} updated`)
                    refreshPaintAccess()
                    refreshAccessStatus()
                } catch (error) {
                    toggle.checked = !toggle.checked
                    showStatus(error instanceof Error ? error.message : 'Unable to update permissions')
                } finally {
                    toggle.disabled = false
                }
            })

            label.append(text, toggle)
            permissionsContainer.append(label)
        }
    }

    refreshCommandsPermissions = async () => {
        try {
            showStatus('Loading permissions...')
            const response = await getPermissionSettings()
            renderPermissionToggles(response.permissions)
            showStatus('Permissions loaded')
        } catch (error) {
            permissionsContainer.replaceChildren()
            showStatus(error instanceof Error ? error.message : 'Unable to load permissions')
        }
    }

    brightnessInput.addEventListener('input', scheduleBrightnessSend)

    commandForm.addEventListener('submit', async (event) => {
        event.preventDefault()
        const command = commandInput.value.trim()
        if (!command) {
            commandOutput.textContent = 'Enter a command.'
            return
        }

        try {
            commandOutput.textContent = 'Sending...'
            const response = await runCommand(command)
            commandOutput.textContent = response.message
            if (response.status === 'ok') {
                commandInput.value = ''
            }
        } catch (error) {
            commandOutput.textContent = error instanceof Error ? error.message : 'Command failed'
        }
    })

    brightnessValue.textContent = `${Number(brightnessInput.value)}%`
    syncBrightnessFromBackend()
    refreshCommandsPermissions()
}

function renderAvailabilitySection(title: string, availability: PermissionAvailability) {
    const section = document.createElement('div')
    section.className = 'flex flex-col gap-2'

    const heading = document.createElement('div')
    heading.className = 'text-xs font-medium'
    heading.textContent = title
    section.append(heading)

    const passkeyRow = document.createElement('div')
    passkeyRow.className = 'flex items-center gap-2 text-[11px] text-muted-foreground'
    const passkeyDot = document.createElement('span')
    passkeyDot.className = `h-2.5 w-2.5 rounded-full ${availability.passkey_valid ? 'bg-emerald-500' : 'bg-red-500'}`
    const passkeyText = document.createElement('span')
    passkeyText.textContent = availability.passkey_valid ? 'Passkey accepted' : 'No valid passkey'
    passkeyRow.append(passkeyDot, passkeyText)
    section.append(passkeyRow)

    for (const feature of permissionFeatures) {
        const permission = availability.permissions[feature]
        const row = document.createElement('div')
        row.className = 'flex items-center justify-between gap-3 border border-border bg-background px-3 py-2 text-[11px]'

        const label = document.createElement('span')
        label.textContent = permissionLabels[feature]

        const stateLabel = document.createElement('span')
        stateLabel.className = 'flex items-center gap-2 whitespace-nowrap'
        const dot = document.createElement('span')
        dot.className = `h-2.5 w-2.5 rounded-full ${permission.available ? 'bg-emerald-500' : 'bg-red-500'}`
        const text = document.createElement('span')
        text.textContent = permission.available ? 'Allowed' : 'Blocked'
        stateLabel.append(dot, text)
        row.append(label, stateLabel)
        section.append(row)
    }

    return section
}

async function refreshAccessStatus() {
    const accessStatus = document.getElementById('settings-access-status')
    if (!accessStatus) {
        return
    }

    accessStatus.replaceChildren()
    try {
        const [current, anonymous] = await Promise.all([
            getPermissionAvailability(true),
            getPermissionAvailability(false),
        ])
        accessStatus.append(
            renderAvailabilitySection('Current passkey', current),
            renderAvailabilitySection('No passkey', anonymous),
        )
    } catch (error) {
        const message = document.createElement('p')
        message.className = 'text-xs text-muted-foreground'
        message.textContent = error instanceof Error ? error.message : 'Unable to load access status'
        accessStatus.append(message)
    }
}

function setupSettingsPage() {
    const backendUrlInput = document.getElementById('settings-backend-url') as HTMLInputElement | null
    const passkeyInput = document.getElementById('settings-passkey') as HTMLInputElement | null
    const resetButton = document.getElementById('settings-reset-button') as HTMLButtonElement | null
    const accessStatus = document.getElementById('settings-access-status')

    if (!backendUrlInput || !passkeyInput || !resetButton || !accessStatus) {
        return
    }

    // Load current values into inputs
    const updateInputs = () => {
        backendUrlInput.value = state.backendUrl
        passkeyInput.value = state.passkey
    }

    updateInputs()

    // Save backend URL on change
    backendUrlInput.addEventListener('change', () => {
        const value = backendUrlInput.value.trim()
        setBackendUrl(value)
        backendUrlInput.value = value
        refreshAccessStatus()
        refreshCommandsPermissions()
    })

    // Save passkey on change
    passkeyInput.addEventListener('change', () => {
        const value = passkeyInput.value.trim()
        setPasskey(value)
        refreshAccessStatus()
        refreshCommandsPermissions()
    })

    // Reset to defaults
    resetButton.addEventListener('click', () => {
        localStorage.removeItem('backendUrl')
        localStorage.removeItem('passkey')
        state.backendUrl = BACKEND_URL_DEFAULT
        state.passkey = ''
        updateInputs()
        state.ws?.close()
        state.ws = null
        refreshAccessStatus()
        refreshCommandsPermissions()
    })

    refreshAccessStatus()
}

function setupWSListener(pixelUpdate: (update: PixelUpdate) => void) {
    state.ws?.close()
    state.ws = null
    const wsUrl = new URL(getBackendWebSocketUrl())
    if (state.passkey) {
        wsUrl.searchParams.set('auth', state.passkey)
    }
    
    const ws = new WebSocket(wsUrl.toString())
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
        if (!state.canDraw) {
            return
        }

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
        if (!state.canDraw) {
            return
        }
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
        if (!state.canDraw) {
            return
        }
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
    if (page === 'commands') {
        refreshCommandsPermissions()
    }
    if (page === 'paint') {
        refreshPaintAccess()
    }
    if (page === 'settings') {
        refreshAccessStatus()
    }
}

export function switchColor(color: string) {
    state.color = color
    console.log('switching to color', color)
}
