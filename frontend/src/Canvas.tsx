import { useCallback, useEffect, useRef, useState } from 'react'
import { HEIGHT, LED_COUNT, WIDTH, getWsUrl } from './api'
import type { Pixel } from './api'

const black: Pixel = [0, 0, 0]
const blankFrame = Array.from({ length: LED_COUNT }, () => [...black] as Pixel)

function colorToPixel(color: string): Pixel {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ]
}

function draw(canvas: HTMLCanvasElement, pixels: Pixel[]) {
  const context = canvas.getContext('2d')
  if (!context) return

  const cell = canvas.width / WIDTH
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#101418'
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.imageSmoothingEnabled = false
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const [r, g, b] = pixels[y * WIDTH + x]
      context.fillStyle = `rgb(${r} ${g} ${b})`
      context.fillRect(x * cell, y * cell, cell, cell)
    }
  }
}

type CanvasProps = {
  color: string
  eraser: boolean
  onConnectionChange: (connected: boolean) => void
  onStatusMessage: (message: string) => void
}

export default function Canvas({
  color,
  eraser,
  onConnectionChange,
  onStatusMessage,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef(500)
  const dragRef = useRef(false)
  const pixelsRef = useRef<Pixel[]>(blankFrame)

  const [pixels, setPixels] = useState<Pixel[]>(blankFrame)

  useEffect(() => {
    pixelsRef.current = pixels
    const canvas = canvasRef.current
    if (canvas) draw(canvas, pixels)
  }, [pixels])

  useEffect(() => {
    let closed = false
    let reconnectTimer = 0

    const connect = () => {
      if (closed) return
      onStatusMessage('')
      const socket = new WebSocket(getWsUrl())
      wsRef.current = socket

      socket.onopen = () => {
        if (closed || wsRef.current !== socket) return
        onConnectionChange(true)
        onStatusMessage('')
        reconnectRef.current = 500
      }

      socket.onerror = () => {
        if (closed || wsRef.current !== socket) return
        onStatusMessage(`WebSocket failed: ${getWsUrl()}`)
      }

      socket.onmessage = (event) => {
        if (closed || wsRef.current !== socket) return
        const update = JSON.parse(event.data) as {
          x: number
          y: number
          r: number
          g: number
          b: number
        }
        setPixels((current) => {
          const next = current.slice()
          next[update.y * WIDTH + update.x] = [update.r, update.g, update.b]
          return next
        })
      }

      socket.onclose = () => {
        if (closed || wsRef.current !== socket) return
        onConnectionChange(false)
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, reconnectRef.current)
          reconnectRef.current = Math.min(reconnectRef.current * 2, 8000)
        }
      }
    }

    connect()

    return () => {
      closed = true
      window.clearTimeout(reconnectTimer)
      wsRef.current?.close()
      wsRef.current = null
      onConnectionChange(false)
    }
  }, [onConnectionChange, onStatusMessage])

  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = Math.floor(((clientX - rect.left) / rect.width) * WIDTH)
      const y = Math.floor(((clientY - rect.top) / rect.height) * HEIGHT)
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return

      const [r, g, b] = eraser ? black : colorToPixel(color)
      setPixels((current) => {
        const next = current.slice()
        next[y * WIDTH + x] = [r, g, b]
        return next
      })
      wsRef.current?.send(JSON.stringify({ x, y, r, g, b }))
    },
    [color, eraser],
  )

  return (
    <section className="canvas-panel">
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className="matrix-canvas"
        onPointerDown={(event) => {
          dragRef.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          paintAt(event.clientX, event.clientY)
        }}
        onPointerMove={(event) => {
          if (dragRef.current) paintAt(event.clientX, event.clientY)
        }}
        onPointerUp={() => {
          dragRef.current = false
        }}
        onPointerLeave={() => {
          dragRef.current = false
        }}
      />
    </section>
  )
}
