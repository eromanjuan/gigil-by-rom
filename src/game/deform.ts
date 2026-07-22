import * as THREE from 'three'

export const MAX_IMPACTS = 8
export const MAX_SWELLS = 6

/**
 * Hard ceiling on how far any one site can puff out, in head-heights.
 *
 * This is the cap that keeps a battered face still readable as the person in
 * the photo: swelling accumulates toward it and stops, so no amount of
 * pounding can dissolve the features into a blob. It also keeps the vertex
 * displacement inside the range where the cheap normal correction below still
 * looks right.
 */
export const MAX_SWELL = 0.055

/** How close two sites must be to merge instead of allocating a new one. */
const SWELL_MERGE_DISTANCE = 0.16

export type ImpactKind = 'push' | 'pinch' | 'pull'
const KIND_ID: Record<ImpactKind, number> = { push: 0, pinch: 1, pull: 2 }

export type ImpactOptions = {
  center: THREE.Vector3
  /** Direction and magnitude of the deformation, in head-height units. */
  direction: THREE.Vector3
  radius: number
  kind?: ImpactKind
  /** Seconds to reach full depth. Short = snappy. */
  attack?: number
  /** Seconds held at full depth. Used by sustained moves like the choke. */
  hold?: number
  /** Seconds to spring back, with overshoot. */
  release?: number
}

type Slot = {
  active: boolean
  age: number
  center: THREE.Vector3
  direction: THREE.Vector3
  radius: number
  kind: number
  attack: number
  hold: number
  release: number
  /** Set for held impacts (choke); they stay at full depth until released. */
  sustained: boolean
}

/**
 * The envelope that gives a hit its punch: a fast bite in, a beat at full
 * depth, then an elastic recovery that overshoots once before settling.
 */
function envelope(slot: Slot): number {
  const { age, attack, hold, release } = slot
  if (age < attack) {
    const t = age / attack
    return t * t * (3 - 2 * t)
  }
  if (slot.sustained || age < attack + hold) return 1
  const r = (age - attack - hold) / release
  if (r >= 1) return 0
  return Math.exp(-4 * r) * Math.cos(r * Math.PI * 3) * (1 - r)
}

/**
 * Owns the per-impact uniforms and hands the same uniform objects to every
 * material on the head, so the face, skull and ears all deform together.
 */
export class DeformField {
  readonly uImpactPos = { value: Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector4()) }
  readonly uImpactDir = { value: Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector4()) }
  readonly uWobble = { value: 0 }
  readonly uTime = { value: 0 }
  /** xyz = centre, w = radius. */
  readonly uSwellPos = { value: Array.from({ length: MAX_SWELLS }, () => new THREE.Vector4()) }
  /** x = current amount, y = target amount (amounts ease in over ~0.5s). */
  readonly uSwellAmt = { value: Array.from({ length: MAX_SWELLS }, () => new THREE.Vector2()) }

  private swells = Array.from({ length: MAX_SWELLS }, () => ({
    active: false,
    centre: new THREE.Vector3(),
    radius: 0,
    amount: 0,
    target: 0,
  }))

  private slots: Slot[] = Array.from({ length: MAX_IMPACTS }, () => ({
    active: false,
    age: 0,
    center: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    radius: 0,
    kind: 0,
    attack: 0.02,
    hold: 0.04,
    release: 0.45,
    sustained: false,
  }))

  /** Returns a handle you can release() if the impact is sustained. */
  add(opts: ImpactOptions, sustained = false): number {
    // Reuse the oldest slot when we run out - the newest hit matters most.
    let idx = this.slots.findIndex((s) => !s.active)
    if (idx === -1) {
      idx = 0
      let oldest = -1
      this.slots.forEach((s, i) => {
        if (!s.sustained && s.age > oldest) {
          oldest = s.age
          idx = i
        }
      })
    }
    const slot = this.slots[idx]
    slot.active = true
    slot.age = 0
    slot.center.copy(opts.center)
    slot.direction.copy(opts.direction)
    slot.radius = opts.radius
    slot.kind = KIND_ID[opts.kind ?? 'push']
    slot.attack = opts.attack ?? 0.02
    slot.hold = opts.hold ?? 0.04
    slot.release = opts.release ?? 0.45
    slot.sustained = sustained
    return idx
  }

  /** Lets a sustained impact begin its release. */
  release(handle: number) {
    const slot = this.slots[handle]
    if (!slot?.sustained) return
    slot.sustained = false
    slot.age = slot.attack + slot.hold
  }

  /**
   * Adds lasting puffiness at a point. Nearby hits merge into one site so that
   * working the same cheek deepens a single swelling instead of stacking a
   * pile of overlapping bumps.
   */
  swell(centre: THREE.Vector3, radius: number, amount: number) {
    let slot = this.swells.find((s) => s.active && s.centre.distanceTo(centre) < SWELL_MERGE_DISTANCE)
    if (!slot) {
      slot = this.swells.find((s) => !s.active)
      // All sites in use: grow the shallowest rather than ignoring the hit.
      if (!slot) {
        slot = this.swells.reduce((a, b) => (b.target < a.target ? b : a))
      }
      slot.active = true
      slot.centre.copy(centre)
      slot.radius = radius
      slot.amount = 0
      slot.target = 0
    }
    slot.radius = Math.max(slot.radius, radius)
    slot.target = Math.min(MAX_SWELL, slot.target + amount)
  }

  /** Drains all swelling back to flat, for the heal button. */
  heal() {
    for (const s of this.swells) s.target = 0
  }

  update(dt: number, wobble: number) {
    this.uTime.value += dt
    this.uWobble.value = wobble

    for (let i = 0; i < MAX_SWELLS; i++) {
      const s = this.swells[i]
      // Swelling rises over a couple of seconds rather than popping in.
      s.amount = THREE.MathUtils.damp(s.amount, s.target, 2.2, dt)
      if (s.active && s.target <= 0 && s.amount < 0.0005) {
        s.active = false
        s.amount = 0
      }
      this.uSwellPos.value[i].set(s.centre.x, s.centre.y, s.centre.z, s.active ? s.radius : 0)
      this.uSwellAmt.value[i].set(s.amount, s.target)
    }
    for (let i = 0; i < MAX_IMPACTS; i++) {
      const slot = this.slots[i]
      const pos = this.uImpactPos.value[i]
      const dir = this.uImpactDir.value[i]
      if (!slot.active) {
        pos.set(0, 0, 0, 0)
        continue
      }
      slot.age += dt
      const e = envelope(slot)
      if (!slot.sustained && slot.age > slot.attack + slot.hold + slot.release) {
        slot.active = false
        pos.set(0, 0, 0, 0)
        continue
      }
      pos.set(slot.center.x, slot.center.y, slot.center.z, slot.radius)
      dir.set(slot.direction.x * e, slot.direction.y * e, slot.direction.z * e, slot.kind)
    }
  }

  clear() {
    for (const slot of this.slots) {
      slot.active = false
      slot.sustained = false
    }
    for (const v of this.uImpactPos.value) v.set(0, 0, 0, 0)
    this.uWobble.value = 0
  }
}

const VERTEX_DECLS = /* glsl */ `
#define GIGIL_IMPACTS ${MAX_IMPACTS}
#define GIGIL_SWELLS ${MAX_SWELLS}
attribute float aFlex;
attribute float aEdge;
uniform vec4 uImpactPos[GIGIL_IMPACTS];
uniform vec4 uImpactDir[GIGIL_IMPACTS];
uniform vec4 uSwellPos[GIGIL_SWELLS];
uniform vec2 uSwellAmt[GIGIL_SWELLS];
uniform float uWobble;
uniform float uTime;
varying vec2 vFaceUv;
varying float vEdge;
varying float vSwell;

/**
 * Lasting puffiness: a smooth dome pushed out along the surface normal. The
 * amplitude is capped on the CPU side, which is what keeps a heavily damaged
 * face still recognisable rather than letting it inflate without limit.
 */
float gigilSwellAt(vec3 p, out float nearest) {
  float total = 0.0;
  nearest = 0.0;
  for (int i = 0; i < GIGIL_SWELLS; i++) {
    vec4 sp = uSwellPos[i];
    if (sp.w <= 0.0001) continue;
    float amt = uSwellAmt[i].x;
    if (amt <= 0.0001) continue;
    float f = 1.0 - smoothstep(0.0, sp.w, distance(p, sp.xyz));
    f = f * f * (3.0 - 2.0 * f);
    total += amt * f;
    nearest = max(nearest, f);
  }
  return total;
}

vec3 gigilDisplace(vec3 p, vec3 n, float flex) {
  vec3 total = vec3(0.0);
  for (int i = 0; i < GIGIL_IMPACTS; i++) {
    vec4 ip = uImpactPos[i];
    if (ip.w <= 0.0001) continue;
    float falloff = 1.0 - smoothstep(0.0, ip.w, distance(p, ip.xyz));
    if (falloff <= 0.0) continue;
    vec4 id = uImpactDir[i];
    int kind = int(id.w + 0.5);
    if (kind == 1) {
      // Pinch: flesh is drawn in toward the grip point.
      vec3 toward = ip.xyz - p;
      float len = length(toward);
      if (len > 1e-5) total += (toward / len) * length(id.xyz) * falloff * falloff * flex;
    } else if (kind == 2) {
      // Pull: a wide, soft drag along the direction.
      total += id.xyz * falloff * flex;
    } else {
      // Push: a sharp dent that bites hardest at the centre.
      total += id.xyz * falloff * falloff * flex;
    }
  }
  // Flesh keeps ringing after the blow lands.
  total += n * uWobble * 0.022 * flex * sin(p.y * 34.0 - uTime * 26.0);
  return total;
}
`

const FRAGMENT_DECLS = /* glsl */ `
varying vec2 vFaceUv;
varying float vEdge;
varying float vSwell;
uniform sampler2D uBruise;
uniform vec3 uSkin;
`

type DeformOptions = { bruiseMap?: THREE.Texture; skinTone?: THREE.Color }

/**
 * Injects the deformation into a standard PBR material, so hits still get real
 * lighting. Normals are nudged toward the displacement rather than recomputed -
 * cheap, and at these amplitudes the difference isn't visible.
 */
export function applyDeform(
  material: THREE.MeshStandardMaterial,
  field: DeformField,
  options: DeformOptions = {},
) {
  const useBruise = !!options.bruiseMap
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uImpactPos = field.uImpactPos
    shader.uniforms.uImpactDir = field.uImpactDir
    shader.uniforms.uSwellPos = field.uSwellPos
    shader.uniforms.uSwellAmt = field.uSwellAmt
    shader.uniforms.uWobble = field.uWobble
    shader.uniforms.uTime = field.uTime
    if (useBruise) {
      shader.uniforms.uBruise = { value: options.bruiseMap }
      shader.uniforms.uSkin = { value: options.skinTone ?? new THREE.Color('#d9a184') }
    }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLS}`)
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
        vEdge = aEdge;
        vFaceUv = uv;
        float gigilSwellNear;
        float gigilSwellAmt = gigilSwellAt(position, gigilSwellNear);
        vSwell = gigilSwellNear * step(0.001, gigilSwellAmt);
        vec3 gigilDisp = gigilDisplace(position, objectNormal, aFlex)
          + objectNormal * gigilSwellAmt * mix(0.55, 1.0, aFlex);
        objectNormal = normalize(objectNormal + gigilDisp * 2.5);
        `,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n        transformed += gigilDisp;`)

    if (useBruise) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLS}`)
        .replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
          vec4 gigilBruise = texture2D(uBruise, vFaceUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, gigilBruise.rgb, gigilBruise.a);
          // Swollen skin pulls taut and flushes. Subtle - the puffiness itself
          // is doing the work, this just stops it reading as a plastic bulge.
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 0.84, 0.82), vSwell * 0.5);
          // Dissolve the outer rim into plain skin. The landmark oval runs
          // slightly wide of the real silhouette, so without this the edge
          // triangles sample whatever was behind the head in the photo and
          // ring the face in stray background colour.
          diffuseColor.rgb = mix(uSkin, diffuseColor.rgb, vEdge);
          `,
        )
    }
  }
  // Materials with and without the bruise map compile to different programs.
  material.customProgramCacheKey = () => `gigil-deform-${useBruise ? 'bruise' : 'plain'}`
  return material
}

/**
 * Every geometry sharing the deform material needs the flex and edge
 * attributes the shader reads. Solid parts get edge = 1: they're opaque skin,
 * with no silhouette to feather.
 */
export function ensureFlex(geometry: THREE.BufferGeometry, value: number) {
  const count = geometry.getAttribute('position').count
  if (!geometry.getAttribute('aFlex')) {
    geometry.setAttribute('aFlex', new THREE.BufferAttribute(new Float32Array(count).fill(value), 1))
  }
  if (!geometry.getAttribute('aEdge')) {
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1))
  }
  return geometry
}
