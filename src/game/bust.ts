import * as THREE from 'three'
import type { FaceRig } from './faceBuilder'
import { applyDeform, ensureFlex, type DeformField } from './deform'
import { BruiseLayer } from './bruises'
import { buildHair, makeHairMaterial, type HairUniforms } from './hair'
import { hairStyle, outfit, type Look, type Outfit } from './look'

export type Bust = {
  root: THREE.Group
  /** Shoulders and collar, with the whole head parented under them. */
  torso: THREE.Group
  /** Rotate/translate this to swing the head on the neck. */
  neckPivot: THREE.Group
  /** Scale this to squash the head about its own centre. */
  head: THREE.Group
  face: THREE.Mesh
  bruises: BruiseLayer
  /** Fed from the key light so the anisotropic hair sheen tracks it. */
  hairUniforms: HairUniforms
  /** Updates every material colour without touching geometry. */
  recolour: (look: Look) => void
  /** Where the neck can be grabbed, in head-local space. */
  throat: THREE.Vector3
  metrics: { halfWidth: number; topY: number; bottomY: number; frontZ: number; silhouetteZ: number }
  dispose: () => void
}

const CAP_RINGS = 16

function skinMaterial(tone: THREE.Color) {
  return new THREE.MeshStandardMaterial({ color: tone, roughness: 0.78, metalness: 0 })
}

/**
 * The cranium, built by sweeping the face's own silhouette ring backwards,
 * upwards and inwards to a pole.
 *
 * An ellipsoid can't do this job: to close the silhouette it has to be as wide
 * as the face, and anything that wide pushes through the cheeks and forehead,
 * leaving just the nose and lips poking out of a bald ball. Growing the cap
 * from the boundary makes the seam exact by construction.
 */
function buildCranium(ring: THREE.Vector3[], depth: number, crown: number) {
  const n = ring.length
  const centre = ring.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(n)

  const positions: number[] = []
  const normalsSeed: THREE.Vector3[] = []
  const offset = new THREE.Vector3()

  for (let k = 0; k < CAP_RINGS; k++) {
    const t = k / CAP_RINGS
    const a = (t * Math.PI) / 2
    // Fuller than a circle, bulging slightly past the face at the temples.
    const radial = Math.pow(Math.cos(a), 0.5) * (1 + 0.14 * Math.sin(t * Math.PI))
    // Lifting the whole ring rather than just its top keeps every ring planar -
    // lifting per-vertex pinches the crown into a cone - and it matches the
    // anatomy anyway, since the back of a skull sits well above the jaw.
    offset.set(0, crown * Math.sin(a) * 0.85, -depth * Math.sin(a))
    for (const p of ring) {
      const v = new THREE.Vector3().subVectors(p, centre).multiplyScalar(radial).add(centre).add(offset)
      positions.push(v.x, v.y, v.z)
      normalsSeed.push(v)
    }
  }
  const poleIndex = CAP_RINGS * n
  const pole = new THREE.Vector3(centre.x, centre.y + crown * 0.85, centre.z - depth)
  positions.push(pole.x, pole.y, pole.z)
  normalsSeed.push(pole)

  const index: number[] = []
  for (let k = 0; k < CAP_RINGS - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = k * n + i
      const b = k * n + ((i + 1) % n)
      const c = (k + 1) * n + i
      const d = (k + 1) * n + ((i + 1) % n)
      index.push(a, c, b, b, c, d)
    }
  }
  const last = (CAP_RINGS - 1) * n
  for (let i = 0; i < n; i++) index.push(last + i, poleIndex, last + ((i + 1) % n))

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return { geometry, centre, positions, ringCount: CAP_RINGS, ringSize: n }
}

/**
 * An ear as a flattened shell plus a helix rim and a lobe.
 *
 * An extruded outline gives a better silhouette on paper, but the bevelled
 * solid self-intersects around the tight curves of an ear profile and the
 * overlapping faces z-fight into black banding. Merged primitives are duller
 * geometry that actually renders.
 */
function buildEar(height: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []

  const shell = new THREE.SphereGeometry(0.5, 20, 14)
  shell.scale(0.34, 1, 0.62)
  parts.push(shell)

  // Helix: the rolled rim around the top and back edge.
  const helix = new THREE.TorusGeometry(0.4, 0.1, 10, 22, Math.PI * 1.35)
  helix.rotateY(Math.PI / 2)
  helix.rotateX(-Math.PI / 2)
  helix.scale(0.44, 1, 0.86)
  helix.translate(0, 0.03, -0.02)
  parts.push(helix)

  const lobe = new THREE.SphereGeometry(0.17, 12, 10)
  lobe.scale(0.42, 1, 0.8)
  lobe.translate(0, -0.42, 0.04)
  parts.push(lobe)

  const geometry = mergeGeometries(parts)
  geometry.scale(height, height, height)
  geometry.computeVertexNormals()
  return geometry
}

/** Minimal position-only merge; three's BufferGeometryUtils is overkill here. */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const index: number[] = []
  let offset = 0
  for (const g of list) {
    const pos = g.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    }
    const idx = g.getIndex()
    if (idx) {
      for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + offset)
    } else {
      for (let i = 0; i < pos.count; i++) index.push(i + offset)
    }
    offset += pos.count
    g.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setIndex(index)
  return merged
}

/**
 * Neck through trapezius to shoulder, lofted as one surface. A cylinder
 * jammed into a sphere leaves a crease exactly where the eye expects a slope.
 */
function buildShoulders(
  neckRadius: number,
  neckTopY: number,
  dropY: number,
  halfWidth: number,
  z: number,
) {
  const ROWS = 14
  const COLS = 28
  const positions: number[] = []
  const index: number[] = []

  for (let r = 0; r < ROWS; r++) {
    const t = r / (ROWS - 1)
    const y = THREE.MathUtils.lerp(neckTopY, dropY, t)
    // The flare has to finish early: at this framing only the top ~0.4 of a
    // head-height below the chin is on screen, so a gradual spread over the
    // whole loft puts the shoulders entirely below the viewport.
    const flare = Math.pow(THREE.MathUtils.clamp(t / 0.26, 0, 1), 1.25)
    const rx = THREE.MathUtils.lerp(neckRadius, halfWidth * 2.1, flare)
    const rz = THREE.MathUtils.lerp(neckRadius, halfWidth * 1.1, flare)
    for (let c = 0; c < COLS; c++) {
      const a = (c / COLS) * Math.PI * 2
      positions.push(Math.cos(a) * rx, y - Math.pow(flare, 1.6) * halfWidth * 0.34 * Math.abs(Math.cos(a)), z + Math.sin(a) * rz)
    }
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = r * COLS + c
      const b = r * COLS + ((c + 1) % COLS)
      const d = (r + 1) * COLS + c
      const e = (r + 1) * COLS + ((c + 1) % COLS)
      index.push(a, d, b, b, d, e)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Cuts the neckline and shoulders out of a garment with per-vertex alpha.
 *
 * Four components in the `color` attribute rather than three: three tells the
 * renderer to tint, four tells it to tint *and* carry alpha, which is what
 * lets one loft serve as a crew neck, a scoop and a vest without generating
 * different geometry for each.
 */
function applyCoverage(
  geometry: THREE.BufferGeometry,
  fit: Outfit,
  shoulderTopY: number,
  halfWidth: number,
  faceSpan: number,
) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const colours = new Float32Array(position.count * 4)
  const neckBottom = shoulderTopY - fit.neck * faceSpan

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)

    // The neckline: an opening around the throat, as wide as the style says
    // and as deep as it says, with a soft edge so it doesn't read as cut paper.
    const lateral = Math.abs(x) / Math.max(1e-5, halfWidth * fit.neckWidth)
    const inside = 1 - THREE.MathUtils.smoothstep(lateral, 0.82, 1.06)
    const above = THREE.MathUtils.smoothstep(y, neckBottom - faceSpan * 0.03, neckBottom + faceSpan * 0.02)
    let bare = inside * above

    // Shoulders: bare toward the outside and the top, by however much the
    // style leaves uncovered.
    if (fit.shoulders < 0.999) {
      const out = THREE.MathUtils.clamp(
        (Math.abs(x) - halfWidth * 0.5) / (halfWidth * 0.95),
        0,
        1,
      )
      const high = 1 - THREE.MathUtils.smoothstep(shoulderTopY - y, 0, faceSpan * 0.38)
      bare = Math.max(bare, (1 - fit.shoulders) * out * high)
    }

    const alpha = THREE.MathUtils.clamp(1 - bare, 0, 1)
    colours[i * 4] = 1
    colours[i * 4 + 1] = 1
    colours[i * 4 + 2] = 1
    colours[i * 4 + 3] = alpha
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4))
}

export function buildBust(rig: FaceRig, field: DeformField, look?: Look): Bust {
  const disposables: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x)
    return x
  }

  // A look overrides what the photo guessed. Without one - the plain photo
  // path - the sampled tones and a mid-length cut stand in, so behaviour is
  // unchanged for anyone who just uploads a picture.
  const style = hairStyle(look?.hair ?? 'shortSide')
  const fit = outfit(look?.outfit ?? 'tshirt')
  const hairColour = look ? new THREE.Color(look.hairColor) : rig.hairTone
  const clothingTone = look ? new THREE.Color(look.outfitColor) : rig.clothingTone
  // A photo owns its own skin: the face is the photograph, so a picked tone
  // would leave the neck and ears not matching the cheeks.
  const skinColour =
    look && rig.synthetic ? new THREE.Color(look.skinColor) : rig.skinTone
  // A chosen style wins over whatever was segmented out of the photo. Letting
  // the mask carve the hairline as well would fight the preset - you'd pick a
  // fringe and get the subject's own hairline back.
  const hairMap = look ? null : rig.hairMap

  const topY = rig.points.foreheadTop.y
  const bottomY = rig.points.chin.y
  const faceSpan = topY - bottomY
  const halfWidth = Math.abs(rig.points.faceEdgeR.x - rig.points.faceEdgeL.x) / 2
  const silhouetteZ = rig.silhouette.reduce((a, p) => a + p.z, 0) / rig.silhouette.length
  const frontZ = rig.points.noseTip.z
  const capDepth = halfWidth * 2.1
  const crown = faceSpan * 0.5
  const earY = rig.points.noseBridge.y - faceSpan * 0.06
  const backZ = silhouetteZ - capDepth * 0.45

  const bruises = track(new BruiseLayer())

  // --- Face ---------------------------------------------------------------
  const faceMaterial = track(
    new THREE.MeshStandardMaterial({
      map: rig.texture,
      roughness: 0.72,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  )
  applyDeform(faceMaterial, field, { bruiseMap: bruises.texture, skinTone: skinColour })
  const face = new THREE.Mesh(rig.geometry, faceMaterial)
  face.castShadow = true
  face.renderOrder = 1

  // --- Cranium ------------------------------------------------------------
  const skinMat = track(skinMaterial(skinColour))
  applyDeform(skinMat, field)

  const cranium = buildCranium(rig.silhouette, capDepth, crown)
  // Paint the scalp under the hair line toward hair tone. The shell above is
  // what you actually see, but if it ever gaps at a silhouette this shows
  // dark scalp rather than a bald patch.
  const capColors: number[] = []
  const scalp = new THREE.Color()
  for (let i = 0; i < cranium.positions.length; i += 3) {
    const y = cranium.positions[i + 1]
    const z = cranium.positions[i + 2]
    const above = THREE.MathUtils.smoothstep(y, topY - faceSpan * 0.14, topY + faceSpan * 0.02)
    const behind = THREE.MathUtils.smoothstep(cranium.centre.z - z, 0, faceSpan * 0.34)
    scalp
      .copy(skinColour)
      .lerp(rig.hairTone, THREE.MathUtils.clamp(Math.max(above, behind * 0.96), 0, 1) * 0.9)
    capColors.push(scalp.r, scalp.g, scalp.b)
  }
  cranium.geometry.setAttribute('color', new THREE.Float32BufferAttribute(capColors, 3))

  const capMat = track(skinMaterial(new THREE.Color(0xffffff)))
  capMat.vertexColors = true
  applyDeform(capMat, field)

  const cap = new THREE.Mesh(ensureFlex(track(cranium.geometry), 0.18), capMat)
  cap.castShadow = true

  // --- Hair ---------------------------------------------------------------
  const { material: hairMat, uniforms: hairUniforms } = makeHairMaterial(hairColour, field)
  track(hairMat)
  // Bald builds no geometry at all rather than a zero-thickness shell, which
  // would still z-fight with the scalp it's sitting on.
  const hair =
    style.volume > 0.001
      ? new THREE.Mesh(
          track(
            buildHair(cranium, {
              hairlineY: topY,
              earY,
              faceSpan,
              // A chosen style is at full strength; only the photo path scales
              // volume by how confident the detection was.
              amount: look ? 1 : rig.hairAmount,
              map: hairMap,
              tone: hairColour,
              style,
            }),
          ),
          hairMat,
        )
      : null
  if (hair) {
    hair.castShadow = true
    hair.renderOrder = 2
  }

  // --- Ears ---------------------------------------------------------------
  const ears: THREE.Mesh[] = []
  const widest = Math.max(...rig.silhouette.map((p) => Math.abs(p.x)))
  const earGeometry = ensureFlex(track(buildEar(faceSpan * 0.26)), 0.55)
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeometry, skinMat)
    // Just proud of the skull. Any further in and the hair shell, which is
    // offset outward from the same surface, swallows them entirely.
    ear.position.set(side * widest * 0.99, earY, silhouetteZ - capDepth * 0.26)
    // Tipped back at the top, the way a real ear sits rather than standing off
    // square to the skull.
    ear.rotation.set(0.12, 0, side * 0.16)
    ear.scale.set(side, 1, 1)
    ear.castShadow = true
    ears.push(ear)
  }

  // --- Neck ---------------------------------------------------------------
  // Parented to the head so the throat stays grabbable as the head swings.
  const neckRadius = halfWidth * 0.5
  const neckTopY = bottomY + faceSpan * 0.18
  const neckLength = faceSpan * 0.72
  const neck = new THREE.Mesh(
    ensureFlex(track(new THREE.CylinderGeometry(neckRadius * 0.92, neckRadius * 1.12, neckLength, 24, 6)), 0.75),
    skinMat,
  )
  neck.position.set(0, neckTopY - neckLength / 2, backZ)
  neck.castShadow = true
  // Up near the jaw, not down at the collar - that's where a throttle lands.
  const throat = new THREE.Vector3(0, neckTopY - neckLength * 0.32, neck.position.z + neckRadius * 0.75)

  const head = new THREE.Group()
  head.add(face, cap, neck, ...ears)
  if (hair) head.add(hair)

  const neckPivot = new THREE.Group()
  neckPivot.add(head)

  // --- Body ---------------------------------------------------------------
  const torso = new THREE.Group()
  const shirtMat = track(
    new THREE.MeshStandardMaterial({
      color: clothingTone,
      roughness: 0.92,
      metalness: 0,
      // The coverage attribute carries four components, so three multiplies the
      // alpha through as well as the tint. alphaTest rather than blending keeps
      // depth writes on, so the garment sorts against the body beneath it.
      vertexColors: true,
      transparent: true,
      alphaTest: 0.5,
      // The loft is swept downward, which reverses its winding relative to the
      // cranium sweep. Two-sided is cheaper than another orientation puzzle,
      // and the shell is closed so the inside is never seen anyway.
      side: THREE.DoubleSide,
    }),
  )
  const shoulderTopY = bottomY - faceSpan * 0.28

  const dropY = bottomY - faceSpan * 1.9

  // The body underneath is skin, and the garment is a second shell over it
  // with the neckline and shoulders cut out by vertex alpha. Painting the
  // clothing straight onto the body would make a vest impossible: there'd be
  // nothing behind the bare shoulder to see.
  const body = new THREE.Mesh(
    track(buildShoulders(neckRadius * 1.25, shoulderTopY, dropY, halfWidth, backZ)),
    skinMat,
  )
  body.castShadow = true
  body.receiveShadow = true

  const garmentGeometry = track(
    buildShoulders(neckRadius * 1.32, shoulderTopY + faceSpan * 0.008, dropY, halfWidth * 1.035, backZ),
  )
  applyCoverage(garmentGeometry, fit, shoulderTopY, halfWidth, faceSpan)
  const shoulders = new THREE.Mesh(garmentGeometry, shirtMat)
  shoulders.castShadow = true
  shoulders.receiveShadow = true

  const collar =
    fit.collar === 'none'
      ? null
      : new THREE.Mesh(
          track(new THREE.TorusGeometry(neckRadius * 1.16, neckRadius * 0.2, 12, 28)),
          track(
            new THREE.MeshStandardMaterial({
              color: clothingTone.clone().multiplyScalar(0.72),
              roughness: 0.95,
              metalness: 0,
            }),
          ),
        )
  if (collar) {
    collar.rotation.x = Math.PI / 2
    // A shirt collar stands wider and flatter than a knitted polo band.
    collar.scale.set(fit.collar === 'shirt' ? 1.16 : 1, 1, fit.collar === 'shirt' ? 0.62 : 0.72)
    collar.position.set(0, shoulderTopY + faceSpan * (fit.collar === 'shirt' ? 0.035 : 0.02), backZ)
  }

  // The head hangs off the body rather than sitting beside it. As siblings the
  // neck pulled away from a collar that never moved; parented, the joint holds
  // no matter what either spring does.
  //
  // The body has to rotate about the waist, and a group rotates about its own
  // origin - which for the torso would otherwise sit up inside the skull, so a
  // lean would swing the shoulders about a point in the head and read as
  // nothing at all. So the pivot is placed down at the base of the loft and an
  // inner group shifts the geometry back up into place.
  const waistY = bottomY - faceSpan * 1.9
  const torsoInner = new THREE.Group()
  torsoInner.position.set(0, -waistY, 0)
  torsoInner.add(body, shoulders, neckPivot)
  if (collar) torsoInner.add(collar)
  torso.position.set(0, waistY, 0)
  torso.add(torsoInner)
  // applyTo adds the body spring's travel to this rather than overwriting it,
  // so the pivot offset survives.
  torso.userData.rest = torso.position.clone()

  const root = new THREE.Group()
  root.add(torso)

  return {
    root,
    torso,
    neckPivot,
    head,
    /**
     * Recolours in place.
     *
     * The customiser fires on every click of a swatch, and regenerating a head
     * of hair to change its colour is pure waste - the geometry is identical.
     * Only a change of style or garment needs a rebuild.
     */
    recolour: (next: Look) => {
      hairMat.color.set(next.hairColor)
      shirtMat.color.set(next.outfitColor)
      const skin = new THREE.Color(next.skinColor)
      skinMat.color.set(skin)
      faceMaterial.color.set(skin)
    },
    face,
    bruises,
    hairUniforms,
    throat,
    metrics: { halfWidth, topY, bottomY, frontZ, silhouetteZ },
    dispose: () => {
      for (const d of disposables) d.dispose()
      rig.geometry.dispose()
      rig.texture.dispose()
    },
  }
}
