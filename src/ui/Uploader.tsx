import { useCallback, useRef, useState } from 'react'
import { IconArrowLeft, IconMark, IconUpload } from './icons'

type Props = {
  onPick: (file: File) => void
  onDummy: () => void
  busy: boolean
  error?: string
  /** Only offered once there's already a head to go back to. */
  onCancel?: () => void
}

export default function Uploader({ onPick, onDummy, busy, error, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      if (file && file.type.startsWith('image/')) onPick(file)
    },
    [onPick],
  )

  return (
    <div className="panel glass">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          <IconMark />
        </span>
        <h1>
          Gigil<em>!</em>
        </h1>
      </div>
      <p className="tagline">
        Drop in a photo. We'll build it into a 3D head you can punch, slap, poke, pinch, throttle and
        spit on.
      </p>

      <button
        type="button"
        className={`dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        disabled={busy}
        aria-label="Choose a photo, or drop one here"
      >
        {busy ? (
          <>
            <span className="spinner" aria-hidden />
            <strong>Finding the face…</strong>
            <small>First run downloads the landmark model</small>
          </>
        ) : (
          <>
            <span className="dropzone-icon" aria-hidden>
              <IconUpload />
            </span>
            <strong>Choose a photo, or drop one here</strong>
            <small>Front-on and well lit works best · JPG or PNG</small>
          </>
        )}
      </button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="dummy-pick">
        <span className="dummy-label">no photo? the dummy works too</span>
        <div className="dummy-row">
          <button type="button" className="ghost-btn" disabled={busy} onClick={onDummy}>
            Keep it faceless
          </button>
        </div>
      </div>

      {onCancel && (
        <button type="button" className="link-button" onClick={onCancel}>
          <IconArrowLeft />
          <span>Keep the current one</span>
        </button>
      )}

      <p className="privacy">
        Your photo never leaves this device — the face mapping runs entirely in your browser.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
