import { useState } from 'react'
import type { FormEvent } from 'react'
import { uploadImage } from './api'

type UploaderProps = {
  onUploaded: () => void
}

export default function Uploader({ onUploaded }: UploaderProps) {
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    uploadImage(file)
      .then((record) => {
        setMessage(`Uploaded ${record.original_name}`)
        setFile(null)
        onUploaded()
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setBusy(false))
  }

  return (
    <section className="panel upload-panel">
      <div className="panel-head">
        <div>
          <h2>Upload</h2>
          <p>PNG, JPG, or GIF</p>
        </div>
      </div>
      <form onSubmit={submit} className="upload-form">
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        <button type="submit" disabled={!file || busy}>
          {busy ? 'Uploading' : 'Upload'}
        </button>
      </form>
      {message && <p className="notice">{message}</p>}
    </section>
  )
}
