import { useEffect, useRef, useState } from 'react'
import { deleteImage, displayImage, fetchImageBlob, getPasskey, listImages } from './api'
import type { ImageRecord } from './api'

type GalleryProps = {
  refreshKey: number
}

function StaticPreview({ image }: { image: ImageRecord }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let revokedUrl = ''
    let cancelled = false

    fetchImageBlob(image.id)
      .then((blob) => {
        if (cancelled) return
        const img = new Image()
        const objectUrl = URL.createObjectURL(blob)
        revokedUrl = objectUrl
        img.onload = () => {
          const canvas = canvasRef.current
          const context = canvas?.getContext('2d')
          if (!canvas || !context) return
          context.imageSmoothingEnabled = false
          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(img, 0, 0, canvas.width, canvas.height)
        }
        img.src = objectUrl
      })
      .catch(() => {
        // Ignore preview failures here; the card still renders.
      })

    return () => {
      cancelled = true
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl)
      }
    }
  }, [image.id])

  return <canvas ref={canvasRef} width={120} height={90} className="preview-canvas" />
}

export default function Gallery({ refreshKey }: GalleryProps) {
  const [images, setImages] = useState<ImageRecord[]>([])
  const [message, setMessage] = useState('')
  const isAdmin = Boolean(getPasskey())

  const refresh = () => {
    listImages()
      .then(setImages)
      .catch((error: Error) => setMessage(error.message))
  }

  useEffect(refresh, [refreshKey])

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Gallery</h2>
          <p>{images.length} saved files</p>
        </div>
      </div>

      {images.length === 0 ? (
        <p className="empty">No uploads yet.</p>
      ) : (
        <div className="gallery-grid">
          {images.map((image) => (
            <article className="image-card" key={image.id}>
              <div className="preview">
                {image.type === 'gif' ? (
                  <GifPreview imageId={image.id} />
                ) : (
                  <StaticPreview image={image} />
                )}
              </div>
              <h3>{image.original_name}</h3>
              <p>
                {image.width} x {image.height} · {image.type.toUpperCase()}
              </p>
              <div className="card-actions">
                <button
                  type="button"
                  onClick={() => {
                    displayImage(image.id)
                      .then(() => setMessage(`Displaying ${image.original_name}`))
                      .catch((error: Error) => setMessage(error.message))
                  }}
                >
                  Display
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      deleteImage(image.id)
                        .then(refresh)
                        .catch((error: Error) => setMessage(error.message))
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {message && <p className="notice">{message}</p>}
    </section>
  )
}

function GifPreview({ imageId }: { imageId: number }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''

    fetchImageBlob(imageId)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setSrc('')
      })

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [imageId])

  return <img src={src} alt="" />
}
