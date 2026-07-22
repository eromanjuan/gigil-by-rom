import * as THREE from 'three'

/**
 * Verbal attacks.
 *
 * Words the player types, thrown at the head as comic-book lettering: they
 * rush in from the camera, hit, then tumble away. Rendered as sprites off a
 * 2D canvas rather than as real text geometry - a typeface extruded into 3D
 * would need a font file, a parser and a triangulator to say one word, and it
 * would still look worse, because what sells this is a heavy outline and flat
 * fill rather than depth.
 *
 * Kept out of the attack table on purpose. Everything in there is a hand on a
 * keyframed timeline aimed by a contact point; this has no hand and its timing
 * comes from how long the word is.
 */

/**
 * Mostly light, with a few deep ones for contrast.
 *
 * Light dominates because the stage is dark and a bright word carries further,
 * but the darks earn their place: against a white outline they read as a
 * different kind of shout rather than as a mistake.
 */
const COLOURS = [
  '#ffe14d',
  '#7fe0ff',
  '#a8ff9e',
  '#ffb3e6',
  '#d4b3ff',
  '#ffc46b',
  '#8effd9',
  '#ff9b9b',
  '#e6ff7a',
  '#ffffff',
  '#f5a0ff',
  '#9fd0ff',
  '#1f2a52',
  '#4a1230',
  '#0f3b2e',
]

export const randomTauntColour = () => COLOURS[Math.floor(Math.random() * COLOURS.length)]

/**
 * Perceived brightness of a hex colour, 0..1.
 *
 * Weighted rather than a flat average because the eye is far more sensitive to
 * green than to blue - by a straight mean, pure blue would count as mid-bright
 * and get a black outline it disappears into.
 */
function brightness(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255
}

/** Whichever of black or white the fill can actually be seen against. */
const outlineFor = (hex: string) => (brightness(hex) > 0.55 ? '#000000' : '#ffffff')

/** Past this it stops being a taunt and starts being a paragraph. */
export const MAX_TAUNT = 28

const FONT_STACK =
  '"Impact", "Haettenschweiler", "Arial Narrow Bold", ui-sans-serif, system-ui, sans-serif'

/**
 * Draws the word to a canvas.
 *
 * One solid outline, picked to contrast with the fill: black behind a light
 * word, white behind a dark one. Canvas strokes straddle the path - half the
 * width falls inside the letterform - so it's stroked before the fill at twice
 * the intended weight, leaving the fill to cover the inner half. Stroking
 * after would eat into the letter and thin it out.
 */
function makeLabel(text: string, colour: string) {
  const SIZE = 110
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `800 ${SIZE}px ${FONT_STACK}`

  ctx.font = font
  const width = Math.ceil(ctx.measureText(text).width)
  // Resizing the canvas resets every context property, so the font has to be
  // set again below rather than only once above.
  canvas.width = Math.max(64, width + SIZE * 0.9)
  canvas.height = Math.ceil(SIZE * 1.7)

  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2

  const cx = canvas.width / 2
  const cy = canvas.height / 2

  ctx.lineWidth = SIZE * 0.26
  ctx.strokeStyle = outlineFor(colour)
  ctx.strokeText(text, cx, cy)

  ctx.fillStyle = colour
  ctx.fillText(text, cx, cy)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return { texture, aspect: canvas.width / canvas.height }
}

type Live = {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  aspect: number
  age: number
  /** Seconds of travel before it lands. */
  travel: number
  from: THREE.Vector3
  to: THREE.Vector3
  spin: number
  struck: boolean
  onImpact: () => void
}

const HOLD = 0.16
const FALL = 0.62

export class Taunts {
  readonly group = new THREE.Group()
  private live: Live[] = []

  constructor() {
    // Drawn over the head rather than into it. A word that clips through a
    // cheek reads as a bug, not as a hit.
    this.group.renderOrder = 20
  }

  /**
   * Throws a word at `target`. `onImpact` fires once, on the frame it lands,
   * so the recoil and the sound belong to the caller rather than to this.
   */
  spawn(text: string, target: THREE.Vector3, colour: string, onImpact: () => void) {
    const trimmed = text.trim().slice(0, MAX_TAUNT)
    if (!trimmed) return 0

    const { texture, aspect } = makeLabel(trimmed.toUpperCase(), colour)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(material)

    // Starts off to one side as well as near the camera, so several in a row
    // don't stack along the same line.
    const swing = (Math.random() - 0.5) * 1.4
    const from = target.clone().add(new THREE.Vector3(swing, 0.35 + Math.random() * 0.3, 2.4))
    const to = target.clone().add(new THREE.Vector3(swing * 0.12, 0.06, 0.42))

    sprite.position.copy(from)
    this.group.add(sprite)

    // Longer words take longer to arrive, which makes a short jab land fast
    // and a mouthful feel like it's being wound up.
    const travel = 0.2 + Math.min(0.22, trimmed.length * 0.009)
    this.live.push({
      sprite,
      material,
      aspect,
      age: 0,
      travel,
      from,
      to,
      spin: (Math.random() - 0.5) * 0.5,
      struck: false,
      onImpact,
    })
    return travel
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i]
      t.age += dt

      if (t.age < t.travel) {
        // Accelerating in, so it arrives fast rather than gliding.
        const k = Math.pow(t.age / t.travel, 2.1)
        t.sprite.position.lerpVectors(t.from, t.to, k)
        this.size(t, THREE.MathUtils.lerp(0.28, 1, k))
        t.material.opacity = Math.min(1, t.age / (t.travel * 0.35))
        t.sprite.material.rotation = t.spin * (1 - k)
        continue
      }

      if (!t.struck) {
        t.struck = true
        t.onImpact()
      }

      const after = t.age - t.travel
      if (after < HOLD) {
        // One overshoot on landing. A word that simply stops has no weight.
        const punch = 1 + Math.sin((after / HOLD) * Math.PI) * 0.22
        this.size(t, punch)
        t.sprite.position.copy(t.to)
        continue
      }

      const k = (after - HOLD) / FALL
      if (k >= 1) {
        this.group.remove(t.sprite)
        t.material.map?.dispose()
        t.material.dispose()
        this.live.splice(i, 1)
        continue
      }
      // Tumbles up and back, fading. Up rather than down because it has to
      // clear the face it just hit.
      t.sprite.position.set(
        t.to.x + t.spin * k * 1.6,
        t.to.y + k * 0.85,
        t.to.z + k * 0.5,
      )
      this.size(t, 1 + k * 0.35)
      t.sprite.material.rotation = t.spin * k * 2.2
      t.material.opacity = 1 - k * k
    }
  }

  /** Sprite scale carries the label's own aspect, or the word comes out squashed. */
  private size(t: Live, scale: number) {
    const height = 0.34 * scale
    t.sprite.scale.set(height * t.aspect, height, 1)
  }

  clear() {
    for (const t of this.live) {
      this.group.remove(t.sprite)
      t.material.map?.dispose()
      t.material.dispose()
    }
    this.live.length = 0
  }
}
