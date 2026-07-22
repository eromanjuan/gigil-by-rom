import * as THREE from 'three'
import { HEAD_HEIGHT, type FaceRig } from './faceBuilder'
import { LM } from './landmarks'

/**
 * The faceless dummy.
 *
 * A generated stand-in for the photo path, so the game is playable with no
 * upload at all. It produces the same `FaceRig` shape that `buildFace` does,
 * which means everything downstream - the cranium sweep, hair, ears, neck,
 * clothing, deformation, bruises - works on it unchanged. The only thing it
 * doesn't have is a face, which is the point: it's a target, not a person,
 * until someone chooses to put a photo on it.
 *
 * Deliberately smooth. A dummy with moulded eyes and a mouth reads as a badly
 * made person; a blank one reads as a mannequin, which is what it is.
 */

type Proportions = {
  /** Half the face width at the cheekbones, in head heights. */
  halfWidth: number
  /** 0 tapers to a point, 1 keeps the jaw square. */
  jaw: number
  /** How far the face bulges forward of the silhouette. */
  depth: number
  /** Brow ridge prominence. */
  brow: number
  /** Nose projection. */
  nose: number
}

/**
 * One neutral head. There were three, split by gender, but the widest of them
 * differed from the narrowest by three percent of a face - invisible at this
 * framing, and not worth a step in the flow to choose between.
 */
const PROPORTIONS: Proportions = {
  halfWidth: 0.35,
  jaw: 0.7,
  depth: 0.288,
  brow: 0.022,
  nose: 0.066,
}

/**
 * Width modulation from crown to chin, where 1 is a plain ellipse.
 *
 * It has to be a modulation and not an absolute width, because the ring is
 * already swept with a sine that closes it at both poles. Tapering this to
 * zero as well applied the narrowing twice and pinched the head into a
 * teardrop with a pointed chin.
 *
 * The widest point is the cheekbones, a little above the middle - not the
 * temples, which is the mistake that makes a generated head read as an egg.
 */
const WIDTH_PROFILE = [1, 1.06, 1.1, 1.12, 1.1, 1.04, 0.96, 0.86, 0.74, 0.6, 0.42]

const TOP_Y = HEAD_HEIGHT * 0.5
const BOTTOM_Y = -HEAD_HEIGHT * 0.5

/** Sampled width profile, with the jaw taper applied below the cheekbones. */
function halfWidthAt(v: number, p: Proportions) {
  const t = THREE.MathUtils.clamp(v, 0, 1) * (WIDTH_PROFILE.length - 1)
  const i = Math.min(WIDTH_PROFILE.length - 2, Math.floor(t))
  const base = THREE.MathUtils.lerp(WIDTH_PROFILE[i], WIDTH_PROFILE[i + 1], t - i)
  // A square jaw holds its width below the cheekbones where a tapered one
  // falls away. It widens the profile rather than replacing it, so the chin
  // still closes.
  const below = THREE.MathUtils.clamp((v - 0.5) / 0.5, 0, 1)
  return p.halfWidth * base * (1 + p.jaw * below * 0.3)
}

/**
 * How far forward the face surface sits at a point on it.
 *
 * A dome, plus the three things that stop a head being a dome: a brow ridge, a
 * nose, and a chin that comes forward rather than falling away.
 */
function surfaceZ(x: number, y: number, p: Proportions) {
  const nx = x / p.halfWidth
  const ny = (y - BOTTOM_Y) / HEAD_HEIGHT
  const radial = THREE.MathUtils.clamp(1 - (nx * nx + Math.pow((ny - 0.5) * 1.6, 2)), 0, 1)
  let z = p.depth * Math.pow(radial, 0.75)

  // Brow: a horizontal ridge just above the eyes, fading out at the temples.
  z += p.brow * Math.exp(-Math.pow((y - 0.13) / 0.07, 2)) * Math.exp(-Math.pow(nx / 0.85, 2))
  // Nose: a narrow vertical ridge from the bridge to the tip.
  const noseSpan = THREE.MathUtils.smoothstep(y, -0.2, 0.14) * (1 - THREE.MathUtils.smoothstep(y, 0.14, 0.2))
  z += p.nose * noseSpan * Math.exp(-Math.pow(nx / 0.2, 2))
  // Chin.
  z += p.depth * 0.16 * Math.exp(-Math.pow((y + 0.4) / 0.12, 2)) * Math.exp(-Math.pow(nx / 0.45, 2))
  return z
}

/** Named target positions, as (x, y) in head heights. L is -X, R is +X. */
const POINTS: Record<keyof typeof LM, [number, number]> = {
  foreheadTop: [0, 0.5],
  chin: [0, -0.5],
  noseTip: [0, -0.1],
  noseBridge: [0, 0.12],
  noseUnder: [0, -0.17],
  nostrilL: [-0.07, -0.155],
  nostrilR: [0.07, -0.155],
  eyeOuterL: [-0.21, 0.07],
  eyeInnerL: [-0.075, 0.06],
  eyeOuterR: [0.21, 0.07],
  eyeInnerR: [0.075, 0.06],
  eyeUpperL: [-0.14, 0.095],
  eyeLowerL: [-0.14, 0.035],
  eyeUpperR: [0.14, 0.095],
  eyeLowerR: [0.14, 0.035],
  irisL: [-0.14, 0.065],
  irisR: [0.14, 0.065],
  mouthL: [-0.115, -0.285],
  mouthR: [0.115, -0.285],
  lipTop: [0, -0.26],
  lipBottom: [0, -0.305],
  lipOuterTop: [0, -0.235],
  lipOuterBottom: [0, -0.335],
  cheekL: [-0.235, -0.055],
  cheekR: [0.235, -0.055],
  faceEdgeL: [-1, 0.02],
  faceEdgeR: [1, 0.02],
  templeL: [-0.85, 0.3],
  templeR: [0.85, 0.3],
}

const RINGS = 9
const COLUMNS = 48

/**
 * Builds the front shell as concentric rings from the centre out to the
 * silhouette, so the outline is exact by construction - the same reason the
 * cranium is grown from the face's own boundary rather than fitted as a
 * primitive. The outermost ring *is* the silhouette handed to `buildBust`.
 */
export function buildDummyRig(tones: {
  skin: THREE.Color
  hair: THREE.Color
  clothing: THREE.Color
}): FaceRig {
  const p = PROPORTIONS

  // --- Silhouette ---------------------------------------------------------
  // Down the right side, then back up the left, so the ring is one continuous
  // loop in a consistent winding.
  const outline: THREE.Vector3[] = []
  for (let i = 0; i < COLUMNS; i++) {
    const a = (i / COLUMNS) * Math.PI * 2
    // v runs 0 at the crown to 1 at the chin.
    const v = (1 - Math.cos(a)) / 2
    const y = THREE.MathUtils.lerp(TOP_Y, BOTTOM_Y, v)
    const x = halfWidthAt(v, p) * Math.sin(a)
    outline.push(new THREE.Vector3(x, y, surfaceZ(x, y, p) * 0.18))
  }

  // --- Front shell --------------------------------------------------------
  const positions: number[] = []
  const uvs: number[] = []
  const flex: number[] = []
  const edge: number[] = []
  const index: number[] = []

  const centreY = (TOP_Y + BOTTOM_Y) / 2
  const push = (x: number, y: number, t: number) => {
    // The outer ring sits on the silhouette; everything inside bulges forward.
    const z = THREE.MathUtils.lerp(surfaceZ(x, y, p), surfaceZ(x, y, p) * 0.18, Math.pow(t, 3))
    positions.push(x, y, z)
    uvs.push(0.5 + x / (p.halfWidth * 2.2), 0.5 + (y - centreY) / (HEAD_HEIGHT * 1.1))
    // Rigid at the silhouette where the face is welded to the skull, soft over
    // the middle - the same field the photo path derives from its landmarks.
    edge.push(THREE.MathUtils.smoothstep(1 - t, 0, 0.14))
    flex.push(THREE.MathUtils.smoothstep(1 - t, 0, 0.4) * 0.9)
  }

  // Centre vertex, then RINGS rings outward.
  push(0, centreY + 0.02, 0)
  for (let r = 1; r <= RINGS; r++) {
    const t = r / RINGS
    for (let i = 0; i < COLUMNS; i++) {
      const o = outline[i]
      push(o.x * t, THREE.MathUtils.lerp(centreY + 0.02, o.y, t), t)
    }
  }

  // Fan around the centre, then quads between successive rings.
  for (let i = 0; i < COLUMNS; i++) {
    index.push(0, 1 + i, 1 + ((i + 1) % COLUMNS))
  }
  for (let r = 0; r < RINGS - 1; r++) {
    const a0 = 1 + r * COLUMNS
    const b0 = 1 + (r + 1) * COLUMNS
    for (let i = 0; i < COLUMNS; i++) {
      const j = (i + 1) % COLUMNS
      index.push(a0 + i, b0 + i, a0 + j, a0 + j, b0 + i, b0 + j)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1))
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  // --- Named targets ------------------------------------------------------
  const points = {} as Record<keyof typeof LM, THREE.Vector3>
  for (const [name, [fx, fy]] of Object.entries(POINTS) as [keyof typeof LM, [number, number]][]) {
    // faceEdge and temple are given as fractions of the width at their own
    // height, so they track the outline rather than floating off it.
    const v = (TOP_Y - fy) / HEAD_HEIGHT
    const x = Math.abs(fx) > 0.5 ? Math.sign(fx) * halfWidthAt(v, p) * Math.abs(fx) : fx
    points[name] = new THREE.Vector3(x, fy, surfaceZ(x, fy, p))
  }

  // --- Blank skin ---------------------------------------------------------
  // A flat canvas rather than no map at all, so the face material is identical
  // between the two paths and a photo can replace it later without rebuilding.
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = `#${tones.skin.getHexString()}`
  ctx.fillRect(0, 0, 8, 8)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  const box = geometry.boundingBox!
  return {
    synthetic: true,
    geometry,
    texture,
    points,
    silhouette: outline,
    width: box.max.x - box.min.x,
    height: box.max.y - box.min.y,
    depth: box.max.z - box.min.z,
    skinTone: tones.skin,
    hairTone: tones.hair,
    // Full volume: the dummy's hair is chosen, not detected, so there is no
    // confidence to scale it by.
    hairAmount: 1,
    // No photo, so nothing to segment - hair falls back to the geometric rule,
    // which is the reliable path anyway.
    hairMap: null,
    clothingTone: tones.clothing,
    ambientTone: new THREE.Color('#8b8f99'),
  }
}
