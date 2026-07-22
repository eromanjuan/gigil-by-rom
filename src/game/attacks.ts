import * as THREE from 'three'
import { LM } from './landmarks'
import type { DeformField } from './deform'
import type { HeadRig } from './springs'
import type { Bust } from './bust'
import { posesFor, type Hand, type HandKind } from './hands'
import type { CameraShake, ImpactFlash, Particles } from './fx'
import type { Sfx } from './audio'

export type AttackId = 'punch' | 'slapL' | 'slapR' | 'poke' | 'pinch' | 'choke' | 'spit'

export const ATTACK_LIST: { id: AttackId; key: string; label: string; hint: string }[] = [
  { id: 'punch', key: 'Z', label: 'Punch', hint: 'Clenched fist, straight jab. Alternates sides' },
  { id: 'slapL', key: 'X', label: 'Slap L', hint: 'Open palm, swung in from the left' },
  { id: 'slapR', key: 'C', label: 'Slap R', hint: 'Open palm, swung in from the right' },
  { id: 'poke', key: 'V', label: 'Poke Eyes', hint: 'Two-finger thrust' },
  { id: 'pinch', key: 'B', label: 'Pinch Nose', hint: 'Thumb and forefinger, twisting' },
  { id: 'choke', key: 'N', label: 'Strangle', hint: 'Hold to keep throttling' },
  { id: 'spit', key: 'M', label: 'Spit', hint: 'Rude, effective' },
]

/**
 * Somewhere on a head worth hitting.
 *
 * Attacks used to ask for MediaPipe vertex numbers directly, which quietly
 * meant every move only worked on a head reconstructed from a photo. Naming
 * the targets instead lets anything that can answer "where is the left cheek"
 * be punched - a photo rig, or a generated dummy that has no landmarks at all.
 */
export type TargetName = keyof typeof LM

export type AttackContext = {
  bust: Bust
  rig: HeadRig
  field: DeformField
  particles: Particles
  flash: ImpactFlash
  shake: CameraShake
  sfx: Sfx
  hand(kind: HandKind, slot?: 'a' | 'b'): Hand
  /** Target position in head-local space. */
  pointOf(name: TargetName): THREE.Vector3
  /** Target UV, in whatever space the bust's bruise layer paints in. */
  uvOf(name: TargetName): { u: number; v: number }
  hit(info: { damage: number; power: number }): void
}

/* ------------------------------------------------------------ keyframing */

type Ease = 'linear' | 'in' | 'out' | 'inout'

const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inout: (t) => t * t * t * (t * (t * 6 - 15) + 10),
}

type Key = {
  t: number
  /**
   * Where the hand's contact point should sit, relative to the target. All
   * zeroes means the knuckles/fingertips are exactly on the landmark, so the
   * contact key is just `[0, 0, 0]` and the geometry works itself out.
   */
  pos: [number, number, number]
  /** Euler in YXZ order - see makeHand. */
  rot?: [number, number, number]
  /** Pose blend, 0 = open, 1 = closed. */
  grip?: number
  /** How to travel *into* this key. */
  ease?: Ease
}

const _pos = new THREE.Vector3()
const _rot = new THREE.Euler(0, 0, 0, 'YXZ')
const _offset = new THREE.Vector3()

function sample(keys: Key[], t: number) {
  let i = 0
  while (i < keys.length - 2 && t > keys[i + 1].t) i++
  const a = keys[i]
  const b = keys[Math.min(i + 1, keys.length - 1)]
  const span = b.t - a.t || 1
  const u = EASES[b.ease ?? 'inout'](THREE.MathUtils.clamp((t - a.t) / span, 0, 1))

  _pos.set(
    THREE.MathUtils.lerp(a.pos[0], b.pos[0], u),
    THREE.MathUtils.lerp(a.pos[1], b.pos[1], u),
    THREE.MathUtils.lerp(a.pos[2], b.pos[2], u),
  )
  const ar = a.rot ?? [0, 0, 0]
  const br = b.rot ?? [0, 0, 0]
  _rot.set(
    THREE.MathUtils.lerp(ar[0], br[0], u),
    THREE.MathUtils.lerp(ar[1], br[1], u),
    THREE.MathUtils.lerp(ar[2], br[2], u),
    'YXZ',
  )
  return { grip: THREE.MathUtils.lerp(a.grip ?? 0, b.grip ?? 0, u) }
}

/**
 * Places a hand so its contact point lands on `target + offset`, given the
 * orientation already written into `hand.rotation`. Aiming by contact point
 * rather than by wrist means retuning a pose never desyncs the aim.
 */
function placeByContact(hand: Hand, target: THREE.Vector3, offset: THREE.Vector3) {
  _offset.copy(hand.userData.contact as THREE.Vector3).multiply(hand.scale).applyQuaternion(hand.quaternion)
  hand.position.copy(target).add(offset).sub(_offset)
}

/* --------------------------------------------------------------- attacks */

export abstract class Attack {
  done = false
  protected elapsed = 0

  abstract readonly id: AttackId
  abstract update(dt: number, ctx: AttackContext): void

  get retriggerable(): boolean {
    return false
  }

  onRelease(_ctx: AttackContext): void {}
  cancel(ctx: AttackContext): void {
    this.onRelease(ctx)
    this.done = true
  }
}

type StrikeConfig = {
  id: AttackId
  handKind: HandKind
  duration: number
  impactAt: number
  keys: Key[]
  target: (ctx: AttackContext, side: number) => THREE.Vector3
  targetLandmark: (side: number) => TargetName
  response: (side: number) => {
    knock: THREE.Vector3
    torque: THREE.Vector3
    squash: number
    wobble: number
    deformDir: THREE.Vector3
    deformRadius: number
    /** Lasting puffiness added at the impact site. */
    swell: number
    damage: number
    shake: number
  }
  onImpact?(ctx: AttackContext, at: THREE.Vector3, side: number): void
}

class StrikeAttack extends Attack {
  readonly id: AttackId
  private struck = false
  private side: number
  private target = new THREE.Vector3()
  private contact = 0

  constructor(
    private config: StrikeConfig,
    side: number,
  ) {
    super()
    this.id = config.id
    this.side = side
  }

  override get retriggerable() {
    return this.elapsed / this.config.duration > 0.7
  }

  update(dt: number, ctx: AttackContext) {
    const { config } = this
    if (this.elapsed === 0) this.target.copy(config.target(ctx, this.side))
    this.elapsed += dt
    const t = this.elapsed / config.duration

    // Slot by side, so a strike from the left is an actual left hand rather
    // than a right one flipped through the target. The scanned rig mirrors its
    // geometry per slot; the procedural one is symmetrical enough not to care.
    const hand = ctx.hand(config.handKind, this.side < 0 ? 'b' : 'a')
    if (t >= 1) {
      hand.visible = false
      this.done = true
      return
    }

    const { grip } = sample(config.keys, t)
    hand.visible = true
    hand.rotation.set(_rot.x, _rot.y * this.side, _rot.z * this.side, 'YXZ')
    _pos.multiply(_side.set(this.side, 1, 1))
    placeByContact(hand, this.target, _pos)

    const [open, closed] = posesFor(config.handKind)
    hand.setPose(open, closed, grip)
    // Fingers splay against the skin for a beat after contact, then relax.
    this.contact = this.struck ? Math.max(0, this.contact - dt * 3.2) : 0
    hand.setContact(this.contact)

    if (!this.struck && t >= config.impactAt) {
      this.struck = true
      this.contact = 1
      this.strike(ctx)
    }
  }

  private strike(ctx: AttackContext) {
    const r = this.config.response(this.side)
    const at = this.target

    ctx.rig.hit(r.knock, r.torque, r.squash, r.wobble)
    ctx.field.add({
      center: at,
      direction: r.deformDir,
      radius: r.deformRadius,
      kind: 'push',
      attack: 0.018,
      hold: 0.05,
      release: 0.5,
    })
    ctx.field.swell(at, r.deformRadius * 1.15, r.swell)
    ctx.shake.add(r.shake)
    // Kept tight to the contact point - the brief is zero clutter over the face.
    ctx.flash.spawn(at.clone().setZ(at.z + 0.1), r.deformRadius * 0.5)
    ctx.hit({ damage: r.damage, power: r.shake })
    this.config.onImpact?.(ctx, at, this.side)
  }
}

/* ------------------------------------------------------------ definitions */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const _side = new THREE.Vector3()

const PUNCH: StrikeConfig = {
  id: 'punch',
  handKind: 'fist',
  duration: 0.62,
  impactAt: 0.46,
  targetLandmark: (side) => (side > 0 ? 'cheekR' : 'cheekL'),
  target: (ctx, side) => ctx.pointOf(side > 0 ? 'cheekR' : 'cheekL'),
  // Offsets are in head-heights and the camera is only ~3.3 of those away, so
  // the fist enters from off to the side rather than over the player's
  // shoulder, which would put it in the lens.
  keys: [
    { t: 0, pos: [2.3, 0.25, 0.9], rot: [0, -0.7, 0], grip: 0.35, ease: 'out' },
    { t: 0.34, pos: [2.7, 0.5, 1.15], rot: [0.1, -0.8, 0], grip: 1, ease: 'out' },
    { t: 0.46, pos: [0, 0, 0], rot: [0, -0.12, 0], grip: 1, ease: 'in' },
    { t: 0.58, pos: [-0.14, -0.06, -0.1], rot: [0, 0, 0], grip: 1, ease: 'out' },
    { t: 1, pos: [2.3, 0.25, 0.9], rot: [0, -0.7, 0], grip: 0.35, ease: 'inout' },
  ],
  response: (side) => ({
    knock: V(side * 0.6, 0.18, -1.9),
    torque: V(0.5, side * 2.4, side * -1.5),
    squash: -0.075,
    wobble: 0.85,
    deformDir: V(side * 0.06, -0.01, -0.19),
    deformRadius: 0.4,
    swell: 0.02,
    damage: 9,
    shake: 0.34,
  }),
  onImpact(ctx, at, side) {
    ctx.sfx.punch()
    ctx.sfx.yelp(0.95 + Math.random() * 0.2)
    ctx.particles.emit('sweat', at, V(side * 0.9, 0.7, 0.9), 5, { speed: 2.4, size: 0.02 })
    const uv = ctx.uvOf(PUNCH.targetLandmark(side))
    ctx.bust.bruises.mark('bruise', uv.u, uv.v, 1)
  },
}

/**
 * One slap, built twice. The two dock keys differ only in which side the hand
 * swings in from, and `side` already mirrors the keyframes, the target cheek
 * and the whole response - so the config is shared and only the id changes.
 */
const SLAP: Omit<StrikeConfig, 'id'> = {
  handKind: 'flat',
  duration: 0.55,
  impactAt: 0.44,
  targetLandmark: (side) => (side > 0 ? 'cheekR' : 'cheekL'),
  target: (ctx, side) => ctx.pointOf(side > 0 ? 'cheekR' : 'cheekL'),
  // Palm-first: the base yaw of -PI/2 turns the palm (+Y in hand space) to
  // face the cheek, and the sweep through the strike is the yaw delta.
  keys: [
    // The palm has to end up angled toward the camera as well as toward the
    // cheek. Facing it squarely along -X is anatomically right but presents
    // the hand perfectly edge-on, and the slap reads as a passing sliver.
    { t: 0, pos: [2.5, 0.55, 0.9], rot: [1.4, -1.75, -0.3], grip: 0, ease: 'out' },
    { t: 0.3, pos: [2.9, 0.75, 0.8], rot: [1.4, -1.9, -0.36], grip: 0, ease: 'out' },
    { t: 0.44, pos: [0, 0, 0], rot: [1.35, -1.02, -0.05], grip: 0, ease: 'in' },
    { t: 0.56, pos: [-0.62, -0.12, -0.05], rot: [1.3, -0.72, 0.16], grip: 0, ease: 'out' },
    { t: 1, pos: [2.5, 0.55, 0.9], rot: [1.4, -1.75, -0.3], grip: 0, ease: 'inout' },
  ],
  response: (side) => ({
    knock: V(side * 1.5, 0.1, -0.7),
    torque: V(0.2, side * 3.2, side * -2.6),
    squash: -0.04,
    wobble: 1,
    deformDir: V(side * 0.16, -0.01, -0.1),
    deformRadius: 0.46,
    swell: 0.012,
    damage: 6,
    shake: 0.26,
  }),
  onImpact(ctx, at, side) {
    ctx.sfx.slap()
    ctx.sfx.yelp(1.1 + Math.random() * 0.25)
    ctx.particles.emit('sweat', at, V(side * 1.4, 0.6, 0.7), 6, { speed: 3, size: 0.02 })
    const uv = ctx.uvOf(SLAP.targetLandmark(side))
    ctx.bust.bruises.mark('handprint', uv.u, uv.v, 1, side * 0.25)
    ctx.bust.bruises.mark('redness', uv.u, uv.v, 0.8)
  },
}

// side is mirrored into the keyframes, so -1 enters from screen left.
const SLAP_L: StrikeConfig = { ...SLAP, id: 'slapL' }
const SLAP_R: StrikeConfig = { ...SLAP, id: 'slapR' }

const POKE: StrikeConfig = {
  id: 'poke',
  handKind: 'poke',
  duration: 0.6,
  impactAt: 0.42,
  targetLandmark: () => 'noseBridge',
  target: (ctx) => ctx.pointOf('eyeInnerL').clone().lerp(ctx.pointOf('eyeInnerR'), 0.5),
  keys: [
    { t: 0, pos: [0.7, 1.7, 0.9], rot: [-0.7, 0, 0], grip: 0.2, ease: 'out' },
    { t: 0.28, pos: [0.8, 2.0, 1.05], rot: [-0.8, 0, 0], grip: 1, ease: 'out' },
    { t: 0.42, pos: [0, 0, 0], rot: [0, 0, 0], grip: 1, ease: 'in' },
    { t: 0.62, pos: [0, 0.03, 0.06], rot: [0, 0, 0], grip: 1, ease: 'out' },
    { t: 1, pos: [0.7, 1.7, 0.9], rot: [-0.7, 0, 0], grip: 0.2, ease: 'inout' },
  ],
  response: () => ({
    knock: V(0, 0.1, -0.9),
    torque: V(-1.4, 0, 0),
    squash: -0.03,
    wobble: 0.5,
    deformDir: V(0, 0, -0.09),
    deformRadius: 0.26,
    swell: 0.008,
    damage: 5,
    shake: 0.2,
  }),
  onImpact(ctx, at) {
    ctx.sfx.poke()
    ctx.sfx.yelp(1.35 + Math.random() * 0.2)
    // Puff each eye separately so the bridge of the nose stays put.
    for (const idx of ['eyeOuterL', 'eyeOuterR'] as TargetName[]) {
      const p = ctx.pointOf(idx)
      ctx.field.add({ center: p, direction: V(0, 0, -0.07), radius: 0.16, attack: 0.02, hold: 0.08, release: 0.4 })
      ctx.field.swell(p, 0.19, 0.016)
      const uv = ctx.uvOf(idx)
      ctx.bust.bruises.mark('redness', uv.u, uv.v, 0.55)
    }
    ctx.particles.emit('sweat', at, V(0, 1.1, 0.9), 5, { speed: 2.2, size: 0.018, spread: 1.1 })
  },
}

/* ---------------------------------------------------------------- pinch */

/**
 * Grab the nose, wring it, let go. The deform runs as a sustained 'pinch' so
 * the flesh is drawn toward the fingers for as long as they're closed.
 */
class PinchAttack extends Attack {
  readonly id: AttackId = 'pinch'
  private handle = -1
  private target = new THREE.Vector3()
  private gripped = false
  private readonly duration = 1.1
  private readonly gripAt = 0.28
  private readonly releaseAt = 0.76

  update(dt: number, ctx: AttackContext) {
    if (this.elapsed === 0) this.target.copy(ctx.pointOf('noseTip'))
    this.elapsed += dt
    const t = this.elapsed / this.duration
    const hand = ctx.hand('pinch')

    if (t >= 1) {
      hand.visible = false
      this.done = true
      return
    }

    hand.visible = true
    const approach = THREE.MathUtils.smoothstep(t, 0, this.gripAt)
    const retreat = t > this.releaseAt ? THREE.MathUtils.smoothstep(t, this.releaseAt, 1) : 0
    const away = Math.max(1 - approach, retreat)

    const held = t > this.gripAt && t < this.releaseAt
    const wind = held ? (t - this.gripAt) / (this.releaseAt - this.gripAt) : 0

    // Comes in from below and to the side, turned so the pinch is seen edge-on;
    // approaching down the camera axis hides the fingers behind the knuckles.
    //
    // The wring oscillates rather than winding one way. A continuous roll read
    // fine while the fingers were visibly closing around the nose, but the
    // scanned hand can't close, which leaves the roll as the only motion in the
    // attack - and 2.4 radians of it just looks like the hand spinning on the
    // spot. Twisting back and forth reads as working at something instead.
    const wring = Math.sin(wind * Math.PI * 3)
    hand.rotation.set(0.55, 0.85 + away * 0.5, wring * 0.5, 'YXZ')
    // And pull as it twists, so the nose is being dragged about rather than
    // just rotated around a fixed point.
    const tug = held ? Math.abs(wring) * 0.13 : 0
    placeByContact(
      hand,
      this.target,
      _pos.set(away * 2.1 + tug * 0.35, away * 0.5, away * 0.7 + tug),
    )
    hand.setPose('pinchOpen', 'pinchClosed', THREE.MathUtils.clamp(approach * 1.25, 0, 1))
    hand.setContact(held ? 1 : 0)

    if (!this.gripped && t >= this.gripAt) {
      this.gripped = true
      this.grip(ctx)
    }
    if (this.gripped && held) {
      // The head follows the twist rather than being pushed steadily one way,
      // so the wringing looks like it's actually connected to the nose.
      ctx.rig.tilt.velocity.z += wring * 2.6 * dt * 9
      ctx.rig.tilt.velocity.x += Math.abs(wring) * 0.7 * dt * 6
      ctx.rig.offset.velocity.z += 0.4 * dt
    }
    if (this.gripped && t >= this.releaseAt && this.handle >= 0) {
      ctx.field.release(this.handle)
      this.handle = -1
      ctx.sfx.yelp(1.5)
    }
  }

  private grip(ctx: AttackContext) {
    this.handle = ctx.field.add(
      {
        center: this.target,
        direction: V(0, 0, 0.09),
        radius: 0.24,
        kind: 'pinch',
        attack: 0.07,
        hold: 0,
        release: 0.45,
      },
      true,
    )
    ctx.field.swell(this.target, 0.22, 0.012)
    ctx.rig.hit(V(0, 0.05, 0.18), V(-0.5, 0, 0), 0.02, 0.3)
    ctx.sfx.pinch(true)
    ctx.shake.add(0.1)
    ctx.hit({ damage: 6, power: 0.22 })
    const uv = ctx.uvOf('noseTip')
    ctx.bust.bruises.mark('redness', uv.u, uv.v, 0.9)
  }

  onRelease(ctx: AttackContext) {
    if (this.handle >= 0) {
      ctx.field.release(this.handle)
      this.handle = -1
    }
  }
}

/* ------------------------------------------------------------------ choke */

/** Held for as long as the key is down. Damage ticks the whole time. */
class ChokeAttack extends Attack {
  readonly id: AttackId = 'choke'
  private handle = -1
  private stopSound: (() => void) | null = null
  private target = new THREE.Vector3()
  private holding = true
  private releaseAge = 0
  private tick = 0

  update(dt: number, ctx: AttackContext) {
    if (this.elapsed === 0) {
      this.target.copy(ctx.bust.throat)
      this.begin(ctx)
    }
    this.elapsed += dt

    const close = THREE.MathUtils.smoothstep(this.elapsed, 0, 0.16)
    const open = this.holding ? 0 : THREE.MathUtils.smoothstep(this.releaseAge, 0, 0.25)
    const away = Math.max(1 - close, open)

    for (const [i, slot] of (['a', 'b'] as const).entries()) {
      const side = i === 0 ? -1 : 1
      const hand = ctx.hand('grab', slot)
      hand.visible = true
      // Pitched up and only slightly splayed, so the forearms angle back toward
      // the player instead of sticking straight out sideways.
      hand.rotation.set(0.5, side * (0.5 - away * 0.3), side * 0.3, 'YXZ')
      placeByContact(
        hand,
        this.target,
        _pos.set(side * (0.16 + away * 2.2), away * 0.4, away * 0.6),
      )
      hand.setPose('clawOpen', 'clawClosed', close)
      hand.setContact(this.holding ? close : 0)
    }

    if (this.holding) {
      const shake = Math.sin(this.elapsed * 38) * 0.9
      ctx.rig.tilt.velocity.x += shake * dt * 6
      ctx.rig.tilt.velocity.z += Math.sin(this.elapsed * 27 + 1) * dt * 5
      ctx.rig.wobble = Math.min(1, ctx.rig.wobble + dt * 1.6)

      this.tick += dt
      if (this.tick > 0.28) {
        this.tick = 0
        ctx.hit({ damage: 3, power: 0.1 })
        const idx = (['cheekL', 'cheekR', 'noseTip'] as TargetName[])[
          Math.floor(Math.random() * 3)
        ]
        const uv = ctx.uvOf(idx)
        ctx.bust.bruises.mark('redness', uv.u, uv.v, 0.45)
        ctx.particles.emit('sweat', ctx.pointOf('foreheadTop'), V(0, 1, 0.6), 2, { speed: 1.3, size: 0.016 })
      }
    } else {
      this.releaseAge += dt
      if (this.releaseAge > 0.3) {
        ctx.hand('grab', 'a').visible = false
        ctx.hand('grab', 'b').visible = false
        this.done = true
      }
    }
  }

  private begin(ctx: AttackContext) {
    this.handle = ctx.field.add(
      {
        center: this.target,
        direction: V(0, 0, 0.07),
        radius: 0.3,
        kind: 'pinch',
        attack: 0.14,
        hold: 0,
        release: 0.4,
      },
      true,
    )
    this.stopSound = ctx.sfx.choke()
    ctx.shake.add(0.1)
  }

  onRelease(ctx: AttackContext) {
    if (!this.holding) return
    this.holding = false
    this.releaseAge = 0
    if (this.handle >= 0) {
      ctx.field.release(this.handle)
      this.handle = -1
    }
    this.stopSound?.()
    this.stopSound = null
    ctx.rig.hit(V(0, 0.1, 0.2), V(0.8, 0, 0), 0.05, 0.6)
    ctx.sfx.yelp(0.85)
  }
}

/* ------------------------------------------------------------------- spit */

/** No hand - a wad launched from the camera that splats a beat later. */
class SpitAttack extends Attack {
  readonly id: AttackId = 'spit'
  private landed = false
  private target = new THREE.Vector3()
  private readonly flight = 0.16

  update(dt: number, ctx: AttackContext) {
    if (this.elapsed === 0) {
      this.target.copy(ctx.pointOf('noseBridge'))
      // Just inside the near plane, so the wad flies in rather than popping
      // into existence behind the camera.
      const origin = this.target.clone().add(V(0, -0.35, 2.1))
      ctx.particles.emit('spit', origin, this.target.clone().sub(origin), 10, {
        speed: 14,
        spread: 0.12,
        size: 0.028,
        life: this.flight * 1.4,
        gravity: 1.2,
      })
      ctx.sfx.spit()
    }
    this.elapsed += dt

    if (!this.landed && this.elapsed >= this.flight) {
      this.landed = true
      this.splat(ctx)
    }
    if (this.elapsed > 0.6) this.done = true
  }

  private splat(ctx: AttackContext) {
    const at = this.target
    ctx.rig.hit(V(0, 0.02, -0.35), V(-0.5, 0, 0), -0.01, 0.35)
    ctx.field.add({
      center: at,
      direction: V(0, 0, -0.05),
      radius: 0.3,
      attack: 0.03,
      hold: 0.04,
      release: 0.4,
    })
    ctx.particles.emit('spit', at, V(0, 0.3, 1), 10, { speed: 1.4, spread: 1.3, size: 0.024, life: 1.2 })
    ctx.shake.add(0.1)
    ctx.hit({ damage: 4, power: 0.16 })
    // A wet decal that runs down the face rather than a bruise.
    ctx.bust.bruises.drip(ctx.uvOf('noseBridge'))
  }
}

/* ----------------------------------------------------------------- lookup */

let punchSide = 1

export function createAttack(id: AttackId): Attack {
  switch (id) {
    case 'punch':
      punchSide *= -1
      return new StrikeAttack(PUNCH, punchSide)
    case 'slapL':
      return new StrikeAttack(SLAP_L, -1)
    case 'slapR':
      return new StrikeAttack(SLAP_R, 1)
    case 'poke':
      return new StrikeAttack(POKE, 1)
    case 'pinch':
      return new PinchAttack()
    case 'choke':
      return new ChokeAttack()
    case 'spit':
      return new SpitAttack()
  }
}

/** Attacks that keep running while the key is held. */
export const SUSTAINED: ReadonlySet<AttackId> = new Set<AttackId>(['choke'])
