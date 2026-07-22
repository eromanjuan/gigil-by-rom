import * as THREE from 'three'

const tmp = new THREE.Vector3()

/** Critically-ish damped spring pulling a vector back to rest. */
export class Spring3 {
  readonly value = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()

  constructor(
    public stiffness: number,
    public damping: number,
  ) {}

  impulse(v: THREE.Vector3) {
    this.velocity.add(v)
  }

  update(dt: number) {
    tmp.copy(this.value).multiplyScalar(-this.stiffness).addScaledVector(this.velocity, -this.damping)
    this.velocity.addScaledVector(tmp, dt)
    this.value.addScaledVector(this.velocity, dt)
  }

  /**
   * The same spring, but pulled toward a fraction of `target` instead of back
   * to the origin. Used to make one part chase another: the chaser lags by its
   * own period and only ever reproduces `scale` of the travel.
   */
  towards(target: THREE.Vector3, scale: number, dt: number) {
    tmp
      .copy(target)
      .multiplyScalar(scale)
      .sub(this.value)
      .multiplyScalar(this.stiffness)
      .addScaledVector(this.velocity, -this.damping)
    this.velocity.addScaledVector(tmp, dt)
    this.value.addScaledVector(this.velocity, dt)
  }

  reset() {
    this.value.set(0, 0, 0)
    this.velocity.set(0, 0, 0)
  }
}

/** Scalar version, for squash-and-stretch. */
export class Spring1 {
  value = 0
  velocity = 0

  constructor(
    public stiffness: number,
    public damping: number,
  ) {}

  impulse(v: number) {
    this.velocity += v
  }

  update(dt: number) {
    const accel = -this.stiffness * this.value - this.damping * this.velocity
    this.velocity += accel * dt
    this.value += this.velocity * dt
  }

  reset() {
    this.value = 0
    this.velocity = 0
  }
}

/**
 * The head's whole-body response to a hit: it recoils, it twists on the neck,
 * and it squashes. Springs rather than rigid bodies because the timing here is
 * a game-feel decision, not a simulation result.
 */
export class HeadRig {
  /** Positional recoil, in head-height units. */
  readonly offset = new Spring3(190, 13)
  /** Neck twist as XYZ euler radians. */
  readonly tilt = new Spring3(130, 8.5)
  /** >0 stretches vertically, <0 squashes. */
  readonly squash = new Spring1(210, 11)
  /** Post-impact jelly ripple, decays on its own. */
  wobble = 0

  /**
   * The body's follow-through. Softer and slower than the head's own springs,
   * so the shoulders arrive late and never travel as far - which is the whole
   * of what reads as the head being light and the body being heavy.
   *
   * These chase where the head has actually got to rather than taking the
   * impulse themselves, so anything that moves the head drags the body after
   * it: a punch, a throttle shaking it, a nose being wrung. None of those need
   * to know the body exists.
   */
  readonly bodyOffset = new Spring3(62, 9)
  readonly bodyTilt = new Spring3(46, 8.5)

  update(dt: number) {
    this.offset.update(dt)
    this.tilt.update(dt)
    this.squash.update(dt)
    // The body reproduces about half the head's travel and a third of its
    // lean. The lean is worth more than it looks: the torso pivots at the
    // waist, so a third of a small angle still swings the shoulders a long
    // way, and it carries the head with it.
    this.bodyOffset.towards(this.offset.value, 0.55, dt)
    this.bodyTilt.towards(this.tilt.value, 0.34, dt)
    this.wobble *= Math.exp(-7 * dt)
  }

  /** A hit: linear knock, neck torque, squash, and a ripple through the flesh. */
  hit(knock: THREE.Vector3, torque: THREE.Vector3, squash: number, wobble: number) {
    this.offset.impulse(knock)
    this.tilt.impulse(torque)
    this.squash.impulse(squash)
    this.wobble = Math.min(1, this.wobble + wobble)
  }

  /**
   * Recoil and twist go on the neck pivot; squash goes on the head itself so
   * it deforms about its own centre rather than pivoting from the collar.
   *
   * `body` is the torso, which the neck pivot now hangs off. Because the head
   * rides the body, the body's travel has to be taken back out of the head's -
   * otherwise a punch moves the head by the sum of the two and the recoil
   * doubles. Subtracting the tilt component-wise isn't a correct composition
   * of rotations, but these are a few degrees and the tilt was already a naive
   * euler.
   */
  applyTo(pivot: THREE.Object3D, squashTarget: THREE.Object3D = pivot, body?: THREE.Object3D) {
    if (body) {
      // The body's origin is its waist pivot, which is nowhere near zero, so
      // the spring's travel is added to that rest position rather than
      // replacing it.
      const rest = body.userData.rest as THREE.Vector3 | undefined
      if (rest) body.position.copy(rest).add(this.bodyOffset.value)
      else body.position.copy(this.bodyOffset.value)
      body.rotation.set(this.bodyTilt.value.x, this.bodyTilt.value.y, this.bodyTilt.value.z)
      pivot.position.subVectors(this.offset.value, this.bodyOffset.value)
      pivot.rotation.set(
        this.tilt.value.x - this.bodyTilt.value.x,
        this.tilt.value.y - this.bodyTilt.value.y,
        this.tilt.value.z - this.bodyTilt.value.z,
      )
    } else {
      pivot.position.copy(this.offset.value)
      pivot.rotation.set(this.tilt.value.x, this.tilt.value.y, this.tilt.value.z)
    }
    const s = this.squash.value
    squashTarget.scale.set(1 - s * 0.55, 1 + s, 1 - s * 0.55)
  }

  reset() {
    this.offset.reset()
    this.tilt.reset()
    this.squash.reset()
    this.bodyOffset.reset()
    this.bodyTilt.reset()
    this.wobble = 0
  }
}
