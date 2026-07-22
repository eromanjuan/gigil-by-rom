import { useEffect, useState } from 'react'
import { IconPunch, IconSlapR, IconPoke, IconPinch, IconStrangle, IconSpit } from './icons'

/**
 * A one-time card teaching the touch gestures.
 *
 * The dock caps name the moves but not how to perform them by touch - nothing
 * on screen says "swipe to slap". This says it once, on the first touch
 * session, then stays out of the way. Dismissal is remembered so it never
 * interrupts a returning player.
 */

const SEEN_KEY = 'gigil.gestures.seen'

const GESTURES: { icon: (p: { size?: string }) => JSX.Element; move: string; how: string }[] = [
  { icon: IconPunch, move: 'Punch', how: 'Tap the face' },
  { icon: IconSlapR, move: 'Slap', how: 'Swipe left or right' },
  { icon: IconPoke, move: 'Poke eyes', how: 'Tap an eye' },
  { icon: IconPinch, move: 'Pinch nose', how: 'Tap the nose' },
  { icon: IconStrangle, move: 'Strangle', how: 'Hold two fingers' },
  { icon: IconSpit, move: 'Spit', how: 'Swipe up' },
]

const isTouch = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

export default function GestureGuide() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!isTouch()) return
    try {
      if (localStorage.getItem(SEEN_KEY)) return
    } catch {
      // Private mode or storage disabled - show it, just don't persist.
    }
    setOpen(true)
  }, [])

  const dismiss = () => {
    setOpen(false)
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* nothing to do */
    }
  }

  if (!open) return null

  return (
    <div className="gguide-scrim" onClick={dismiss}>
      <div
        className="gguide glass"
        role="dialog"
        aria-label="How to play by touch"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Use your hands</h2>
        <p className="gguide-sub">No buttons needed — do it to their face.</p>
        <ul className="gguide-list">
          {GESTURES.map((g) => (
            <li key={g.move}>
              <span className="gguide-ico" aria-hidden>
                <g.icon />
              </span>
              <span className="gguide-move">{g.move}</span>
              <span className="gguide-how">{g.how}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="primary-btn gguide-go" onClick={dismiss}>
          Got it
        </button>
      </div>
    </div>
  )
}
