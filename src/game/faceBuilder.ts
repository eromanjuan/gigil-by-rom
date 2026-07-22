import Delaunator from 'delaunator'
import * as THREE from 'three'
// Types only - the runtime is ~400kB and nobody needs it until they pick a
// photo, so it's pulled in dynamically below.
import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { EYE_RING_L, EYE_RING_R, FACE_OVAL, IRIS_L, IRIS_R, LM } from './landmarks'

/** Head height in world units. Everything else is sized off this. */
export const HEAD_HEIGHT = 1.0

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18'

export type FaceRig = {
  /**
   * True for a generated dummy, false for a face reconstructed from a photo.
   *
   * It decides who owns the skin tone. On a dummy the player picked it; on a
   * photo the face *is* the photo, so a chosen tone would leave the neck and
   * ears a different colour from the cheeks.
   */
  synthetic: boolean
  geometry: THREE.BufferGeometry
  texture: THREE.CanvasTexture
  /** Landmark positions in final head-local space, keyed by the LM table. */
  points: Record<keyof typeof LM, THREE.Vector3>
  /** Ordered silhouette ring in head-local space. */
  silhouette: THREE.Vector3[]
  width: number
  height: number
  depth: number
  skinTone: THREE.Color
  hairTone: THREE.Color
  /** 0 when nothing above the brow reads as hair (bald, hairless crop). */
  hairAmount: number
  /** Where the hair is in the photo, and what colour. Null when there is none. */
  hairMap: HairMap | null
  /** Sampled from below the chin, for the shirt. Falls back to a neutral. */
  clothingTone: THREE.Color
  /** Average colour of the photo, used to tint the studio lights to match. */
  ambientTone: THREE.Color
}

let landmarkerPromise: Promise<FaceLandmarker> | null = null

/**
 * Loads the landmarker once and reuses it. Prefers the assets in public/,
 * falls back to the CDN so a fresh clone that skipped `setup:assets` still runs.
 */
export function initLandmarker(): Promise<FaceLandmarker> {
  if (landmarkerPromise) return landmarkerPromise
  landmarkerPromise = (async () => {
    const vision = await import('@mediapipe/tasks-vision')
    const make = async (wasmRoot: string, model: string) => {
      const fileset = await vision.FilesetResolver.forVisionTasks(wasmRoot)
      return vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.2,
        minFacePresenceConfidence: 0.2,
      })
    }
    try {
      return await make('/wasm', '/models/face_landmarker.task')
    } catch {
      console.warn('[gigil] local MediaPipe assets missing, falling back to CDN')
      return make(
        `${CDN}/wasm`,
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      )
    }
  })()
  // Don't cache a rejection - otherwise one flaky load poisons every retry for
  // the rest of the session and "try again" can never succeed.
  landmarkerPromise.catch(() => {
    landmarkerPromise = null
  })
  return landmarkerPromise
}

export class NoFaceError extends Error {
  constructor() {
    super('No face found in that image.')
  }
}

/** Draws the source image into a canvas, capped so we never make a 6000px texture. */
function toCanvas(image: HTMLImageElement, maxSize = 1024) {
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight))
  const w = Math.max(1, Math.round(image.naturalWidth * scale))
  const h = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0, w, h)
  return { canvas, ctx, w, h }
}

/** Average colour of a small patch, returned in linear working space. */
function samplePatch(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  u: number,
  v: number,
  radiusPx = 6,
): THREE.Color {
  const cx = THREE.MathUtils.clamp(Math.round(u * w), radiusPx, w - radiusPx - 1)
  const cy = THREE.MathUtils.clamp(Math.round(v * h), radiusPx, h - radiusPx - 1)
  const size = radiusPx * 2 + 1
  const data = ctx.getImageData(cx - radiusPx, cy - radiusPx, size, size).data
  let r = 0
  let g = 0
  let b = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
  }
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace)
}

const gauss = (d: number, sigma: number) => Math.exp(-(d * d) / (2 * sigma * sigma))

/** The sRGB transfer function, matching what three does when it decodes a texture. */
const srgbToLinear = (c: number) =>
  c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4)

/* --------------------------------------------------------------- hair map */

/**
 * What the photo actually says about the hair, in a form the 3D side can ask
 * questions of.
 *
 * The shell used to be driven by a single probed colour and a horizontal cut
 * with some noise on it, which meant every head got the same haircut in a
 * different shade. This carries the real thing: where the hair is, how far out
 * it goes, and what colour it is at each point.
 */
export type HairMap = {
  /** Grid resolution; the grid spans the whole photo. */
  size: number
  /** Hair confidence per cell, 0..1. */
  mask: Float32Array
  /** Linear RGB per cell, 3 floats each. */
  rgb: Float32Array
  /**
   * Head-local (x, y) to photo UV, with v running up to match the geometry's
   * own UVs. Least-squares affine over every landmark, so it is exact for a
   * frontal photo and a sane approximation once frontalisation has rotated a
   * turned one.
   */
  project(x: number, y: number, out: { u: number; v: number }): void
  /** Bilinear mask sample. 0 outside the photo. */
  at(u: number, v: number): number
  /** Nearest-cell colour, linear. False when the point has no usable pixel. */
  colorAt(u: number, v: number, out: THREE.Color): boolean
}

/** Even-odd crossing test, in landmark UV space. */
function insideRing(px: number, py: number, ring: { x: number; y: number }[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Least-squares fit of `value = a*x + b*y + c` over the landmark set, by the
 * 3x3 normal equations. Used once per axis to relate head-local space back to
 * the photo.
 */
function fitPlane(xs: number[], ys: number[], vs: number[]) {
  let sxx = 0
  let sxy = 0
  let syy = 0
  let sx = 0
  let sy = 0
  let sxv = 0
  let syv = 0
  let sv = 0
  const n = xs.length
  for (let i = 0; i < n; i++) {
    sxx += xs[i] * xs[i]
    sxy += xs[i] * ys[i]
    syy += ys[i] * ys[i]
    sx += xs[i]
    sy += ys[i]
    sxv += xs[i] * vs[i]
    syv += ys[i] * vs[i]
    sv += vs[i]
  }
  // Gaussian elimination with partial pivoting on the augmented 3x4. Small
  // enough to be obviously right, which matters more here than being clever.
  const m = [
    [sxx, sxy, sx, sxv],
    [sxy, syy, sy, syv],
    [sx, sy, n, sv],
  ]
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return [0, 0, 0]
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let r = 0; r < 3; r++) {
      if (r === col) continue
      const f = m[r][col] / m[col][col]
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c]
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]]
}

const GRID = 128
const _channel = [0, 0, 0]

/**
 * Segments the hair out of the photo.
 *
 * Three tones are already known - skin from the cheeks, hair from the probe
 * fan above the brow, background from the border - so a pixel is scored by
 * which of the three it is nearest in linear RGB. That beats any fixed
 * threshold because it adapts to blonde-on-white and black-on-black alike.
 * The score is then gated on geometry: inside the face oval is a face, and
 * below the chin is a collar.
 */
function buildHairMap(
  pixels: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  landmarks: NormalizedLandmark[],
  raw: THREE.Vector3[],
  skinTone: THREE.Color,
  hairTone: THREE.Color,
  bgTone: THREE.Color,
  separation: number,
): HairMap {
  const mask = new Float32Array(GRID * GRID)
  const rgb = new Float32Array(GRID * GRID * 3)

  const ring = FACE_OVAL.map((i) => ({ x: landmarks[i].x, y: landmarks[i].y }))
  const brow = landmarks[LM.foreheadTop]
  const chin = landmarks[LM.chin]
  const span = Math.abs(chin.y - brow.y) || 0.2
  // Centre the search on the skull rather than the face, since that is what the
  // hair wraps: a little above the brow.
  const cx = (landmarks[LM.faceEdgeL].x + landmarks[LM.faceEdgeR].x) / 2
  const cy = brow.y - span * 0.12
  const reach = span * 1.35

  // Softening the score over half the gap between hair and skin keeps a lit
  // fringe or a dark shadow on the forehead from flipping hard either way.
  const soft = Math.max(0.05, separation * 0.5)

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const u = (gx + 0.5) / GRID
      const vDown = (gy + 0.5) / GRID
      const px = Math.min(imgW - 1, Math.floor(u * imgW))
      const py = Math.min(imgH - 1, Math.floor(vDown * imgH))
      const o = (py * imgW + px) * 4
      const r = srgbToLinear(pixels[o] / 255)
      const g = srgbToLinear(pixels[o + 1] / 255)
      const b = srgbToLinear(pixels[o + 2] / 255)

      const cell = gy * GRID + gx
      rgb[cell * 3] = r
      rgb[cell * 3 + 1] = g
      rgb[cell * 3 + 2] = b

      const dist = (c: THREE.Color) => Math.hypot(r - c.r, g - c.g, b - c.b)
      const toHair = dist(hairTone)
      const rival = Math.min(dist(skinTone), dist(bgTone))
      let s = THREE.MathUtils.clamp((rival - toHair) / soft, 0, 1)

      // Geometry gates. The colour test alone will happily call a dark jumper
      // or a shadowed jaw "hair".
      if (s > 0) {
        // `reach` is in normalised-y units, so the horizontal offset has to be
        // scaled by the aspect before it can be compared - otherwise the gate
        // is an ellipse and a wide photo lets in far too much either side.
        const d = Math.hypot(((u - cx) * imgW) / imgH, vDown - cy) / reach
        s *= 1 - THREE.MathUtils.smoothstep(d, 0.85, 1.15)
        if (vDown > chin.y) s = 0
        if (insideRing(u, vDown, ring)) s = 0
      }
      mask[cell] = s
    }
  }

  // Two box passes. The mask drives geometry, and an unsmoothed one puts a
  // staircase on the hairline that no amount of vertex jitter hides.
  const tmp = new Float32Array(mask.length)
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? mask : tmp
    const dst = pass === 0 ? tmp : mask
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        let total = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sx = gx + dx
            const sy = gy + dy
            if (sx < 0 || sy < 0 || sx >= GRID || sy >= GRID) continue
            total += src[sy * GRID + sx]
            n++
          }
        }
        dst[gy * GRID + gx] = total / n
      }
    }
  }

  // Head-local (x, y) back to photo UV. v is flipped to run up, matching the
  // face geometry's own UV attribute.
  const xs = raw.map((p) => p.x)
  const ys = raw.map((p) => p.y)
  const [ua, ub, uc] = fitPlane(xs, ys, landmarks.map((p) => p.x))
  const [va, vb, vc] = fitPlane(xs, ys, landmarks.map((p) => 1 - p.y))

  const at = (u: number, v: number) => {
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0
    const gx = THREE.MathUtils.clamp(u * GRID - 0.5, 0, GRID - 1.001)
    const gy = THREE.MathUtils.clamp((1 - v) * GRID - 0.5, 0, GRID - 1.001)
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const fx = gx - x0
    const fy = gy - y0
    const m = (x: number, y: number) => mask[y * GRID + x]
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(m(x0, y0), m(x0 + 1, y0), fx),
      THREE.MathUtils.lerp(m(x0, y0 + 1), m(x0 + 1, y0 + 1), fx),
      fy,
    )
  }

  return {
    size: GRID,
    mask,
    rgb,
    project(x, y, out) {
      out.u = ua * x + ub * y + uc
      out.v = va * x + vb * y + vc
    },
    at,
    colorAt(u, v, out) {
      if (u < 0 || u > 1 || v < 0 || v > 1) return false
      // Bilinear, not nearest. One cell is most of a centimetre of face, so
      // nearest sampling quantises the hair into visible blocks and then the
      // per-strand shading in the shader multiplies that up into confetti.
      const gx = THREE.MathUtils.clamp(u * GRID - 0.5, 0, GRID - 1.001)
      const gy = THREE.MathUtils.clamp((1 - v) * GRID - 0.5, 0, GRID - 1.001)
      const x0 = Math.floor(gx)
      const y0 = Math.floor(gy)
      const fx = gx - x0
      const fy = gy - y0
      for (let ch = 0; ch < 3; ch++) {
        const s = (x: number, y: number) => rgb[(y * GRID + x) * 3 + ch]
        const top = THREE.MathUtils.lerp(s(x0, y0), s(x0 + 1, y0), fx)
        const bottom = THREE.MathUtils.lerp(s(x0, y0 + 1), s(x0 + 1, y0 + 1), fx)
        _channel[ch] = THREE.MathUtils.lerp(top, bottom, fy)
      }
      out.setRGB(_channel[0], _channel[1], _channel[2], THREE.LinearSRGBColorSpace)
      return true
    },
  }
}

/**
 * MediaPipe's z is normalised by image width but doesn't come out at quite the
 * same scale as x/y. This nudges depth back to something anatomically sane;
 * too high and frontalised faces come out snouty, too low and they go flat.
 */
const DEPTH_SCALE = 0.85

const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _basis = new THREE.Matrix4()

/**
 * Rotates the point cloud into the face's own frame, cancelling whatever yaw,
 * pitch and roll the photo was taken at. Built from the interocular axis and
 * the brow-to-chin axis, then orthonormalised so the transform stays rigid -
 * we're re-orienting the head, not reshaping it.
 */
function frontalize(raw: THREE.Vector3[]) {
  _right.subVectors(raw[LM.eyeOuterR], raw[LM.eyeOuterL])
  // MediaPipe's left/right are the subject's, which flips depending on how they
  // face. Force +X to mean image-right so the basis is never mirrored.
  if (_right.x < 0) _right.negate()
  _right.normalize()

  _up.subVectors(raw[LM.foreheadTop], raw[LM.chin]).normalize()
  _forward.crossVectors(_right, _up).normalize()
  if (_forward.lengthSq() < 0.5) return // degenerate; leave the pose alone
  _up.crossVectors(_forward, _right).normalize()

  // Columns are the face's axes, so the transpose takes world space to face
  // space - which is exactly the frontal pose we want.
  _basis.makeBasis(_right, _up, _forward).transpose()
  for (const p of raw) p.applyMatrix4(_basis)
}

/** Shortest distance from p to the closed polyline ring, in 2D landmark space. */
function distanceToRing(px: number, py: number, ring: { x: number; y: number }[]) {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby || 1e-9
    const t = THREE.MathUtils.clamp(((px - a.x) * abx + (py - a.y) * aby) / len2, 0, 1)
    const dx = px - (a.x + abx * t)
    const dy = py - (a.y + aby * t)
    best = Math.min(best, Math.hypot(dx, dy))
  }
  return best
}

export async function buildFace(image: HTMLImageElement): Promise<FaceRig> {
  const landmarker = await initLandmarker()
  const { canvas, ctx, w, h } = toCanvas(image)

  const result = landmarker.detect(canvas)
  const landmarks = result.faceLandmarks?.[0]
  if (!landmarks || landmarks.length < 468) throw new NoFaceError()

  return assembleRig(landmarks, canvas, ctx, w, h)
}

function assembleRig(
  landmarks: NormalizedLandmark[],
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  imgW: number,
  imgH: number,
): FaceRig {
  const count = landmarks.length
  const aspect = imgW / imgH

  // MediaPipe normalises x and z by image width, y by image height. Undo that so
  // the point cloud has real proportions, with +Y up and +Z toward the camera.
  const raw: THREE.Vector3[] = landmarks.map(
    (p) => new THREE.Vector3((p.x - 0.5) * aspect, -(p.y - 0.5), -(p.z ?? 0) * DEPTH_SCALE * aspect),
  )

  // Almost nobody uploads a dead-on portrait. Rotate the point cloud into the
  // face's own frame so the reconstruction always ends up facing the camera -
  // otherwise a three-quarter photo builds a head that's turned away from the
  // player and can't line up with the skull behind it.
  frontalize(raw)

  // Normalise scale off the forehead-to-chin span, and centre on the head.
  const faceSpan = raw[LM.foreheadTop].distanceTo(raw[LM.chin]) || 1
  const scale = HEAD_HEIGHT / faceSpan
  const centre = new THREE.Vector3()
    .addVectors(raw[LM.foreheadTop], raw[LM.chin])
    .multiplyScalar(0.5)
  centre.x = (raw[LM.faceEdgeL].x + raw[LM.faceEdgeR].x) / 2
  // Sit the origin a little behind the face surface, where a skull's centre is.
  const depthAnchor = raw[LM.noseTip].z
  for (const p of raw) {
    p.sub(centre)
    p.z -= (depthAnchor - centre.z) * 0.45
    p.multiplyScalar(scale)
  }

  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = raw[i].x
    positions[i * 3 + 1] = raw[i].y
    positions[i * 3 + 2] = raw[i].z
    uvs[i * 2] = landmarks[i].x
    uvs[i * 2 + 1] = 1 - landmarks[i].y
  }

  // --- Triangulate ---------------------------------------------------------
  // Delaunay over the *frontalised* projection. Triangulating the original
  // projection instead would collapse the far half of a turned face into
  // slivers, which is what tears holes through the nose and cheek.
  const flat = new Float64Array(count * 2)
  for (let i = 0; i < count; i++) {
    flat[i * 2] = raw[i].x
    flat[i * 2 + 1] = -raw[i].y
  }
  const delaunay = new Delaunator(flat)
  const tris = delaunay.triangles

  // Median edge length gives us a scale-free threshold for junk triangles that
  // bridge across the nostrils, lips or the outside of the hull.
  const edgeLengths: number[] = []
  for (let i = 0; i < tris.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[i + e]
      const b = tris[i + ((e + 1) % 3)]
      edgeLengths.push(Math.hypot(flat[a * 2] - flat[b * 2], flat[a * 2 + 1] - flat[b * 2 + 1]))
    }
  }
  edgeLengths.sort((a, b) => a - b)
  const median = edgeLengths[Math.floor(edgeLengths.length / 2)] || 1
  const maxEdge = median * 5

  // Winding: delaunator emits a consistent orientation in the y-down source
  // space, which flips when we mirror Y. Detect it once, apply to all.
  const signedArea = (i: number) => {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]]
    return (
      (positions[b * 3] - positions[a * 3]) * (positions[c * 3 + 1] - positions[a * 3 + 1]) -
      (positions[c * 3] - positions[a * 3]) * (positions[b * 3 + 1] - positions[a * 3 + 1])
    )
  }
  let flip = false
  for (let i = 0; i < tris.length; i += 3) {
    const area = signedArea(i)
    if (Math.abs(area) > 1e-9) {
      flip = area < 0
      break
    }
  }

  const index: number[] = []
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i]
    const b = tris[i + 1]
    const c = tris[i + 2]
    const ab = Math.hypot(flat[a * 2] - flat[b * 2], flat[a * 2 + 1] - flat[b * 2 + 1])
    const bc = Math.hypot(flat[b * 2] - flat[c * 2], flat[b * 2 + 1] - flat[c * 2 + 1])
    const ca = Math.hypot(flat[c * 2] - flat[a * 2], flat[c * 2 + 1] - flat[a * 2 + 1])
    const longest = Math.max(ab, bc, ca)
    if (longest > maxEdge) continue
    // Drop needle-thin slivers. They shade badly and, around the silhouette,
    // fold back on themselves into visible dark shards.
    const area = Math.abs(signedArea(i)) / 2
    if (area < longest * longest * 0.02) continue
    if (flip) index.push(a, c, b)
    else index.push(a, b, c)
  }

  // --- Per-vertex flex -----------------------------------------------------
  // How much each vertex gives when struck. Rigid at the silhouette (it's
  // welded to the skull), soft over the cheeks, floppiest around the lips,
  // and firm across the eyes so they don't smear into the sockets.
  // All measured in the frontalised space, so a turned photo gets the same
  // flex field as a straight-on one.
  const ring = FACE_OVAL.map((i) => ({ x: raw[i].x, y: raw[i].y }))
  const faceWidth = Math.abs(raw[LM.faceEdgeR].x - raw[LM.faceEdgeL].x) || 1
  const mouth = raw[LM.lipTop]
  const eyeL = raw[LM.eyeOuterL]
  const eyeR = raw[LM.eyeOuterR]
  const stiff = new Set<number>([...EYE_RING_L, ...EYE_RING_R, ...IRIS_L, ...IRIS_R])

  const flex = new Float32Array(count)
  const edge = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const px = raw[i].x
    const py = raw[i].y
    const edgeDist = distanceToRing(px, py, ring)
    // 0 right at the silhouette, 1 once we're comfortably inside it.
    edge[i] = THREE.MathUtils.smoothstep(edgeDist / (faceWidth * 0.1), 0, 1)

    let f = THREE.MathUtils.smoothstep(edgeDist / (faceWidth * 0.28), 0, 1)
    f *= 1 + 0.7 * gauss(Math.hypot(px - mouth.x, py - mouth.y), faceWidth * 0.14)
    f *= 1 - 0.5 * gauss(Math.hypot(px - eyeL.x, py - eyeL.y), faceWidth * 0.1)
    f *= 1 - 0.5 * gauss(Math.hypot(px - eyeR.x, py - eyeR.y), faceWidth * 0.1)
    if (stiff.has(i)) f *= 0.35
    flex[i] = THREE.MathUtils.clamp(f, 0, 1.4)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('aFlex', new THREE.BufferAttribute(flex, 1))
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true

  const points = {} as Record<keyof typeof LM, THREE.Vector3>
  for (const [name, idx] of Object.entries(LM) as [keyof typeof LM, number][]) {
    points[name] = (raw[idx] ?? raw[LM.noseTip]).clone()
  }

  const silhouette = FACE_OVAL.map((i) => raw[i].clone())

  const bbox = geometry.boundingBox!
  const skinTone = samplePatch(ctx, imgW, imgH, landmarks[LM.cheekL].x, landmarks[LM.cheekL].y)
    .lerp(samplePatch(ctx, imgW, imgH, landmarks[LM.cheekR].x, landmarks[LM.cheekR].y), 0.5)

  // Hair: probe a fan of points above the brow and keep whichever reads least
  // like skin. Landmark 10 sits at the hairline, so a single sample straight
  // above it lands on forehead as often as hair. If nothing differs, they're
  // bald or hatless and the skin tone is the right answer anyway.
  const span = landmarks[LM.chin].y - landmarks[LM.foreheadTop].y
  let hairTone = skinTone
  let bestDistance = 0.055
  for (const dx of [-0.16, -0.08, 0, 0.08, 0.16]) {
    for (const dy of [0.06, 0.14, 0.24]) {
      const u = landmarks[LM.foreheadTop].x + dx * span
      const v = landmarks[LM.foreheadTop].y - dy * span
      if (u < 0.02 || u > 0.98 || v < 0.02) continue
      const sampled = samplePatch(ctx, imgW, imgH, u, v)
      // Compare against skin in linear space; hair is usually much darker.
      const distance = Math.hypot(
        sampled.r - skinTone.r,
        sampled.g - skinTone.g,
        sampled.b - skinTone.b,
      )
      if (distance > bestDistance) {
        bestDistance = distance
        hairTone = sampled
      }
    }
  }

  // Clothing: probe below the jaw, down the middle and slightly out to each
  // side. Anything close to skin tone is neck, not shirt, so it's rejected.
  let clothingTone = new THREE.Color('#2f3742')
  let clothingScore = 0.1
  for (const dx of [-0.28, -0.14, 0, 0.14, 0.28]) {
    for (const dy of [0.3, 0.52, 0.78]) {
      const u = landmarks[LM.chin].x + dx * span
      const v = landmarks[LM.chin].y + dy * span
      if (u < 0.02 || u > 0.98 || v > 0.985) continue
      const sampled = samplePatch(ctx, imgW, imgH, u, v, 8)
      const distance = Math.hypot(
        sampled.r - skinTone.r,
        sampled.g - skinTone.g,
        sampled.b - skinTone.b,
      )
      if (distance > clothingScore) {
        clothingScore = distance
        clothingTone = sampled
      }
    }
  }

  // Overall cast of the photo, so the stage lighting can be nudged toward it
  // and the generated body doesn't look lit by a different sun than the face.
  const thumb = ctx.getImageData(0, 0, imgW, imgH).data
  let ar = 0
  let ag = 0
  let ab = 0
  const stride = Math.max(4, Math.floor(thumb.length / 4 / 4096) * 4)
  let samples = 0
  for (let i = 0; i < thumb.length; i += stride) {
    ar += thumb[i]
    ag += thumb[i + 1]
    ab += thumb[i + 2]
    samples++
  }
  const ambientTone = new THREE.Color().setRGB(
    ar / samples / 255,
    ag / samples / 255,
    ab / samples / 255,
    THREE.SRGBColorSpace,
  )

  // Background, from the four corners and the middle of the top edge. Portraits
  // put the head in the middle, so the border is the safest guess at "not the
  // subject". A busy background degrades the hair mask rather than breaking it,
  // because the mask still has to beat the skin tone as well.
  const bgTone = new THREE.Color(0, 0, 0)
  const corners: [number, number][] = [
    [0.03, 0.03],
    [0.97, 0.03],
    [0.03, 0.97],
    [0.97, 0.97],
    [0.5, 0.02],
  ]
  for (const [u, v] of corners) {
    const patch = samplePatch(ctx, imgW, imgH, u, v, 8)
    bgTone.r += patch.r / corners.length
    bgTone.g += patch.g / corners.length
    bgTone.b += patch.b / corners.length
  }

  const hairAmount = THREE.MathUtils.clamp((bestDistance - 0.055) / 0.16, 0, 1)
  // A bald or hatless head has no hair to segment, and running the classifier
  // anyway would find "hair" wherever the lighting fell off.
  const hairMap =
    hairAmount > 0.02
      ? buildHairMap(thumb, imgW, imgH, landmarks, raw, skinTone, hairTone, bgTone, bestDistance)
      : null

  return {
    synthetic: false,
    geometry,
    texture,
    points,
    silhouette,
    width: bbox.max.x - bbox.min.x,
    height: bbox.max.y - bbox.min.y,
    depth: bbox.max.z - bbox.min.z,
    skinTone,
    hairTone,
    // How confidently the probes found something that isn't skin. Drives how
    // much hair volume to build, so a bald head doesn't get skin-toned fuzz.
    hairAmount,
    hairMap,
    clothingTone,
    ambientTone,
  }
}
