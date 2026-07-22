import * as THREE from 'three'

const SIZE = 512

export type MarkKind = 'bruise' | 'handprint' | 'redness' | 'scuff'

/** How long a fresh red mark takes to settle into a deep bruise, in seconds. */
const RIPEN_SECONDS = 22

/**
 * A transparent overlay in the photo's own UV space that the shader multiplies
 * over the face. Damage accumulates here, so a face that's been worked over
 * stays worked over.
 */
export class BruiseLayer {
  readonly canvas = document.createElement('canvas')
  readonly texture: THREE.CanvasTexture
  private ctx: CanvasRenderingContext2D
  /** Marks still ripening from red to deep bruise. */
  private ripening: { u: number; v: number; strength: number; age: number }[] = []
  private drips: { u: number; v: number; age: number; length: number; drawn: number }[] = []

  constructor() {
    this.canvas.width = SIZE
    this.canvas.height = SIZE
    this.ctx = this.canvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.clear()
  }

  /**
   * Damage matures over time: a fresh hit is red, and a minute later it's the
   * dull purple of a real bruise. Repainting a few sites per second is far
   * cheaper than keeping every mark live.
   */
  update(dt: number) {
    let dirty = false

    for (let i = this.ripening.length - 1; i >= 0; i--) {
      const mark = this.ripening[i]
      const before = Math.floor((mark.age / RIPEN_SECONDS) * 6)
      mark.age += dt
      const after = Math.floor((mark.age / RIPEN_SECONDS) * 6)
      if (after > before) {
        // One faint purple pass per step, so the colour walks over gradually.
        const t = Math.min(1, mark.age / RIPEN_SECONDS)
        this.paintBlob(mark.u, mark.v, SIZE * (0.04 + 0.03 * mark.strength), [
          [0, `rgba(${Math.round(120 - 46 * t)}, ${Math.round(38 + 10 * t)}, ${Math.round(60 + 52 * t)}, ${0.07 * mark.strength})`],
          [1, 'rgba(70, 45, 95, 0)'],
        ])
        dirty = true
      }
      if (mark.age >= RIPEN_SECONDS) this.ripening.splice(i, 1)
    }

    for (let i = this.drips.length - 1; i >= 0; i--) {
      const drip = this.drips[i]
      drip.age += dt
      const target = Math.min(drip.length, drip.age * 0.03)
      if (target > drip.drawn + 0.004) {
        const [x, y] = this.px(drip.u, drip.v)
        const ctx = this.ctx
        ctx.strokeStyle = 'rgba(214, 232, 208, 0.16)'
        ctx.lineWidth = SIZE * 0.012
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x, y + drip.drawn * SIZE)
        ctx.lineTo(x, y + target * SIZE)
        ctx.stroke()
        drip.drawn = target
        dirty = true
      }
      if (drip.drawn >= drip.length) this.drips.splice(i, 1)
    }

    if (dirty) this.texture.needsUpdate = true
  }

  private paintBlob(u: number, v: number, radius: number, stops: [number, string][]) {
    const [x, y] = this.px(u, v)
    const g = this.ctx.createRadialGradient(x, y, 0, x, y, radius)
    for (const [offset, color] of stops) g.addColorStop(offset, color)
    this.ctx.fillStyle = g
    this.ctx.beginPath()
    this.ctx.arc(x, y, radius, 0, Math.PI * 2)
    this.ctx.fill()
  }

  /** A wet streak that runs down the face. Used by spit, not by damage. */
  drip(at: { u: number; v: number }) {
    this.paintBlob(at.u, at.v, SIZE * 0.045, [
      [0, 'rgba(222, 238, 214, 0.3)'],
      [0.5, 'rgba(205, 228, 196, 0.16)'],
      [1, 'rgba(205, 228, 196, 0)'],
    ])
    this.drips.push({ u: at.u, v: at.v, age: 0, length: 0.1 + Math.random() * 0.12, drawn: 0 })
    this.texture.needsUpdate = true
  }

  /** UV (origin bottom-left) to canvas pixels (origin top-left). */
  private px(u: number, v: number): [number, number] {
    return [u * SIZE, (1 - v) * SIZE]
  }

  mark(kind: MarkKind, u: number, v: number, strength: number, angle = 0) {
    const [x, y] = this.px(u, v)
    const ctx = this.ctx
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)

    switch (kind) {
      case 'bruise': {
        // Deep tissue: red core bleeding out to purple at the edge.
        const r = SIZE * (0.045 + 0.05 * strength)
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
        g.addColorStop(0, `rgba(150, 30, 45, ${0.3 * strength})`)
        g.addColorStop(0.45, `rgba(120, 40, 90, ${0.18 * strength})`)
        g.addColorStop(1, 'rgba(90, 50, 110, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      case 'redness': {
        const r = SIZE * (0.05 + 0.06 * strength)
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
        g.addColorStop(0, `rgba(210, 60, 55, ${0.24 * strength})`)
        g.addColorStop(1, 'rgba(210, 60, 55, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      case 'handprint': {
        // Four finger welts fanned across the cheek.
        ctx.fillStyle = `rgba(205, 55, 60, ${0.2 * strength})`
        for (let i = 0; i < 4; i++) {
          const off = (i - 1.5) * SIZE * 0.028
          ctx.beginPath()
          ctx.ellipse(off, 0, SIZE * 0.009, SIZE * 0.042, 0, 0, Math.PI * 2)
          ctx.fill()
        }
        break
      }
      case 'scuff': {
        const r = SIZE * 0.035
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
        g.addColorStop(0, `rgba(170, 70, 60, ${0.22 * strength})`)
        g.addColorStop(1, 'rgba(170, 70, 60, 0)')
        ctx.fillStyle = g
        ctx.fillRect(-r, -r * 0.5, r * 2, r)
        break
      }
    }

    ctx.restore()
    this.texture.needsUpdate = true
  }

  clear() {
    this.ctx.clearRect(0, 0, SIZE, SIZE)
    this.texture.needsUpdate = true
  }

  dispose() {
    this.texture.dispose()
  }
}
