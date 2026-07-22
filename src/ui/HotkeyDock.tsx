import { useEffect, useState } from 'react'
import { ATTACK_LIST, type AttackId } from '../game/attacks'

type Props = {
  onTrigger: (id: AttackId) => void
  onRelease: (id: AttackId) => void
  /** Opens the verbal attack box. */
  onTaunt: () => void
  tauntOpen: boolean
}

const BY_KEY = new Map<string, AttackId>(ATTACK_LIST.map((a) => [a.key.toLowerCase(), a.id]))

/** Typing in a field shouldn't light up the dock. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
}

/**
 * The bottom hotkey dashboard. One glass bar, six caps.
 *
 * The keyboard listener here is purely presentational — Game owns the real
 * window key handling, so echoing trigger() from here would double-fire. Only
 * pointer input drives the game, which is what makes touch and hold-to-choke
 * work.
 */
export default function HotkeyDock({ onTrigger, onRelease, onTaunt, tauntOpen }: Props) {
  const [pressed, setPressed] = useState<ReadonlySet<AttackId>>(() => new Set())

  const press = (id: AttackId) =>
    setPressed((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })

  const lift = (id: AttackId) =>
    setPressed((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      const id = BY_KEY.get(e.key.toLowerCase())
      if (id) press(id)
    }
    const up = (e: KeyboardEvent) => {
      const id = BY_KEY.get(e.key.toLowerCase())
      if (id) lift(id)
    }
    const clear = () => setPressed((prev) => (prev.size ? new Set() : prev))

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return (
    <div className="dock-wrap">
      <div className="dock glass" role="group" aria-label="Attacks">
        {ATTACK_LIST.map((attack) => (
          <button
            key={attack.id}
            type="button"
            className={`keycap${pressed.has(attack.id) ? ' is-pressed' : ''}`}
            title={`${attack.label} (${attack.key}) — ${attack.hint}`}
            aria-label={`${attack.label}, key ${attack.key}. ${attack.hint}`}
            onPointerDown={(e) => {
              e.preventDefault()
              e.currentTarget.setPointerCapture?.(e.pointerId)
              press(attack.id)
              onTrigger(attack.id)
            }}
            onPointerUp={() => {
              lift(attack.id)
              onRelease(attack.id)
            }}
            onPointerLeave={() => {
              lift(attack.id)
              onRelease(attack.id)
            }}
            onPointerCancel={() => {
              lift(attack.id)
              onRelease(attack.id)
            }}
          >
            <kbd>{attack.key}</kbd>
            <span className="cap-label">{attack.label}</span>
          </button>
        ))}

        <span className="dock-sep" aria-hidden />

        {/* Separated from the seven, because it isn't one of them: it opens an
            input rather than swinging anything, and it's the only control here
            that takes an argument. */}
        <button
          type="button"
          className={`keycap keycap-taunt${tauntOpen ? ' is-pressed' : ''}`}
          title="Say something (T)"
          aria-label="Verbal attack. Opens a box to type what to say."
          aria-expanded={tauntOpen}
          onClick={onTaunt}
        >
          <kbd>T</kbd>
          <span className="cap-label">Say It</span>
        </button>
      </div>
    </div>
  )
}
