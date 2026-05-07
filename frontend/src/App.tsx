import { useCallback, useEffect, useState } from 'react'
import Canvas from './Canvas'
import Gallery from './Gallery'
import Uploader from './Uploader'
import { getBaseUrl, getDefaultBaseUrl, getPasskey } from './api'
import './App.css'

type Tab = 'canvas' | 'gallery' | 'upload'

export default function App() {
  const [tab, setTab] = useState<Tab>('canvas')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [host, setHost] = useState(getBaseUrl())
  const [passkey, setPasskey] = useState(getPasskey())
  const [refreshKey, setRefreshKey] = useState(0)
  const [connected, setConnected] = useState(false)
  const [color, setColor] = useState('#ff3355')
  const [eraser, setEraser] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  const handleConnectionChange = useCallback((nextConnected: boolean) => {
    setConnected(nextConnected)
  }, [])

  const handleStatusMessage = useCallback((message: string) => {
    setStatusMessage(message)
  }, [])

  useEffect(() => {
    localStorage.setItem('led_host', host)
  }, [host])

  useEffect(() => {
    if (passkey) {
      localStorage.setItem('led_passkey', passkey)
    } else {
      localStorage.removeItem('led_passkey')
    }
  }, [passkey])

  return (
    <main className="app-shell">
      <header className="topbar">
        <nav className="tabs" aria-label="Views">
          {(['canvas', 'gallery', 'upload'] as Tab[]).map((item) => (
            <button
              type="button"
              key={item}
              className={tab === item ? 'active' : ''}
              onClick={() => setTab(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="top-tools">
          <span className={`status ${connected ? 'ok' : 'down'}`}>
            <span />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <label className="color-control">
            <span>Color</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
          <button
            type="button"
            className={eraser ? 'active' : ''}
            onClick={() => setEraser(!eraser)}
          >
            Eraser
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
      </header>

      <div className="view" hidden={tab !== 'canvas'}>
        <Canvas
          color={color}
          eraser={eraser}
          onConnectionChange={handleConnectionChange}
          onStatusMessage={handleStatusMessage}
        />
      </div>
      <div className="view" hidden={tab !== 'gallery'}>
        <Gallery refreshKey={refreshKey} />
      </div>
      <div className="view" hidden={tab !== 'upload'}>
        <Uploader
          onUploaded={() => {
            setRefreshKey((key) => key + 1)
            setTab('gallery')
          }}
        />
      </div>

      {statusMessage && !connected && <p className="notice">{statusMessage}</p>}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-head">
              <div>
                <h2 id="settings-title">Settings</h2>
                <p>Connection and admin passkey</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setSettingsOpen(false)}>
                ×
              </button>
            </div>
            <label>
              Host
              <input value={host} onChange={(event) => setHost(event.target.value)} />
            </label>
            <label>
              Passkey
              <input
                type="password"
                value={passkey}
                onChange={(event) => setPasskey(event.target.value)}
              />
            </label>
            <button type="button" onClick={() => setPasskey('')}>
              Clear passkey
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem('led_host')
                setHost(getDefaultBaseUrl())
              }}
            >
              Use default host
            </button>
          </section>
        </div>
      )}
    </main>
  )
}
