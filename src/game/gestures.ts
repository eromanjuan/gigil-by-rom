import type { AttackId } from './attacks'
import type { TargetName } from './attacks'

/**
 * Touch control.
 *
 * On a phone the keycaps are the wrong instrument entirely - you have to look
 * away from the face to press one, and the whole point is watching the face.
 * These map the gesture to the thing it resembles instead: you slap by
 * swiping across, poke by putting a finger in an eye, and throttle by putting
 * two fingers on the throat.
 *
 * Where you touch matters as much as how, so the recogniser is handed a way to
 * ask where a named part of the head currently is on screen. Landmarks move
 * with every recoil, so that has to be asked per gesture rather than cached.
 */

export type GestureHost = {
  /** Screen position of a target in CSS pixels, or null if it isn't visible. */
  screenOf(name: TargetName): { x: number; y: number } | null
  trigger(id: AttackId): void
  release(id: AttackId): void
}

/** Below this a drag is a tap that wobbled. */
const TAP_SLOP = 14
/** Past this a drag is a swipe, in CSS pixels. */
const SWIPE_MIN = 46
/** A tap held longer than this isn't a jab any more. */
const TAP_MS = 400
/**
 * How long to wait, after a second finger lands, before deciding it's a
 * throttle rather than the start of a pinch. Two fingers that are about to
 * pinch are already moving together within this window.
 */
const PINCH_GRACE_MS = 150
/** Fraction of the original spread that counts as a deliberate pinch. */
const PINCH_RATIO = 0.66

type Touch = { id: number; x0: number; y0: number; x: number; y: number; t0: number }

export function attachGestures(el: HTMLElement, host: GestureHost): () => void {
  const touches = new Map<number, Touch>()
  let consumed = false
  let choking = false
  let pinched = false
  let spread0 = 0
  let graceTimer: number | null = null

  const rect = () => el.getBoundingClientRect()
  const distance = (a: Touch, b: Touch) => Math.hypot(a.x - b.x, a.y - b.y)
  const pair = () => [...touches.values()] as [Touch, Touch]

  const clearGrace = () => {
    if (graceTimer !== null) {
      clearTimeout(graceTimer)
      graceTimer = null
    }
  }

  const stopChoke = () => {
    if (!choking) return
    choking = false
    host.release('choke')
  }

  /** Which single-finger tap this is, decided by what it landed on. */
  const tapAt = (x: number, y: number): AttackId => {
    const near = (name: TargetName, radius: number) => {
      const p = host.screenOf(name)
      return p ? Math.hypot(p.x - x, p.y - y) < radius : false
    }
    // Generous radii, and eyes before nose: they sit close together on screen
    // and a finger is far wider than either.
    if (near('eyeOuterL', 58) || near('eyeOuterR', 58) || near('eyeInnerL', 48) || near('eyeInnerR', 48)) {
      return 'poke'
    }
    if (near('noseTip', 46)) return 'pinch'
    return 'punch'
  }

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return
    const r = rect()
    el.setPointerCapture(e.pointerId)
    touches.set(e.pointerId, {
      id: e.pointerId,
      x0: e.clientX - r.left,
      y0: e.clientY - r.top,
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      t0: performance.now(),
    })

    if (touches.size === 2) {
      consumed = false
      pinched = false
      spread0 = distance(...pair())
      // Hold off: a pinch announces itself by closing within a moment. Only if
      // nothing closes does this become a throttle.
      clearGrace()
      graceTimer = window.setTimeout(() => {
        graceTimer = null
        if (pinched || touches.size !== 2) return
        choking = true
        host.trigger('choke')
      }, PINCH_GRACE_MS)
    }
  }

  const onMove = (e: PointerEvent) => {
    const t = touches.get(e.pointerId)
    if (!t) return
    const r = rect()
    t.x = e.clientX - r.left
    t.y = e.clientY - r.top

    if (touches.size === 2 && !pinched && !choking) {
      const now = distance(...pair())
      if (spread0 > 40 && now < spread0 * PINCH_RATIO) {
        pinched = true
        consumed = true
        clearGrace()
        host.trigger('pinch')
      }
      return
    }

    if (touches.size !== 1 || consumed) return
    const dx = t.x - t.x0
    const dy = t.y - t.y0
    if (Math.hypot(dx, dy) < SWIPE_MIN) return

    consumed = true
    if (Math.abs(dx) > Math.abs(dy)) {
      // Swiping right sends the hand across left to right, which is the slap
      // that lands on the cheek nearest where the swipe finished.
      host.trigger(dx > 0 ? 'slapR' : 'slapL')
    } else if (dy < 0) {
      host.trigger('spit')
    } else {
      // Downward has no move of its own; a heavy pull down reads as a punch.
      host.trigger('punch')
    }
  }

  const onUp = (e: PointerEvent) => {
    const t = touches.get(e.pointerId)
    if (!t) return
    touches.delete(e.pointerId)
    el.releasePointerCapture?.(e.pointerId)

    if (choking) {
      stopChoke()
      clearGrace()
      consumed = true
      return
    }
    clearGrace()

    // A single quick, still touch. Anything else has already fired or is a
    // finger lifting off a two-finger gesture.
    const still = Math.hypot(t.x - t.x0, t.y - t.y0) < TAP_SLOP
    const quick = performance.now() - t.t0 < TAP_MS
    if (!consumed && touches.size === 0 && still && quick) {
      host.trigger(tapAt(t.x, t.y))
    }
    if (touches.size === 0) {
      consumed = false
      pinched = false
    }
  }

  const onCancel = (e: PointerEvent) => {
    touches.delete(e.pointerId)
    if (touches.size === 0) {
      stopChoke()
      clearGrace()
      consumed = false
      pinched = false
    }
  }

  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onCancel)

  return () => {
    clearGrace()
    stopChoke()
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onCancel)
  }
}
