import * as THREE from 'three'

/* ------------------------------------------------------------------ shake */

/**
 * Trauma-based shake: hits add trauma, trauma decays, and the actual offset is
 * trauma squared. Squaring means small hits barely register while big ones
 * really kick, which is what sells the difference between a poke and a punch.
 */
export class CameraShake {
  private trauma = 0
  private time = 0
  private readonly basePosition = new THREE.Vector3()
  private readonly baseQuaternion = new THREE.Quaternion()

  constructor(private camera: THREE.Camera) {
    this.basePosition.copy(camera.position)
    this.baseQuaternion.copy(camera.quaternion)
  }

  /** Call after moving the camera for other reasons. */
  rebase() {
    this.basePosition.copy(this.camera.position)
    this.baseQuaternion.copy(this.camera.quaternion)
  }

  add(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  update(dt: number) {
    this.time += dt
    this.trauma = Math.max(0, this.trauma - dt * 1.6)
    const s = this.trauma * this.trauma
    if (s <= 0.0001) {
      this.camera.position.copy(this.basePosition)
      this.camera.quaternion.copy(this.baseQuaternion)
      return
    }
    const t = this.time * 28
    const nx = Math.sin(t * 1.31) * Math.sin(t * 0.53)
    const ny = Math.sin(t * 1.77 + 1.7) * Math.sin(t * 0.61)
    const nr = Math.sin(t * 1.13 + 3.1) * Math.sin(t * 0.47)
    this.camera.position.copy(this.basePosition).add(new THREE.Vector3(nx * s * 0.18, ny * s * 0.15, 0))
    this.camera.quaternion.copy(this.baseQuaternion)
    this.camera.rotateZ(nr * s * 0.045)
  }

  reset() {
    this.trauma = 0
  }
}

/* -------------------------------------------------------------- particles */

const MAX_PARTICLES = 400

export type ParticleKind = 'sweat' | 'spit' | 'star' | 'dust'

const KIND_COLOR: Record<ParticleKind, THREE.Color> = {
  sweat: new THREE.Color('#bfe6ff'),
  spit: new THREE.Color('#dff3d8'),
  star: new THREE.Color('#ffd964'),
  dust: new THREE.Color('#cfc2b0'),
}

const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uPixelScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // aSize is a world-space diameter; uPixelScale converts it to pixels at
  // this distance. A hardcoded constant here gives 800px droplets.
  gl_PointSize = max(1.0, aSize * uPixelScale / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`

const PARTICLE_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float soft = smoothstep(0.5, 0.15, r);
  gl_FragColor = vec4(vColor, vAlpha * soft);
}
`

export class Particles {
  readonly points: THREE.Points
  private positions = new Float32Array(MAX_PARTICLES * 3)
  private colors = new Float32Array(MAX_PARTICLES * 3)
  private sizes = new Float32Array(MAX_PARTICLES)
  private alphas = new Float32Array(MAX_PARTICLES)
  private velocities = new Float32Array(MAX_PARTICLES * 3)
  private life = new Float32Array(MAX_PARTICLES)
  private maxLife = new Float32Array(MAX_PARTICLES)
  private drag = new Float32Array(MAX_PARTICLES)
  private gravity = new Float32Array(MAX_PARTICLES)
  private cursor = 0
  private geometry: THREE.BufferGeometry
  private uPixelScale = { value: 800 }

  /** Keeps particle sizes physically consistent across viewport changes. */
  setViewport(heightPx: number, fovDegrees: number) {
    this.uPixelScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2))
  }

  constructor() {
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3))
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    // The bounding sphere would otherwise be recomputed from dead particles.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50)

    const material = new THREE.ShaderMaterial({
      uniforms: { uPixelScale: this.uPixelScale },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
    this.points = new THREE.Points(this.geometry, material)
    this.points.frustumCulled = false
  }

  emit(
    kind: ParticleKind,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    count: number,
    opts: { speed?: number; spread?: number; size?: number; life?: number; gravity?: number } = {},
  ) {
    const speed = opts.speed ?? 2
    const spread = opts.spread ?? 0.7
    /** World-space diameter, in head-heights. */
    const size = opts.size ?? 0.02
    const life = opts.life ?? 0.9
    const gravity = opts.gravity ?? 4
    const color = KIND_COLOR[kind]

    for (let n = 0; n < count; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % MAX_PARTICLES

      this.positions[i * 3] = origin.x + (Math.random() - 0.5) * 0.05
      this.positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.05
      this.positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.05

      const v = direction
        .clone()
        .normalize()
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
          ),
        )
        .multiplyScalar(speed * (0.6 + Math.random() * 0.8))
      this.velocities[i * 3] = v.x
      this.velocities[i * 3 + 1] = v.y
      this.velocities[i * 3 + 2] = v.z

      this.colors[i * 3] = color.r
      this.colors[i * 3 + 1] = color.g
      this.colors[i * 3 + 2] = color.b
      this.sizes[i] = size * (0.6 + Math.random() * 0.8)
      this.alphas[i] = 1
      this.maxLife[i] = life * (0.7 + Math.random() * 0.6)
      this.life[i] = this.maxLife[i]
      this.drag[i] = 1.8 + Math.random()
      this.gravity[i] = gravity
    }
  }

  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) {
        if (this.alphas[i] !== 0) this.alphas[i] = 0
        continue
      }
      this.life[i] -= dt
      const damp = Math.exp(-this.drag[i] * dt)
      this.velocities[i * 3] *= damp
      this.velocities[i * 3 + 1] = this.velocities[i * 3 + 1] * damp - this.gravity[i] * dt
      this.velocities[i * 3 + 2] *= damp
      this.positions[i * 3] += this.velocities[i * 3] * dt
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt
      this.alphas[i] = Math.max(0, this.life[i] / this.maxLife[i])
    }
    this.geometry.getAttribute('position').needsUpdate = true
    this.geometry.getAttribute('aColor').needsUpdate = true
    this.geometry.getAttribute('aSize').needsUpdate = true
    this.geometry.getAttribute('aAlpha').needsUpdate = true
  }

  clear() {
    this.life.fill(0)
    this.alphas.fill(0)
    this.geometry.getAttribute('aAlpha').needsUpdate = true
  }
}

/* ------------------------------------------------------------------ flash */

let glowTexture: THREE.CanvasTexture | null = null

/** A soft radial falloff. Without it an additive quad reads as a lit square. */
function glow(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  glowTexture = new THREE.CanvasTexture(canvas)
  glowTexture.colorSpace = THREE.SRGBColorSpace
  return glowTexture
}

/** A short additive bloom at the point of contact. */
export class ImpactFlash {
  readonly group = new THREE.Group()
  private pool: { sprite: THREE.Sprite; age: number; peak: number }[] = []

  spawn(position: THREE.Vector3, size = 0.4, color = '#fff3c4') {
    const material = new THREE.SpriteMaterial({
      map: glow(),
      color: new THREE.Color(color),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0.75,
    })
    const sprite = new THREE.Sprite(material)
    sprite.position.copy(position)
    sprite.renderOrder = 9
    this.group.add(sprite)
    this.pool.push({ sprite, age: 0, peak: size })
  }

  update(dt: number, _camera: THREE.Camera) {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const f = this.pool[i]
      f.age += dt
      const t = f.age / 0.22
      if (t >= 1) {
        this.group.remove(f.sprite)
        f.sprite.material.dispose()
        this.pool.splice(i, 1)
        continue
      }
      const s = f.peak * (0.5 + t * 0.8)
      f.sprite.scale.set(s, s, 1)
      f.sprite.material.opacity = (1 - t) * 0.75
    }
  }

  clear() {
    for (const f of this.pool) {
      this.group.remove(f.sprite)
      f.sprite.material.dispose()
    }
    this.pool.length = 0
  }
}
