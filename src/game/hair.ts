import * as THREE from 'three'
import { applyDeform, ensureFlex, type DeformField } from './deform'
import type { HairMap } from './faceBuilder'
import type { HairStyle } from './look'

/**
 * Hair.
 *
 * A single offset shell reads as a painted swim cap no matter how good the
 * hairline is, because three things are missing: bulk that varies across the
 * head, strand direction, and a broken silhouette. This builds all three.
 *
 *  - The surface is grown off the cranium with a lobed thickness profile, so
 *    it has real volume that swells over the crown and back.
 *  - Every vertex carries a flow tangent pointing away from the crown, which
 *    drives an anisotropic (Kajiya-Kay) sheen and procedural strand streaks.
 *    The sheen is what actually makes it read as hair rather than clay.
 *  - Tapered wisp tubes grow out of the surface and past its edge, so the
 *    outline is ragged instead of a clean dome.
 */

export type CraniumData = {
  positions: number[]
  centre: THREE.Vector3
  ringCount: number
  ringSize: number
}

export type HairParams = {
  hairlineY: number
  earY: number
  faceSpan: number
  /** 0..1 from the photo probe; scales volume and wisp count. */
  amount: number
  /** Segmented from the photo. Null falls the whole thing back to the geometric rule. */
  map: HairMap | null
  /** Used where the photo can't see - the back of the head, and as a base tint. */
  tone: THREE.Color
  /** The chosen style. Drives bulk, length, hairline and side coverage. */
  style: HairStyle
}

/* ------------------------------------------------------------------ noise */

const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453
  return s - Math.floor(s)
}

const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/** Smooth 2D value noise. */
function noise2(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = smooth(x - xi)
  const yf = smooth(y - yi)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, xf),
    THREE.MathUtils.lerp(c, d, xf),
    yf,
  )
}

function fbm(x: number, y: number, octaves = 4) {
  let total = 0
  let amp = 1
  let norm = 0
  let freq = 1
  for (let o = 0; o < octaves; o++) {
    total += noise2(x * freq, y * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return total / norm
}

/* ------------------------------------------------------------- geometry */

type Builder = {
  position: number[]
  flow: number[]
  alpha: number[]
  strand: number[]
  /** 0 on the shell, ramping to 1 at a wisp tip. Drives the free-strand lift. */
  root: number[]
  /** Per-vertex hair colour, sampled from the photo where it can be seen. */
  color: number[]
  index: number[]
  count: number
}

const newBuilder = (): Builder => ({
  position: [],
  flow: [],
  alpha: [],
  strand: [],
  root: [],
  color: [],
  index: [],
  count: 0,
})

function push(
  b: Builder,
  p: THREE.Vector3,
  flow: THREE.Vector3,
  alpha: number,
  strand: number,
  colour: THREE.Color,
  root = 0,
) {
  b.position.push(p.x, p.y, p.z)
  b.flow.push(flow.x, flow.y, flow.z)
  b.alpha.push(alpha)
  b.strand.push(strand)
  b.root.push(root)
  b.color.push(colour.r, colour.g, colour.b)
  return b.count++
}

const _d = new THREE.Vector3()
const _flow = new THREE.Vector3()
const _tmp = new THREE.Vector3()

/**
 * Builds the hair surface and its wisps as one geometry.
 *
 * Columns are emitted with a duplicated seam (ringSize + 1) rather than
 * wrapping with a modulo, so the strand coordinate can run 0..1 without a
 * discontinuity where the streaks would otherwise smear.
 */
export function buildHair(cranium: CraniumData, params: HairParams): THREE.BufferGeometry {
  const { positions, centre, ringCount, ringSize } = cranium
  const { hairlineY, earY, faceSpan, amount, map, tone, style } = params
  // The cranium carries only as many columns as the face oval has landmarks -
  // 36 - which is a visibly faceted silhouette once hair is grown on it. Every
  // column is resampled through a Catmull-Rom spline so the outline is a curve
  // instead of a polygon, which is most of the difference between this reading
  // as a model and reading as low-poly.
  const SUB = 3
  const cols = ringSize * SUB + 1
  const b = newBuilder()

  const read = (k: number, i: number, out: THREE.Vector3) => {
    const wrapped = ((i % ringSize) + ringSize) % ringSize
    const idx = (k * ringSize + wrapped) * 3
    return out.set(positions[idx], positions[idx + 1], positions[idx + 2])
  }

  const spline = (a: number, p: number, c: number, d: number, t: number) =>
    0.5 *
    (2 * p + (-a + c) * t + (2 * a - 5 * p + 4 * c - d) * t * t + (-a + 3 * p - 3 * c + d) * t * t * t)

  const _s0 = new THREE.Vector3()
  const _s1 = new THREE.Vector3()
  const _s2 = new THREE.Vector3()
  const _s3 = new THREE.Vector3()

  /** Ring sample at a fractional column, interpolated around the loop. */
  const readSmooth = (k: number, s: number, out: THREE.Vector3) => {
    const i = Math.floor(s)
    const t = s - i
    read(k, i - 1, _s0)
    read(k, i, _s1)
    read(k, i + 1, _s2)
    read(k, i + 2, _s3)
    return out.set(
      spline(_s0.x, _s1.x, _s2.x, _s3.x, t),
      spline(_s0.y, _s1.y, _s2.y, _s3.y, t),
      spline(_s0.z, _s1.z, _s2.z, _s3.z, t),
    )
  }

  // The crown: highest point on the skull, where the whorl sits and all the
  // flow radiates from.
  const crown = new THREE.Vector3()
  {
    const p = new THREE.Vector3()
    let best = -Infinity
    for (let k = 0; k < ringCount; k++) {
      for (let i = 0; i < ringSize; i++) {
        read(k, i, p)
        if (p.y > best) {
          best = p.y
          crown.copy(p)
        }
      }
    }
  }

  // `amount` is the photo's confidence that there is hair at all; `volume` is
  // the chosen style's bulk. They multiply: a buzz cut on a clear photo should
  // still be a buzz cut.
  const thickness = faceSpan * 0.1 * (0.35 + 0.65 * amount) * (style.volume * 1.5)

  /** Surface tangent pointing away from the crown - the strand direction. */
  const flowAt = (p: THREE.Vector3, normal: THREE.Vector3, out: THREE.Vector3) => {
    out.subVectors(p, crown)
    if (out.lengthSq() < 1e-8) out.set(0, -1, 0.2)
    // Project onto the tangent plane so the flow lies along the surface.
    out.addScaledVector(normal, -out.dot(normal)).normalize()
    if (!Number.isFinite(out.x) || out.lengthSq() < 0.5) out.set(0, -1, 0)
    return out
  }

  /**
   * The fallback rule: a jittered horizontal cut. Every head gets the same
   * haircut out of this, which is exactly why the photo is preferred wherever
   * it has an opinion - but the camera never saw the back of the head, so this
   * still has to cover for it.
   */
  const geoAlphaAt = (p: THREE.Vector3, i: number, drop = 0) => {
    const jitter = (fbm(i * 0.35, 0.5, 4) - 0.5) * faceSpan * 0.13
    // Sits a little below the landmark hairline: the surface is offset
    // outward, which lifts its lower edge, and without this compensation a
    // band of bare scalp shows between the brow and the hair.
    // A positive `hairline` drops the cut down the forehead; negative recedes it.
    const cut = hairlineY + jitter - faceSpan * 0.05 - drop - style.hairline * faceSpan
    const above = THREE.MathUtils.smoothstep(p.y, cut - faceSpan * 0.09, cut + faceSpan * 0.03)
    const behind = THREE.MathUtils.smoothstep(centre.z - p.z, 0, faceSpan * 0.3)
    const overEar = THREE.MathUtils.smoothstep(p.y, earY + faceSpan * 0.02, earY + faceSpan * 0.18)
    let a = THREE.MathUtils.clamp(Math.max(above, behind * overEar), 0, 1)

    // An undercut is shaved at the sides and full on top, so the coverage has
    // to fall off with how far out from the centre line a point sits, not with
    // height alone.
    if (style.sides < 0.999) {
      const lateral = THREE.MathUtils.clamp(Math.abs(p.x) / (faceSpan * 0.34), 0, 1)
      const low = 1 - THREE.MathUtils.smoothstep(p.y, earY + faceSpan * 0.12, earY + faceSpan * 0.44)
      a *= 1 - (1 - style.sides) * lateral * low
    }
    return a
  }

  const _uv = { u: 0, v: 0 }
  const _probe = new THREE.Vector3()
  const _photo = new THREE.Color()
  const inPhoto = (uv: { u: number; v: number }) =>
    uv.u >= 0 && uv.u <= 1 && uv.v >= 0 && uv.v <= 1

  /**
   * How far to trust the photo at a point.
   *
   * The camera saw the front and the sides of the head and nothing whatsoever
   * of the back, so the mask has to hand back to the geometric rule somewhere.
   * Doing that smoothly matters: a hard switchover draws a ring right around
   * the head where the two disagree.
   */
  const trustAt = (p: THREE.Vector3) =>
    map ? THREE.MathUtils.smoothstep(p.z, centre.z - faceSpan * 0.62, centre.z - faceSpan * 0.12) : 0

  const alphaAt = (p: THREE.Vector3, i: number) => {
    const geo = geoAlphaAt(p, i)
    const trust = trustAt(p)
    if (!map || trust <= 0.001) return geo
    map.project(p.x, p.y, _uv)
    // Falling off the edge of the photo is not evidence that there is no hair,
    // so it must not be allowed to erase what the geometric rule believes.
    if (!inPhoto(_uv)) return geo
    // The photo carves the real hairline out of the envelope the skull allows;
    // it never gets to paste hair on top of a face. This is the one thing a 2D
    // mask cannot be trusted with: it has no depth, and the front of the skull
    // projects onto exactly the same pixels as the hair beside the head, so
    // reading it directly wraps a band of fringe straight across the forehead.
    // Taking the minimum means the photo can only ever take hair away.
    const envelope = geoAlphaAt(p, i, faceSpan * 0.2)
    return THREE.MathUtils.lerp(geo, Math.min(envelope, map.at(_uv.u, _uv.v)), trust)
  }

  /**
   * How far the hair actually stands off the skull here, measured off the
   * photo, in head-local units.
   *
   * Steps outward from the cranium point in head space and projects each step,
   * rather than marching in UV - u and v are normalised by image width and
   * height separately, so a step of equal length in UV is not a step of equal
   * length in the world unless the photo happens to be square.
   *
   * Returns -1 when the photo can't answer.
   */
  const measuredGrow = (p: THREE.Vector3, radial: THREE.Vector3) => {
    if (!map) return -1
    map.project(p.x, p.y, _uv)
    if (!inPhoto(_uv) || map.at(_uv.u, _uv.v) < 0.4) return -1

    const STEPS = 18
    const max = faceSpan * 0.42
    let travelled = 0
    for (let s = 1; s <= STEPS; s++) {
      const d = (s / STEPS) * max
      _probe.copy(p).addScaledVector(radial, d)
      map.project(_probe.x, _probe.y, _uv)
      if (!inPhoto(_uv) || map.at(_uv.u, _uv.v) < 0.4) break
      travelled = d
    }
    return travelled
  }

  /**
   * Hair colour at a point, straight off the photo where it can be seen.
   *
   * This bakes the photo's own lighting into the albedo, which is the same
   * trade the face texture already makes - a highlight from their lighting
   * gets relit by ours. It's worth it: sampled colour is what carries dye,
   * grey, roots and sun-bleached ends, and a single averaged tone carries none
   * of them.
   */
  const colourAt = (p: THREE.Vector3, out: THREE.Color) => {
    out.copy(tone)
    if (!map) return
    const trust = trustAt(p)
    if (trust <= 0.001) return
    map.project(p.x, p.y, _uv)
    if (!inPhoto(_uv) || map.at(_uv.u, _uv.v) < 0.35) return
    if (!map.colorAt(_uv.u, _uv.v, _photo)) return
    // Keeping a little of the probed tone stops one blown-out specular pixel
    // from bleaching a whole vertex.
    out.lerp(_photo, trust * 0.85)
  }

  // --- Surface ------------------------------------------------------------
  const surfacePoints: THREE.Vector3[] = []
  const surfaceNormals: THREE.Vector3[] = []
  const surfaceAlpha: number[] = []
  const surfaceColour: THREE.Color[] = []

  for (let k = 0; k < ringCount; k++) {
    const back = k / Math.max(1, ringCount - 1)
    for (let i = 0; i < cols; i++) {
      const s = i / SUB
      const p = readSmooth(k, s, new THREE.Vector3())
      _d.subVectors(p, centre).normalize()

      // Bulk swells toward the crown and back of the head, and is broken up by
      // large low-frequency lobes so the silhouette is never a clean dome.
      const lobes = fbm(i * 0.22, k * 0.3, 3)
      // Puff flattens the front-to-back bias toward a constant, which is the
      // difference between a head of hair that follows the skull and the near
      // sphere of an afro.
      const profile = THREE.MathUtils.lerp(0.45 + 1.5 * back, 1.5, style.puff)
      let grow = thickness * profile * (0.45 + 1.25 * lobes)

      // The parting. Hair is combed away from a line, so the shell is at its
      // thinnest along it and the scalp shows through. At short lengths this is
      // most of what distinguishes one cut from another - without it every
      // short style is the same smooth cap in a different thickness.
      if (style.partDepth > 0.001) {
        const partX = style.part * faceSpan * 0.3
        const groove = Math.exp(-Math.pow((p.x - partX) / (faceSpan * 0.05), 2))
        // A parting runs over the top and front, never down the back of a head.
        const overTop = THREE.MathUtils.smoothstep(p.y, centre.y, centre.y + faceSpan * 0.3)
        const inFront = 1 - THREE.MathUtils.smoothstep(centre.z - p.z, faceSpan * 0.2, faceSpan * 0.6)
        grow *= 1 - 0.78 * style.partDepth * groove * overTop * inFront
      }

      // Wherever the photo can see the outline, it decides the volume. This is
      // the part that makes a big style actually build big, instead of every
      // head getting the same shell in a different colour.
      const measured = measuredGrow(p, _d)
      if (measured > 0) {
        // Floor and ceiling both matter. A fringe seen edge-on measures near
        // nothing, and collapsing the shell onto the skull there opens up bare
        // scalp; a mask that leaks into a same-coloured background measures
        // most of the photo, and without a cap that inflates into a balloon.
        const bounded = THREE.MathUtils.clamp(measured, thickness * 0.5, thickness * 3.2)
        grow = THREE.MathUtils.lerp(grow, bounded, trustAt(p))
      }

      const hp = p.clone().addScaledVector(_d, grow)

      surfacePoints.push(hp)
      surfaceNormals.push(_d.clone())
      const a = alphaAt(hp, i)
      surfaceAlpha.push(a)
      const tint = new THREE.Color()
      colourAt(hp, tint)
      surfaceColour.push(tint)

      flowAt(hp, _d, _flow)
      push(b, hp, _flow, a, i / (cols - 1), tint)
    }
  }

  for (let k = 0; k < ringCount - 1; k++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = k * cols + i
      const c = a + 1
      const d = (k + 1) * cols + i
      const e = d + 1
      b.index.push(a, d, c, c, d, e)
    }
  }

  // Close the crown. The cranium's last ring is still about a third of the face
  // radius across, so a shell that stops there leaves an open hole at the top
  // back of the skull - and because the shell is offset outward, you see the
  // rim of that hole with scalp inside it. The cranium carries a pole vertex
  // past its rings for exactly this; grow it by the last ring's mean offset so
  // it meets the ring it closes instead of spiking or sinking.
  const poleAt = ringCount * ringSize * 3
  if (positions.length >= poleAt + 3) {
    const last = (ringCount - 1) * cols
    let meanGrow = 0
    for (let i = 0; i < cols; i++) {
      meanGrow += surfacePoints[last + i].distanceTo(read(ringCount - 1, i, _tmp))
    }
    meanGrow /= cols

    const pole = new THREE.Vector3(positions[poleAt], positions[poleAt + 1], positions[poleAt + 2])
    _d.subVectors(pole, centre).normalize()
    pole.addScaledVector(_d, meanGrow)

    flowAt(pole, _d, _flow)
    const poleTint = new THREE.Color()
    colourAt(pole, poleTint)
    const poleIndex = push(b, pole, _flow, alphaAt(pole, 0), 0, poleTint)
    for (let i = 0; i < cols - 1; i++) b.index.push(last + i, poleIndex, last + i + 1)
  }

  // --- Wisps --------------------------------------------------------------
  // Tapered tubes rather than ribbons: a ribbon has to be oriented to face
  // somewhere, and at the silhouette - exactly where these matter - it turns
  // edge-on and vanishes. A three-sided tube reads from every angle.
  // Deliberately restrained. Long wisps rooted on a ragged boundary read as
  // shards flying off the head rather than as stray hairs.
  const WISPS = Math.round(80 * amount * style.wisp)
  const SEGMENTS = 5
  const SIDES = 3
  const up = new THREE.Vector3(0, 1, 0)
  const side = new THREE.Vector3()
  const bino = new THREE.Vector3()
  const ringPt = new THREE.Vector3()

  for (let w = 0; w < WISPS; w++) {
    // Roots have to land where there is actually hair, and a single sample
    // often doesn't - the front rings are mostly cut away below the hairline.
    // Dropping those wisps silently would make `amount` control the number of
    // attempts rather than the number of wisps, so resample instead.
    let at = -1
    let i = 0
    for (let attempt = 0; attempt < 6 && at < 0; attempt++) {
      // Bias roots toward the outer rings, where breaking the outline counts.
      const k = Math.min(
        ringCount - 2,
        Math.floor(Math.pow(hash(w * 3.7 + attempt * 23.9), 0.6) * (ringCount - 1)),
      )
      // Across the resampled columns, not the cranium's original 36 - sampling
      // only the first third of the head would leave one side bare.
      const col = Math.floor(hash(w * 7.3 + 11 + attempt * 31.7) * (cols - 1))
      // Solidly inside the hair, not merely on its ragged edge - a wisp rooted
      // in a half-cut triangle is the thing that reads as a flying shard.
      if (surfaceAlpha[k * cols + col] >= 0.85) {
        at = k * cols + col
        i = col
      }
    }
    if (at < 0) continue

    const root = surfacePoints[at]
    const normal = surfaceNormals[at]
    // A wisp is hair that grew out of this exact spot, so it takes the shell's
    // colour there rather than the average - a blonde streak throws blonde
    // flyaways.
    const wispTint = surfaceColour[at]
    const dir = flowAt(root, normal, new THREE.Vector3())
    // Lift off the scalp so the wisp arcs away instead of skimming it.
    dir.addScaledVector(normal, 0.55).normalize()

    const length = faceSpan * (0.035 + 0.075 * hash(w * 13.1 + 3)) * (0.5 + 0.5 * amount)
    const radius = faceSpan * 0.008 * (0.6 + 0.8 * hash(w * 5.9 + 7))

    const step = new THREE.Vector3().copy(dir)
    const cursor = new THREE.Vector3().copy(root)
    let base = -1

    for (let s = 0; s <= SEGMENTS; s++) {
      const t = s / SEGMENTS
      const r = radius * (1 - t) ** 1.3

      side.crossVectors(step, up)
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
      side.normalize()
      bino.crossVectors(step, side).normalize()

      const first = b.count
      for (let v = 0; v < SIDES; v++) {
        const a = (v / SIDES) * Math.PI * 2
        ringPt
          .copy(cursor)
          .addScaledVector(side, Math.cos(a) * r)
          .addScaledVector(bino, Math.sin(a) * r)
        // Taper the alpha as well as the radius. Against the alpha test the
        // per-strand jitter then bites off a different amount of each wisp's
        // last segment, so the tips end at scattered lengths rather than all
        // stopping on the same contour.
        push(b, ringPt, step, 1 - 0.5 * t * t, i / (cols - 1) + v * 0.0007, wispTint, t)
      }
      if (base >= 0) {
        for (let v = 0; v < SIDES; v++) {
          const v2 = (v + 1) % SIDES
          b.index.push(base + v, first + v, base + v2)
          b.index.push(base + v2, first + v, first + v2)
        }
      }
      base = first

      // Advance: droop under gravity and curl a little as it goes.
      cursor.addScaledVector(step, length / SEGMENTS)
      _tmp.set(
        (hash(w * 17.3 + s * 2.1) - 0.5) * 0.5,
        -0.5 - 0.35 * t,
        (hash(w * 19.7 + s * 3.3) - 0.5) * 0.5,
      )
      step.addScaledVector(_tmp, 0.22).normalize()
    }
  }

  // --- Curtains -----------------------------------------------------------
  /**
   * Sweeps a sheet of hair downward off the shell's bottom ring.
   *
   * The cranium is a skull: it stops at the ear line and has nothing in front
   * of the hairline, so neither long hair nor a fringe can be grown on it. Both
   * are the same operation with opposite masks - one hangs off the back and
   * sides, the other off the front - so they share a generator, and both join
   * the shell seamlessly because they start from its own vertices.
   */
  const curtain = (
    drop: number,
    toFront: boolean,
    opts: { flare: number; taper: number; forward: number },
  ) => {
    if (drop <= 0.005) return
    const ROWS = toFront ? 5 : 12
    const base = b.count
    const tint = new THREE.Color()

    for (let row = 0; row <= ROWS; row++) {
      const t = row / ROWS
      for (let i = 0; i < cols; i++) {
        const anchor = surfacePoints[i]
        const front = THREE.MathUtils.smoothstep(anchor.z, centre.z, centre.z + faceSpan * 0.3)
        // A fringe uses the front of the ring and long hair uses the rest. The
        // bottom ring is the whole face oval, chin included, so whichever half
        // isn't wanted has to be masked out rather than swept.
        const mask = toFront ? front : 1 - front
        const hangs = mask * (toFront ? 1 : surfaceAlpha[i])

        const p = anchor.clone()
        p.y -= drop * t
        // Falls inward and back as it goes, the way hair rests against a neck
        // rather than hanging as a cylinder off the widest part of the skull.
        // Flare pushes the ends back out, which is what a blunt bob does.
        p.x *= 1 - (0.22 - opts.flare * 0.42) * t * t
        p.z -= faceSpan * (toFront ? -opts.forward : 0.045) * t
        p.x *= 1 + 0.12 * t * t * style.puff

        _d.subVectors(p, centre).normalize()
        flowAt(p, _d, _flow)
        colourAt(anchor, tint)
        // Blunt ends stop on one line; layered ones dissolve, and the per-column
        // jitter lets the alpha test bite each strand off at its own length.
        const jitter = 1 + (fbm(i * 0.11, 3.7, 3) - 0.5) * opts.taper * 0.9
        const ends = 1 - THREE.MathUtils.smoothstep(t * jitter, 1 - opts.taper * 0.55, 1.02)
        push(b, p, _flow, hangs * Math.max(ends, opts.taper < 0.05 ? 1 : 0), i / (cols - 1), tint)
      }
    }

    for (let row = 0; row < ROWS; row++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = base + row * cols + i
        const d = base + (row + 1) * cols + i
        b.index.push(a, d, a + 1, a + 1, d, d + 1)
      }
    }
  }

  curtain(faceSpan * style.length, false, {
    flare: style.flare,
    taper: style.taper,
    forward: 0,
  })
  // The fringe comes forward as well as down, so it sits off the forehead
  // rather than painted flat against it.
  curtain(faceSpan * style.fringe, true, { flare: 0, taper: 0.35, forward: 0.06 })

  // --- Gathered mass ------------------------------------------------------
  // A bun or a ponytail is hair that has been tied off, so it isn't a surface
  // grown on the skull at all - it's a separate lump sitting where the tie is.
  if (style.gather !== 'none') {
    const bun = style.gather === 'bun'
    const at = new THREE.Vector3(
      centre.x,
      centre.y + faceSpan * (bun ? 0.44 : 0.02),
      centre.z - faceSpan * (bun ? 0.42 : 0.52),
    )
    const radius = faceSpan * (bun ? 0.17 : 0.12)
    const scale = bun
      ? new THREE.Vector3(1, 0.85, 1)
      : // A ponytail is the same blob drawn out downward.
        new THREE.Vector3(0.85, 2.6, 0.85)

    const LAT = 14
    const LON = 24
    const base = b.count
    const tint = new THREE.Color()
    colourAt(at, tint)
    for (let a = 0; a <= LAT; a++) {
      const phi = (a / LAT) * Math.PI
      for (let o = 0; o <= LON; o++) {
        const theta = (o / LON) * Math.PI * 2
        const p = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta),
        )
        // Lumpy rather than a clean sphere - a tied bundle of hair never is.
        const lump = 1 + (fbm(o * 0.4, a * 0.5, 3) - 0.5) * 0.3
        p.multiply(scale).multiplyScalar(radius * lump).add(at)
        _d.subVectors(p, at).normalize()
        flowAt(p, _d, _flow)
        push(b, p, _flow, 1, o / LON, tint)
      }
    }
    for (let a = 0; a < LAT; a++) {
      for (let o = 0; o < LON; o++) {
        const i0 = base + a * (LON + 1) + o
        const i1 = base + (a + 1) * (LON + 1) + o
        b.index.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.position, 3))
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(b.flow, 3))
  geometry.setAttribute('aAlpha', new THREE.Float32BufferAttribute(b.alpha, 1))
  geometry.setAttribute('aStrand', new THREE.Float32BufferAttribute(b.strand, 1))
  geometry.setAttribute('aRoot', new THREE.Float32BufferAttribute(b.root, 1))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(b.color, 3))
  geometry.setIndex(b.index)
  geometry.computeVertexNormals()
  weldSeamNormals(geometry, ringCount, cols, ringSize)
  ensureFlex(geometry, 0.18)
  return geometry
}

/**
 * The shell's first and last columns are the same place on the head, duplicated
 * so the strand coordinate can run 0..1 without a discontinuity. Each copy is
 * only touched by the faces on its own side, so computeVertexNormals hands them
 * different averages and a lighting crease runs top to bottom down the seam.
 * Average the pair back together.
 */
function weldSeamNormals(
  geometry: THREE.BufferGeometry,
  ringCount: number,
  cols: number,
  ringSize: number,
) {
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  const a = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let k = 0; k < ringCount; k++) {
    const first = k * cols
    const last = first + ringSize
    a.fromBufferAttribute(normal, first)
    c.fromBufferAttribute(normal, last)
    a.add(c).normalize()
    normal.setXYZ(first, a.x, a.y, a.z)
    normal.setXYZ(last, a.x, a.y, a.z)
  }
  normal.needsUpdate = true
}

/* ------------------------------------------------------------- material */

const VERT_DECLS = /* glsl */ `
attribute float aAlpha;
attribute float aStrand;
attribute float aRoot;
attribute vec3 aFlow;
varying float vHairAlpha;
varying float vStrand;
varying float vRoot;
varying vec3 vFlowW;
varying vec3 vPosW;
`

const FRAG_DECLS = /* glsl */ `
varying float vHairAlpha;
varying float vStrand;
varying float vRoot;
varying vec3 vFlowW;
varying vec3 vPosW;
uniform vec3 uHairLightDir;
uniform vec3 uHairLightColor;
uniform vec3 uSheenPrimary;
uniform vec3 uSheenSecondary;

/**
 * Kajiya-Kay anisotropic highlight. Hair scatters along the strand rather
 * than about a surface normal, so the specular is a band that runs across the
 * head, and that band is most of what separates hair from moulded plastic.
 */
float hairSpec(vec3 T, vec3 V, vec3 L, float exponent) {
  float tl = dot(T, L);
  float tv = dot(T, V);
  float sinTL = sqrt(max(0.0, 1.0 - tl * tl));
  float sinTV = sqrt(max(0.0, 1.0 - tv * tv));
  return pow(max(0.0, sinTL * sinTV - tl * tv), exponent);
}

/** Per-strand random, used to break both colour and highlight into strands. */
float strandHash(float u) {
  return fract(sin(floor(u) * 127.1) * 43758.5453);
}
`

export type HairUniforms = {
  uHairLightDir: { value: THREE.Vector3 }
  uHairLightColor: { value: THREE.Color }
}

export function makeHairMaterial(
  tone: THREE.Color,
  field: DeformField,
): { material: THREE.MeshStandardMaterial; uniforms: HairUniforms } {
  const material = new THREE.MeshStandardMaterial({
    // White, because the real colour rides on the per-vertex attribute that
    // buildHair sampled out of the photo. `tone` survives only as the base the
    // unphotographed back of the head falls back to, which buildHair has
    // already blended in per vertex.
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.62,
    metalness: 0,
    transparent: true,
    // alphaTest keeps depth writing on, so the shell and the wisps sort
    // against each other correctly instead of blending in draw order.
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  })

  const uniforms: HairUniforms = {
    uHairLightDir: { value: new THREE.Vector3(0.5, 0.7, 0.6).normalize() },
    uHairLightColor: { value: new THREE.Color('#fff1e0') },
  }

  applyDeform(material, field)
  const deformCompile = material.onBeforeCompile

  material.onBeforeCompile = (shader, renderer) => {
    deformCompile?.(shader, renderer)
    shader.uniforms.uHairLightDir = uniforms.uHairLightDir
    shader.uniforms.uHairLightColor = uniforms.uHairLightColor
    shader.uniforms.uSheenPrimary = { value: new THREE.Color(0xffffff).multiplyScalar(0.5) }
    shader.uniforms.uSheenSecondary = { value: tone.clone().lerp(new THREE.Color(0xffffff), 0.45) }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECLS}`)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vHairAlpha = aAlpha;
        vStrand = aStrand;
        vRoot = aRoot;
        vFlowW = normalize(mat3(modelMatrix) * aFlow);
        vPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECLS}`)
      // Strand colour variation has to land before the alpha test so the
      // ragged edge is cut per strand, not as one smooth contour.
      .replace(
        '#include <alphatest_fragment>',
        /* glsl */ `
        float hs = strandHash(vStrand * 190.0);
        // A second, finer band, so the streaking isn't one regular comb.
        float hf = strandHash(vStrand * 830.0 + 17.0);
        // Some strand contrast is what stops this reading as clay, but it
        // multiplies whatever the per-vertex colour is already doing - and now
        // that the colour comes off a photo, a wide swing turns ordinary
        // sampling noise into confetti. Kept modest deliberately.
        diffuseColor.rgb *= (0.82 + 0.3 * hs) * (0.93 + 0.14 * hf);
        // A wisp stands clear of the mass, so nothing is shadowing it - tips
        // lift away from the shell they grew out of instead of matching it.
        diffuseColor.rgb *= 1.0 + 0.42 * vRoot;
        diffuseColor.a *= vHairAlpha * (0.82 + 0.35 * hs);
        #include <alphatest_fragment>`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          vec3 T = normalize(vFlowW);
          vec3 V = normalize(cameraPosition - vPosW);
          vec3 L = normalize(uHairLightDir);
          // Two shifted lobes: a tight white one off the cuticle and a broad
          // tinted one from light that has been through the strand.
          float shift = (hs - 0.5) * 0.28;
          vec3 T1 = normalize(T + normal * shift);
          vec3 T2 = normalize(T + normal * (shift + 0.42));
          float s1 = hairSpec(T1, V, L, 92.0);
          float s2 = hairSpec(T2, V, L, 14.0);
          outgoingLight += uHairLightColor * (uSheenPrimary * s1 + uSheenSecondary * s2 * 0.32)
            * (1.0 + 0.6 * vRoot);
        }
        #include <opaque_fragment>`,
      )
  }
  material.customProgramCacheKey = () => 'gigil-hair-aniso'

  return { material, uniforms }
}
