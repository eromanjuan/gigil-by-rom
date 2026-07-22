import * as THREE from 'three'
import { CONTACT_POINT, type Hand, type HandKind } from './hands'

/**
 * A scanned hand, pulled out of a GLB.
 *
 * The source file holds six separate meshes laid out side by side like a
 * product sheet rather than one hand, so the useful geometry has to be found
 * and cut out before it can be used. And because the mesh has no skeleton,
 * what comes back is rigid: it implements the same interface as the procedural
 * rig so attacks don't need to care, but `setPose` and `setContact` are no-ops
 * and every move shares the one scanned pose.
 */

const MODEL_URL = '/models/hands/hand.glb'

/**
 * Which of the extracted pieces to use, in the deterministic order below
 * (vertex count descending, then centroid). Set from looking at
 * /hand-model-test.html, which draws every piece with its index.
 */
export const PIECE_INDEX = 0

/**
 * The procedural rig's own dimensions, in its canonical frame: fingertips at
 * this Z, and this much total length including the forearm.
 *
 * Matching them is what lets the scan drop in without touching a single attack
 * keyframe. Every strike is authored as an offset from a contact point in this
 * frame, so a scan scaled or seated differently would land short or long on
 * all seven moves at once.
 */
const FINGERTIP_Z = -1.37
const TOTAL_LENGTH = 2.63
/** Wrist to fingertip on the procedural rig — what the scan is matched against. */
const HAND_LENGTH = 1.37

/**
 * Distance from the fingertips back to the wrist, in the geometry's own units.
 *
 * A hand is wide at the palm and narrow at the wrist, and a forearm widens
 * again toward the elbow - so the wrist is the first minimum in cross-sectional
 * width walking back from the widest slice. That's a far more stable landmark
 * than either end of the mesh, because how much arm a scan includes is
 * arbitrary. Returns 0 when the shape doesn't have that profile at all.
 */
function measureHand(geometry: THREE.BufferGeometry, box: THREE.Box3): number {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const BINS = 40
  const lo = new Float32Array(BINS).fill(Infinity)
  const hi = new Float32Array(BINS).fill(-Infinity)
  const zLo = box.min.z
  const span = box.max.z - zLo || 1

  for (let i = 0; i < position.count; i++) {
    const bin = Math.min(BINS - 1, Math.max(0, Math.floor(((position.getZ(i) - zLo) / span) * BINS)))
    const x = position.getX(i)
    if (x < lo[bin]) lo[bin] = x
    if (x > hi[bin]) hi[bin] = x
  }
  const width = (b: number) => (hi[b] > lo[b] ? hi[b] - lo[b] : 0)

  // Fingers point toward -Z, so bin 0 is the fingertip end.
  let palm = 0
  for (let b = 1; b < BINS; b++) if (width(b) > width(palm)) palm = b

  let wrist = palm
  for (let b = palm + 1; b < BINS; b++) {
    if (width(b) <= width(wrist)) wrist = b
    else break
  }
  if (wrist === palm) return 0
  return ((wrist + 0.5) / BINS) * span
}

/**
 * Splits a geometry into connected pieces.
 *
 * Vertices are welded by position first. Scans duplicate their vertices along
 * every UV seam, and without welding those duplicates the surface reads as
 * hundreds of disconnected shards instead of one solid.
 */
function splitComponents(geometry: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const index = geometry.getIndex()
  if (!index) return [geometry]

  const count = position.count
  geometry.computeBoundingBox()
  const size = geometry.boundingBox!.getSize(new THREE.Vector3())
  const quantum = Math.max(1e-9, size.length() * 1e-4)

  const canon = new Map<string, number>()
  const rep = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    const key =
      `${Math.round(position.getX(i) / quantum)},` +
      `${Math.round(position.getY(i) / quantum)},` +
      `${Math.round(position.getZ(i) / quantum)}`
    const existing = canon.get(key)
    if (existing === undefined) canon.set(key, i)
    rep[i] = existing ?? i
  }

  const parent = new Int32Array(count)
  for (let i = 0; i < count; i++) parent[i] = i
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let i = 0; i < index.count; i += 3) {
    union(rep[index.getX(i)], rep[index.getX(i + 1)])
    union(rep[index.getX(i + 1)], rep[index.getX(i + 2)])
  }

  // Bucket triangles by the component their first corner belongs to.
  const byRoot = new Map<number, number[]>()
  for (let i = 0; i < index.count; i += 3) {
    const root = find(rep[index.getX(i)])
    let list = byRoot.get(root)
    if (!list) byRoot.set(root, (list = []))
    list.push(index.getX(i), index.getX(i + 1), index.getX(i + 2))
  }

  const pieces: { geometry: THREE.BufferGeometry; count: number; centre: THREE.Vector3 }[] = []
  for (const triangles of byRoot.values()) {
    if (triangles.length < 30) continue
    // Remap to a compact vertex range so each piece carries only its own.
    const remap = new Map<number, number>()
    const order: number[] = []
    const newIndex = triangles.map((v) => {
      let n = remap.get(v)
      if (n === undefined) {
        n = order.length
        remap.set(v, n)
        order.push(v)
      }
      return n
    })

    const piece = new THREE.BufferGeometry()
    for (const name of Object.keys(geometry.attributes)) {
      const src = geometry.getAttribute(name) as THREE.BufferAttribute
      const dst = new THREE.BufferAttribute(
        new Float32Array(order.length * src.itemSize),
        src.itemSize,
      )
      for (let i = 0; i < order.length; i++) {
        for (let c = 0; c < src.itemSize; c++) {
          dst.array[i * src.itemSize + c] = src.array[order[i] * src.itemSize + c]
        }
      }
      piece.setAttribute(name, dst)
    }
    piece.setIndex(newIndex)
    piece.computeBoundingBox()
    pieces.push({
      geometry: piece,
      count: order.length,
      centre: piece.boundingBox!.getCenter(new THREE.Vector3()),
    })
  }

  // Deterministic: the same file must always yield the same piece order, or
  // PIECE_INDEX means something different every reload.
  pieces.sort(
    (a, b) =>
      b.count - a.count ||
      a.centre.x - b.centre.x ||
      a.centre.y - b.centre.y ||
      a.centre.z - b.centre.z,
  )
  return pieces.map((p) => p.geometry)
}

/**
 * Rotates and scales a scanned piece into the rig's canonical frame: wrist at
 * the origin, fingers down -Z, palm facing +Y.
 *
 * The axes come from the covariance of the point cloud - longest is along the
 * fingers, shortest is the palm normal, because a hand is far longer than it
 * is wide and far wider than it is thick. Which *end* is the wrist can't be
 * had from the axes, so it's taken from where the mass sits: a hand tapers
 * toward the fingers, so the heavier half is the palm.
 */
export function canonicalise(
  geometry: THREE.BufferGeometry,
  flipPalm = false,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const n = position.count
  const centre = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    centre.x += position.getX(i) / n
    centre.y += position.getY(i) / n
    centre.z += position.getZ(i) / n
  }

  // Covariance, then its eigenvectors by repeated power iteration + deflation.
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const d = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    d.set(position.getX(i), position.getY(i), position.getZ(i)).sub(centre)
    const v = [d.x, d.y, d.z]
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r * 3 + c] += (v[r] * v[c]) / n
  }
  const axes: THREE.Vector3[] = []
  const m = cov.slice()
  for (let k = 0; k < 3; k++) {
    let v = new THREE.Vector3(0.7, 0.5, 0.3)
    for (let it = 0; it < 200; it++) {
      const nx = m[0] * v.x + m[1] * v.y + m[2] * v.z
      const ny = m[3] * v.x + m[4] * v.y + m[5] * v.z
      const nz = m[6] * v.x + m[7] * v.y + m[8] * v.z
      const next = new THREE.Vector3(nx, ny, nz)
      if (next.lengthSq() < 1e-20) break
      v = next.normalize()
    }
    let lambda = 0
    const vv = [v.x, v.y, v.z]
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) lambda += vv[r] * m[r * 3 + c] * vv[c]
    axes.push(v.clone())
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] -= lambda * vv[r] * vv[c]
  }

  const along = axes[0]
  const normal = axes[2]

  // Which end is the wrist: project onto the long axis and compare how much
  // mass sits either side of the midpoint. The palm end is the heavier one.
  let lo = Infinity
  let hi = -Infinity
  const t = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    d.set(position.getX(i), position.getY(i), position.getZ(i)).sub(centre)
    t[i] = d.dot(along)
    lo = Math.min(lo, t[i])
    hi = Math.max(hi, t[i])
  }
  const mid = (lo + hi) / 2
  let below = 0
  for (let i = 0; i < n; i++) if (t[i] < mid) below++
  // Fingers should end up at -Z, so the light end must map to negative.
  const flip = below < n / 2 ? -1 : 1

  const forward = along.clone().multiplyScalar(flip)
  // Re-orthogonalise: the palm normal must be square to the finger axis before
  // it can be used to build a frame.
  const up = normal
    .clone()
    .addScaledVector(forward, -normal.dot(forward))
    .normalize()
    .multiplyScalar(flipPalm ? -1 : 1)

  // Power iteration returns eigenvectors with an arbitrary sign, so `across`
  // could come out pointing either way - and a basis that happens to land
  // left-handed MIRRORS the mesh, silently turning a right hand into a left
  // one. Rebuilding the third axis from a cross product forces the basis
  // right-handed and makes that sign irrelevant.
  const side = new THREE.Vector3().crossVectors(up, forward).normalize()
  const basis = new THREE.Matrix4().makeBasis(side, up, forward)
  // Transpose maps world into the hand's frame; the basis columns are its axes.
  const toLocal = basis.clone().transpose()

  const out = geometry.clone()
  out.translate(-centre.x, -centre.y, -centre.z)
  out.applyMatrix4(toLocal)
  out.computeBoundingBox()

  // Scale on the HAND, not the whole scan.
  //
  // Normalising total length assumed the scan includes the same proportion of
  // forearm as the procedural rig does. It doesn't - these are cropped just
  // past the wrist - so matching totals blew the hand up to roughly twice the
  // size of the head. The wrist is found instead, and only wrist-to-fingertip
  // is matched; whatever forearm comes along lands where it lands.
  const box = out.boundingBox!
  const handLength = measureHand(out, box)
  const scale = (handLength > 1e-4 ? HAND_LENGTH / handLength : TOTAL_LENGTH / (box.max.z - box.min.z || 1))
  out.scale(scale, scale, scale)

  out.computeBoundingBox()
  const seated = out.boundingBox!
  const seatedCentre = seated.getCenter(new THREE.Vector3())
  out.translate(-seatedCentre.x, -seatedCentre.y, FINGERTIP_Z - seated.min.z)
  out.computeBoundingBox()
  out.computeVertexNormals()
  return out
}

/**
 * Which scanned pose serves which move. The file's six hands cover every
 * hand-using attack exactly once, with two doing double duty as mirrored
 * pairs, so nothing has to bend and there are no skinning artefacts at all -
 * the pose is simply the one that was scanned.
 */
/**
 * Pieces that come out palm-down and need turning over.
 *
 * The covariance gives the plane the palm lies in but says nothing about which
 * side of it is palm and which is knuckles - the two are equally valid
 * eigenvector signs. Nothing in the mesh reliably distinguishes them either, so
 * this is set by eye. A wrong entry shows up immediately: the slap lands with
 * the back of the hand.
 */
const FLIP_PALM = new Set<number>([0])

const PIECE_FOR_KIND: Record<HandKind, number> = {
  fist: 1, // punch
  flat: 0, // slap, mirrored for the left
  poke: 2, // two fingers out, for the eyes
  pinch: 5, // thumb and forefinger
  grab: 4, // strangle, mirrored for the second hand
}

/* ----------------------------------------------------------------- curl */

/**
 * The finger region, in the canonical frame: knuckles here, fingertips this
 * far beyond, hinging about the palm plane.
 */
const CURL_KNUCKLE_Z = -0.45
const CURL_LENGTH = 0.92
const CURL_PIVOT_Y = 0.06

/**
 * How far each grip closes, in radians at the fingertip.
 *
 * A fist and a pointing hand are already scanned in their final shape, so they
 * stay at zero - curling them further would just fold the fingers through the
 * palm.
 */
const MAX_CURL: Record<HandKind, number> = {
  fist: 0,
  flat: 0,
  poke: 0,
  pinch: 0.6,
  grab: 1.05,
}

/**
 * Bends the fingers without a skeleton.
 *
 * Real skinning needs bones and weights, and weights need the fingers to be
 * separable - which they aren't on a scan where they touch. But a grip doesn't
 * need per-finger control: in a pinch and a strangle every finger closes at
 * once, so the whole finger region can be swept about one hinge at the
 * knuckles. The angle grows with the square of the distance along the finger,
 * which puts most of the bend out at the tips and reads as knuckles articulating
 * rather than the hand hinging in the middle.
 */
function makeCurlMaterial(base: THREE.Material): THREE.Material {
  const material = base.clone() as THREE.MeshStandardMaterial
  const uCurl = { value: 0 }
  material.userData.uCurl = uCurl

  const DECLS = /* glsl */ `
uniform float uCurl;

float gigilCurlAngle(vec3 p) {
  float t = clamp((${CURL_KNUCKLE_Z.toFixed(3)} - p.z) / ${CURL_LENGTH.toFixed(3)}, 0.0, 1.0);
  return uCurl * t * t;
}

vec3 gigilCurlAbout(vec3 v, float a, bool isPoint) {
  vec3 rel = isPoint ? v - vec3(0.0, ${CURL_PIVOT_Y.toFixed(3)}, ${CURL_KNUCKLE_Z.toFixed(3)}) : v;
  float c = cos(a);
  float s = sin(a);
  vec3 out3 = vec3(rel.x, rel.y * c - rel.z * s, rel.y * s + rel.z * c);
  return isPoint ? out3 + vec3(0.0, ${CURL_PIVOT_Y.toFixed(3)}, ${CURL_KNUCKLE_Z.toFixed(3)}) : out3;
}
`

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCurl = uCurl
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DECLS}`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        objectNormal = gigilCurlAbout(objectNormal, gigilCurlAngle(position), false);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed = gigilCurlAbout(transformed, gigilCurlAngle(position), true);`,
      )
  }
  material.customProgramCacheKey = () => 'gigil-hand-curl'
  return material
}

/**
 * Wraps a scanned piece in the same interface the procedural rig exposes.
 *
 * `setPose` drives the curl above, so grips really do close. `setContact` stays
 * a no-op - splaying fingers against skin needs them controlled individually,
 * and that does need a skeleton.
 */
export function makeModelHand(
  kind: HandKind,
  pieces: THREE.BufferGeometry[],
  opts: { mirror?: boolean; scale?: number } = {},
): Hand {
  const group = new THREE.Group() as Hand
  const geometry = pieces[PIECE_FOR_KIND[kind]] ?? pieces[0]
  const source =
    (geometry?.userData.material as THREE.Material | undefined) ??
    new THREE.MeshStandardMaterial({ color: '#e6bdae', roughness: 0.75 })
  // One material per hand, because each carries its own curl amount. They all
  // share a program, so this costs a uniform rather than a shader compile.
  const material = makeCurlMaterial(source)

  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  group.add(mesh)

  const curl = material.userData.uCurl as { value: number }
  const limit = MAX_CURL[kind]
  group.setPose = (_from, _to, t) => {
    curl.value = limit * THREE.MathUtils.clamp(t, 0, 1)
  }
  group.setContact = () => {}
  group.userData.contact = new THREE.Vector3(...CONTACT_POINT[kind])
  group.rotation.order = 'YXZ'

  const s = opts.scale ?? 1
  // A negative x scale mirrors it; three flips the winding when the world
  // matrix determinant goes negative, so the lighting stays correct.
  group.scale.set(opts.mirror ? -s : s, s, s)
  group.visible = false
  return group
}

let cached: Promise<THREE.BufferGeometry[]> | null = null

/** Loads the GLB once and returns every piece, canonicalised, in index order. */
export function loadHandPieces(): Promise<THREE.BufferGeometry[]> {
  if (cached) return cached
  // The loader is pulled in on demand rather than imported at the top. It is
  // only ever needed once something is about to be thrown, and statically
  // importing it puts the whole of glTF parsing into the first paint.
  cached = import('three/examples/jsm/loaders/GLTFLoader.js').then(
    ({ GLTFLoader }) =>
      new Promise<THREE.BufferGeometry[]>((resolve, reject) => {
        new GLTFLoader().load(
          MODEL_URL,
          (gltf) => {
            let source: THREE.BufferGeometry | null = null
            let material: THREE.Material | null = null
            gltf.scene.traverse((o) => {
              const mesh = o as THREE.Mesh
              if (mesh.isMesh && !source) {
                source = mesh.geometry
                material = mesh.material as THREE.Material
              }
            })
            if (!source) return reject(new Error('no mesh in hand.glb'))
            const pieces = splitComponents(source).map((piece, i) =>
              canonicalise(piece, FLIP_PALM.has(i)),
            )
            for (const piece of pieces) piece.userData.material = material
            resolve(pieces)
          },
          undefined,
          reject,
        )
      }),
  )
  cached.catch(() => {
    cached = null
  })
  return cached
}
