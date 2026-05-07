import { useEffect, useRef, useState } from 'react'
import { deleteImage, displayImage, frameUrl, getPasskey, listImages } from './api'
import type { ImageRecord } from './api'

type GalleryProps = {
  refreshKey: number
}

function StaticPreview({ image }: { image: ImageRecord }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      context.imageSmoothingEnabled = false
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    img.src = frameUrl(image.id)
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
                  <img src={frameUrl(image.id)} alt="" />
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
