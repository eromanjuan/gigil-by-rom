import * as THREE from 'three'

/**
 * Articulated first-person hands.
 *
 * Every hand is built in the same canonical frame: the wrist sits at the
 * origin, fingers extend toward -Z, and the palm faces +Y. Curling a joint is
 * a positive rotation about its local X, which swings the fingertip toward the
 * palm - so a pose is just a table of angles, and blending two poses is a lerp.
 *
 * Attacks position and orient the whole group; nothing here knows about the
 * head or the camera.
 */

// Paler and pinker than tanned-orange. Hands held up close to a camera read
// bloodless at the knuckles and warm at the pads, not evenly bronzed.
const SKIN = new THREE.Color('#e6bdae')
const SKIN_DEEP = new THREE.Color('#cf9880')
const NAIL = new THREE.Color('#f0d6c9')
/** The colour of light that has been through flesh and come back out. */
const SUBSURFACE = new THREE.Color('#b8442f')

/**
 * How much light passes through each part, 0..1.
 *
 * This is the whole trick behind skin looking like skin rather than like
 * painted plastic: a hand is translucent, and it is translucent *unevenly*.
 * Fingertips and the webbing glow when there's a light behind them, the heel
 * of the palm and the forearm barely do at all.
 */
const THINNESS = {
  /** By phalanx: knuckle, middle, tip. */
  phalanx: [0.4, 0.68, 1],
  palm: 0.18,
  knuckleRidge: 0.24,
  heel: 0.1,
  thenar: 0.3,
  knuckle: 0.34,
  forearm: 0.05,
  nail: 0.55,
}

/** Tags a geometry with how much light passes through it. */
function setThinness(geometry: THREE.BufferGeometry, value: number) {
  const count = geometry.getAttribute('position').count
  const thin = new Float32Array(count)
  thin.fill(value)
  geometry.setAttribute('aThin', new THREE.BufferAttribute(thin, 1))
  return geometry
}

/**
 * Skin.
 *
 * Standard PBR gets the specular right and the diffuse wrong: real skin is not
 * an opaque surface, so light enters it, bounces around and leaves somewhere
 * else, and the shading stays warm where a plastic model would go flat black.
 * A full subsurface solution is far more than this needs, so it's approximated
 * with a fresnel term - light that entered elsewhere leaves most readily where
 * the surface turns away from you, which is why the rim of a finger lights up.
 */
function makeSkinMaterial(color: THREE.Color, roughness: number) {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSubsurface = { value: SUBSURFACE }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aThin;\nvarying float vThin;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vThin = aThin;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vThin;\nuniform vec3 uSubsurface;',
      )
      // Albedo first: thin flesh is pinker before any light touches it.
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 0.9, 0.89), vThin);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `
        {
          vec3 V = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 2.2);
          // The constant term is the light that comes back out everywhere; the
          // fresnel term is the rim that makes a fingertip glow.
          outgoingLight += uSubsurface * vThin * (0.09 + 0.46 * fres);
        }
        #include <opaque_fragment>`,
      )
  }
  material.customProgramCacheKey = () => 'gigil-skin'
  return material
}

export type HandKind = 'fist' | 'flat' | 'poke' | 'pinch' | 'grab'

/** Curl angles for the three joints of one digit, in radians. */
export type Digit = [number, number, number]

export type HandPose = {
  /** thumb, index, middle, ring, pinky */
  curl: [Digit, Digit, Digit, Digit, Digit]
  /** Sideways fan per digit, radians. Positive spreads toward the thumb. */
  spread: [number, number, number, number, number]
}

const pose = (curl: HandPose['curl'], spread: HandPose['spread']): HandPose => ({ curl, spread })

/**
 * The pose library. Blending between an open and closed variant is what makes
 * grabs read as grabs rather than as a hand teleporting shut.
 */
export const POSES: Record<string, HandPose> = {
  relaxed: pose(
    [
      [0.3, 0.25, 0.2],
      [0.35, 0.4, 0.3],
      [0.4, 0.45, 0.32],
      [0.42, 0.48, 0.34],
      [0.45, 0.5, 0.35],
    ],
    [0.28, 0.06, 0, -0.06, -0.13],
  ),
  fist: pose(
    [
      [0.62, 0.78, 0.45],
      [1.58, 1.82, 1.4],
      [1.62, 1.86, 1.44],
      [1.62, 1.86, 1.44],
      [1.58, 1.82, 1.4],
    ],
    [0.34, 0.04, 0, -0.04, -0.09],
  ),
  flat: pose(
    [
      [0.18, 0.1, 0.08],
      [0.05, 0.04, 0.03],
      [0.04, 0.03, 0.02],
      [0.05, 0.04, 0.03],
      [0.07, 0.06, 0.04],
    ],
    [0.62, 0.12, 0, -0.12, -0.24],
  ),
  poke: pose(
    [
      [0.9, 1.1, 0.6],
      [0.04, 0.03, 0.02],
      [0.05, 0.04, 0.03],
      [1.6, 1.85, 1.4],
      [1.6, 1.85, 1.4],
    ],
    [0.44, 0.2, -0.12, -0.05, -0.1],
  ),
  pinchOpen: pose(
    [
      [0.3, 0.16, 0.12],
      [0.34, 0.34, 0.24],
      [1.4, 1.62, 1.22],
      [1.52, 1.76, 1.32],
      [1.56, 1.8, 1.36],
    ],
    [0.2, 0.14, -0.04, -0.08, -0.14],
  ),
  pinchClosed: pose(
    [
      [0.6, 0.52, 0.34],
      [0.8, 0.88, 0.62],
      [1.42, 1.66, 1.26],
      [1.54, 1.8, 1.34],
      [1.58, 1.84, 1.38],
    ],
    [0.06, 0.2, -0.04, -0.08, -0.14],
  ),
  clawOpen: pose(
    [
      [0.5, 0.35, 0.25],
      [0.5, 0.6, 0.5],
      [0.52, 0.62, 0.52],
      [0.52, 0.62, 0.52],
      [0.5, 0.6, 0.5],
    ],
    [0.6, 0.22, 0.06, -0.12, -0.28],
  ),
  clawClosed: pose(
    [
      [0.8, 0.7, 0.5],
      [1.0, 1.15, 0.9],
      [1.02, 1.18, 0.92],
      [1.02, 1.18, 0.92],
      [1.0, 1.15, 0.9],
    ],
    [0.5, 0.16, 0.04, -0.09, -0.2],
  ),
}

type Joint = { group: THREE.Group; rest: THREE.Euler }

export type Hand = THREE.Group & {
  /** Blend between two named poses. t=0 is `from`, t=1 is `to`. */
  setPose(from: string, to: string, t: number): void
  /** Splay the fingers on contact, 0..1, layered on top of the current pose. */
  setContact(amount: number): void
}

/** One digit: three chained joints, each parenting the next. */
type Finger = {
  joints: [Joint, Joint, Joint]
  /** The base group carrying the sideways fan. */
  base: THREE.Group
  baseRest: THREE.Euler
}

// Roughly anatomical: the middle finger is longest, fingers are about as long
// as the palm, and the pinky sits lower on the hand and is shortest.
const FINGER_SPEC = [
  // The thumb lies roughly *in* the palm plane and swings out to the side, so
  // its base is a yaw. Pitching it up instead leaves it standing vertically
  // and it can never meet the forefinger.
  { x: 0.3, y: -0.02, z: -0.02, length: 0.56, radius: 0.071, yaw: -0.72, pitch: 0.12 }, // thumb
  { x: 0.245, y: 0.02, z: -0.44, length: 0.82, radius: 0.062, yaw: 0, pitch: 0 }, // index
  { x: 0.082, y: 0.03, z: -0.47, length: 0.9, radius: 0.064, yaw: 0, pitch: 0 }, // middle
  { x: -0.082, y: 0.02, z: -0.45, length: 0.83, radius: 0.06, yaw: 0, pitch: 0 }, // ring
  { x: -0.238, y: 0, z: -0.4, length: 0.66, radius: 0.053, yaw: 0, pitch: 0 }, // pinky
]

/** Fractions of finger length taken by proximal / medial / distal phalanges. */
const PHALANX = [0.42, 0.32, 0.26]

/**
 * Each phalanx capsule is drawn slightly longer than its segment so
 * consecutive bones interpenetrate at the joint. Butt them exactly together
 * and every knuckle shows a seam, which is what makes a rig read as a pile of
 * detached sausages.
 */
const PHALANX_OVERLAP = 1.2

function buildFinger(
  spec: (typeof FINGER_SPEC)[number],
  isThumb: boolean,
  materials: { skin: THREE.Material; nail: THREE.Material },
  shared: {
    geometry: Map<string, THREE.CapsuleGeometry>
    nail: Map<string, THREE.BufferGeometry>
  },
): Finger {
  const base = new THREE.Group()
  base.position.set(spec.x, spec.y, spec.z)
  base.rotation.set(spec.pitch, spec.yaw, 0)
  const baseRest = base.rotation.clone()

  let parent: THREE.Object3D = base
  const joints: Joint[] = []

  for (let i = 0; i < 3; i++) {
    const group = new THREE.Group()
    // Each joint hinges at the end of the previous phalanx.
    if (i > 0) group.position.z = -spec.length * PHALANX[i - 1]
    parent.add(group)

    const len = spec.length * PHALANX[i]
    const drawn = len * PHALANX_OVERLAP
    const radius = spec.radius * (1 - i * 0.13)
    // The phalanx index is part of the key because the thinness baked into the
    // geometry depends on it - sharing a capsule between a knuckle and a
    // fingertip would light one of them wrongly.
    const key = `${i}:${radius.toFixed(4)}:${drawn.toFixed(4)}`
    let geometry = shared.geometry.get(key)
    if (!geometry) {
      // Capsules are built along +Y; the mesh below rotates them onto -Z.
      geometry = new THREE.CapsuleGeometry(radius, Math.max(0.001, drawn - radius * 2), 6, 14)
      setThinness(geometry, THINNESS.phalanx[i])
      shared.geometry.set(key, geometry)
    }
    const mesh = new THREE.Mesh(geometry, materials.skin)
    mesh.rotation.x = Math.PI / 2
    mesh.position.z = -len / 2
    group.add(mesh)

    // The thumb gets one too. It was the only digit without, and a thumbnail
    // is right in frame on every pinch.
    if (i === 2) {
      const nailGeometry = shared.nail.get(key) ?? setThinness(geometry.clone(), THINNESS.nail)
      shared.nail.set(key, nailGeometry)
      const nail = new THREE.Mesh(nailGeometry, materials.nail)
      nail.rotation.x = Math.PI / 2
      nail.position.set(0, radius * 0.5, -len * (isThumb ? 0.44 : 0.5))
      nail.scale.set(0.58, 0.3, isThumb ? 0.36 : 0.42)
      group.add(nail)
    }

    joints.push({ group, rest: group.rotation.clone() })
    parent = group
  }

  return { joints: joints as [Joint, Joint, Joint], base, baseRest }
}

function buildPalm(
  kind: HandKind,
  materials: { skin: THREE.Material; deep: THREE.Material },
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = []
  const ball = (r: number, thin: number) => setThinness(new THREE.SphereGeometry(r, 20, 14), thin)

  // Overlapping rounded masses rather than one box. A slab reads as a plank
  // no matter how the fingers move, and a single sphere domes out and
  // swallows them; three flattened lumps give a palm with an actual edge.
  const palm = new THREE.Mesh(ball(0.44, THINNESS.palm), materials.skin)
  palm.scale.set(1, 0.3, 1.02)
  palm.position.set(0.01, 0, -0.08)
  parts.push(palm)

  const knuckleRidge = new THREE.Mesh(ball(0.42, THINNESS.knuckleRidge), materials.skin)
  knuckleRidge.scale.set(1, 0.29, 0.34)
  knuckleRidge.position.set(0.01, 0.01, -0.42)
  parts.push(knuckleRidge)

  const heel = new THREE.Mesh(ball(0.36, THINNESS.heel), materials.skin)
  heel.scale.set(1.05, 0.33, 0.7)
  heel.position.set(0, -0.01, 0.28)
  parts.push(heel)

  // Thenar pad at the base of the thumb - the bulge that makes a hand a hand.
  const thenar = new THREE.Mesh(ball(0.2, THINNESS.thenar), materials.skin)
  thenar.scale.set(0.85, 0.7, 1.5)
  thenar.position.set(0.29, -0.01, 0.02)
  parts.push(thenar)

  // Knuckle row, proud only when the hand is closed.
  if (kind === 'fist' || kind === 'poke') {
    for (let i = 0; i < 4; i++) {
      const knuckle = new THREE.Mesh(ball(0.082, THINNESS.knuckle), materials.deep)
      knuckle.scale.set(1, 0.82, 0.85)
      knuckle.position.set(FINGER_SPEC[i + 1].x, 0.06, FINGER_SPEC[i + 1].z + 0.02)
      parts.push(knuckle)
    }
  }

  // Deliberately slim and short: most of the arm is off-camera during a
  // strike, and a thick one crowds the frame and dwarfs the head.
  const forearm = new THREE.Mesh(
    setThinness(new THREE.CapsuleGeometry(0.2, 0.8, 6, 18), THINNESS.forearm),
    materials.skin,
  )
  forearm.scale.set(1.05, 1, 0.82)
  forearm.rotation.x = Math.PI / 2
  forearm.position.set(0, -0.01, 0.86)
  parts.push(forearm)

  return parts
}

const POSE_FOR_KIND: Record<HandKind, [string, string]> = {
  fist: ['relaxed', 'fist'],
  flat: ['flat', 'flat'],
  poke: ['relaxed', 'poke'],
  pinch: ['pinchOpen', 'pinchClosed'],
  grab: ['clawOpen', 'clawClosed'],
}

/**
 * The point on each hand that actually touches the target, in hand-local
 * space. Attacks aim by this rather than by the wrist, so repose or reproportion
 * a hand and the aim follows automatically instead of silently drifting.
 */
export const CONTACT_POINT: Record<HandKind, [number, number, number]> = {
  fist: [0.08, 0.05, -0.56], // front of the knuckle row
  flat: [0.02, 0.14, -0.25], // palm face
  poke: [0.16, 0.03, -1.32], // index and middle fingertips
  pinch: [0.28, 0.04, -0.72], // between thumb and forefinger tips
  grab: [0.05, 0.2, -0.5], // inner palm and finger pads
}

/** The default pose pair for a hand kind, so attacks don't have to name them. */
export function posesFor(kind: HandKind): [string, string] {
  return POSE_FOR_KIND[kind]
}

/**
 * A negative x scale mirrors the hand; three flips the winding order for us
 * when the world matrix determinant goes negative, so lighting stays correct.
 */
export function makeHand(kind: HandKind, opts: { mirror?: boolean; scale?: number } = {}): Hand {
  const group = new THREE.Group() as Hand
  // Skin is matte close up - the sheen people picture is oil and sweat sitting
  // on top of it, not the skin itself.
  const skin = makeSkinMaterial(SKIN, 0.78)
  const deep = makeSkinMaterial(SKIN_DEEP, 0.8)
  const nail = makeSkinMaterial(NAIL, 0.34)
  const shared = {
    geometry: new Map<string, THREE.CapsuleGeometry>(),
    nail: new Map<string, THREE.BufferGeometry>(),
  }

  for (const part of buildPalm(kind, { skin, deep })) group.add(part)

  const fingers = FINGER_SPEC.map((spec, i) =>
    buildFinger(spec, i === 0, { skin, nail }, shared),
  )
  for (const finger of fingers) group.add(finger.base)

  let contact = 0
  let current: HandPose = POSES.relaxed

  const apply = () => {
    for (let f = 0; f < 5; f++) {
      const finger = fingers[f]
      // Contact splays the fingers outward and resists the last bit of curl,
      // which is what makes a hand look like it's pressing on something solid.
      const relief = 1 - contact * 0.35
      for (let j = 0; j < 3; j++) {
        finger.joints[j].group.rotation.x = finger.joints[j].rest.x + current.curl[f][j] * relief
      }
      finger.base.rotation.y = finger.baseRest.y + current.spread[f] * (1 + contact * 0.5)
    }
  }

  group.setPose = (from: string, to: string, t: number) => {
    const a = POSES[from] ?? POSES.relaxed
    const b = POSES[to] ?? a
    const k = THREE.MathUtils.clamp(t, 0, 1)
    for (let f = 0; f < 5; f++) {
      for (let j = 0; j < 3; j++) {
        current.curl[f][j] = THREE.MathUtils.lerp(a.curl[f][j], b.curl[f][j], k)
      }
      current.spread[f] = THREE.MathUtils.lerp(a.spread[f], b.spread[f], k)
    }
    apply()
  }

  group.setContact = (amount: number) => {
    contact = THREE.MathUtils.clamp(amount, 0, 1)
    apply()
  }

  // Give the blend target its own storage so lerping never mutates the library.
  current = {
    curl: POSES.relaxed.curl.map((d) => [...d] as Digit) as HandPose['curl'],
    spread: [...POSES.relaxed.spread] as HandPose['spread'],
  }
  group.setPose(...POSE_FOR_KIND[kind], 0)
  group.userData.contact = new THREE.Vector3(...CONTACT_POINT[kind])
  // Keyframes are authored as yaw-then-pitch, which is how you describe
  // swinging an arm; XYZ order would make every rotation cross-talk.
  group.rotation.order = 'YXZ'

  const s = opts.scale ?? 1
  group.scale.set(opts.mirror ? -s : s, s, s)
  group.visible = false
  group.traverse((o) => {
    o.castShadow = true
  })
  return group
}
