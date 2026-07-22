import { useEffect, useRef, useState } from 'react'
import type { LightId, LightState } from '../game/Game'
import { IconClose } from './icons'

type Lights = Record<LightId, LightState>

type Props = {
  getLights: () => Lights | undefined
  setLight: (id: LightId, patch: Partial<LightState>) => void
  resetLights: () => void
  onClose: () => void
}

const ORDER: LightId[] = ['key', 'fill', 'rim']
const NAME: Record<LightId, string> = { key: 'Key', fill: 'Fill', rim: 'Rim' }

const AZ_RANGE = 180 // pad spans -180..180 horizontally
const EL_RANGE = 60 // pad spans +60..-60 vertically

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** azimuth/elevation -> 0..1 pad coordinates. */
const toPad = (l: LightState) => ({
  x: (clamp(l.azimuth, -AZ_RANGE, AZ_RANGE) + AZ_RANGE) / (AZ_RANGE * 2),
  y: (EL_RANGE - clamp(l.elevation, -EL_RANGE, EL_RANGE)) / (EL_RANGE * 2),
})

/**
 * Studio lighting. Three pucks share one 2D pad — horizontal is azimuth
 * around the bust, vertical is elevation. Collapsed by default (App owns the
 * open flag) so it never competes with the character.
 */
export default function LightPanel({ getLights, setLight, resetLights, onClose }: Props) {
  const [lights, setLights] = useState<Lights | undefined>(getLights)
  const [selected, setSelected] = useState<LightId>('key')
  const padRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<LightId | null>(null)

  // The Game instance may not exist on the very first render pass.
  useEffect(() => {
    if (!lights) setLights(getLights())
  }, [lights, getLights])

  if (!lights) return null

  const patch = (id: LightId, next: Partial<LightState>) => {
    setLight(id, next)
    setLights((prev) => (prev ? { ...prev, [id]: { ...prev[id], ...next } } : prev))
  }

  const fromPointer = (clientX: number, clientY: number): Partial<LightState> | null => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return null
    const x = clamp((clientX - rect.left) / rect.width, 0, 1)
    const y = clamp((clientY - rect.top) / rect.height, 0, 1)
    return {
      azimuth: Math.round(x * AZ_RANGE * 2 - AZ_RANGE),
      elevation: Math.round(EL_RANGE - y * EL_RANGE * 2),
    }
  }

  const dragTo = (id: LightId, clientX: number, clientY: number) => {
    const next = fromPointer(clientX, clientY)
    if (next) patch(id, next)
  }

  const nudge = (id: LightId, e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2
    let daz = 0
    let del = 0
    if (e.key === 'ArrowLeft') daz = -step
    else if (e.key === 'ArrowRight') daz = step
    else if (e.key === 'ArrowUp') del = step
    else if (e.key === 'ArrowDown') del = -step
    else return
    e.preventDefault()
    setSelected(id)
    const l = lights[id]
    patch(id, {
      azimuth: clamp(l.azimuth + daz, -AZ_RANGE, AZ_RANGE),
      elevation: clamp(l.elevation + del, -EL_RANGE, EL_RANGE),
    })
  }

  const current = lights[selected]

  return (
    <section id="light-panel" className="lights glass" aria-label="Lighting controls">
      <div className="lights-head">
        <h2>Studio lighting</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close lighting controls" title="Close">
          <IconClose />
        </button>
      </div>

      <div className="light-tabs" role="radiogroup" aria-label="Select a light">
        {ORDER.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            className="light-tab"
            aria-checked={selected === id}
            onClick={() => setSelected(id)}
            title={`Edit the ${NAME[id].toLowerCase()} light`}
          >
            <span className="dot" style={{ ['--c' as string]: lights[id].color }} aria-hidden />
            {NAME[id]}
          </button>
        ))}
      </div>

      <div
        ref={padRef}
        className="pad"
        onPointerDown={(e) => {
          // Pucks stop propagation, so anything reaching here is the surface:
          // move the selected light to the tapped point and keep dragging it.
          dragRef.current = selected
          e.currentTarget.setPointerCapture(e.pointerId)
          dragTo(selected, e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (dragRef.current) dragTo(dragRef.current, e.clientX, e.clientY)
        }}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
      >
        <span className="pad-axis top" aria-hidden>
          Above
        </span>
        <span className="pad-axis bottom" aria-hidden>
          Below
        </span>
        <span className="pad-axis left" aria-hidden>
          Behind
        </span>
        <span className="pad-axis right" aria-hidden>
          Behind
        </span>

        {ORDER.map((id) => {
          const { x, y } = toPad(lights[id])
          const l = lights[id]
          return (
            <button
              key={id}
              type="button"
              className={`puck${selected === id ? ' is-selected' : ''}`}
              style={{ left: `${x * 100}%`, top: `${y * 100}%`, ['--c' as string]: l.color }}
              aria-label={`${NAME[id]} light position. Azimuth ${Math.round(l.azimuth)} degrees, elevation ${Math.round(
                l.elevation,
              )} degrees. Use the arrow keys to move it.`}
              title={`${NAME[id]} light — drag to reposition`}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setSelected(id)
                dragRef.current = id
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (dragRef.current !== id) return
                e.stopPropagation()
                dragTo(id, e.clientX, e.clientY)
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                dragRef.current = null
              }}
              onPointerCancel={() => {
                dragRef.current = null
              }}
              onKeyDown={(e) => nudge(id, e)}
              onFocus={() => setSelected(id)}
            />
          )
        })}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="light-intensity">
          <span>{NAME[selected]} intensity</span>
          <output htmlFor="light-intensity">{current.intensity.toFixed(2)}</output>
        </label>
        <input
          id="light-intensity"
          type="range"
          min={0}
          max={4}
          step={0.05}
          value={current.intensity}
          style={{ ['--c' as string]: current.color }}
          aria-label={`${NAME[selected]} light intensity`}
          onChange={(e) => patch(selected, { intensity: Number(e.target.value) })}
        />
      </div>

      <div className="field">
        <div className="field-label">
          <span>{NAME[selected]} colour</span>
          <output>{current.color.toUpperCase()}</output>
        </div>
        <div className="swatch-row">
          <input
            type="color"
            value={current.color}
            aria-label={`${NAME[selected]} light colour`}
            title={`${NAME[selected]} light colour`}
            onChange={(e) => patch(selected, { color: e.target.value })}
          />
          <p className="hint">
            {Math.round(current.azimuth)}° around · {Math.round(current.elevation)}° up
          </p>
        </div>
      </div>

      <div className="lights-foot">
        <p className="hint">Drag a puck, or arrow-key it.</p>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            resetLights()
            setLights(getLights())
          }}
          title="Restore the default three-point setup"
        >
          Reset lights
        </button>
      </div>
    </section>
  )
}
