import { memo, useEffect, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'

type Props = {
  /**
   * 0 at the top of the page, 1 at the bottom.
   *
   * A ref rather than a prop value: scroll fires far more often than React
   * should be asked to re-render, and the only thing that needs the number is a
   * loop that already runs once a frame. Nothing above this ever repaints.
   */
  progress: MutableRefObject<number>
}

/** 90 rocks at 20 triangles each — the whole scene is under 2k. */
const SHARDS = 90
const EMBERS = 220

/** The tunnel the camera falls through. Shards are kept off the centre axis. */
const R_MIN = 2.5
const R_MAX = 8
const Z_NEAR = 5
const Z_FAR = -19

/** Deterministic, so the field looks the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * One jagged rock, reused for every shard.
 *
 * IcosahedronGeometry comes back non-indexed, so each corner exists once per
 * face it touches. Displacing by a hash of the position rather than by a fresh
 * random number keeps those copies in agreement — otherwise the faces tear
 * apart into confetti.
 */
function makeShardGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 0)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const h = hash3(Math.round(v.x * 1000), Math.round(v.y * 1000), Math.round(v.z * 1000))
    v.multiplyScalar(0.46 + h * 1.05)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

/**
 * A soft dot for the embers. Drawn at runtime because the brief forbids
 * external images, and square points read as dust rather than sparks.
 */
function makeEmberTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,240,214,1)')
  g.addColorStop(0.3, 'rgba(255,150,80,0.6)')
  g.addColorStop(1, 'rgba(255,93,71,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * The angry background: a tumbling field of dark shards lit hot from the side,
 * with embers climbing through it. Abstract on purpose — the moment it reads as
 * a body the page stops being a joke and starts being something else.
 *
 * Decorative, so it is `aria-hidden` and never takes pointer input.
 */
function LandingScene({ progress }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      // No WebGL. The copy is the product here; a missing backdrop is survivable.
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12
    renderer.setClearAlpha(0)
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // Matches --bg, so shards dissolve into the page rather than into a wall.
    const fog = new THREE.FogExp2(0x0b0d13, 0.05)
    scene.fog = fog

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 60)

    const ambient = new THREE.AmbientLight(0x2b3348, 0.5)
    // --accent, thrown across the field from one side; the shards are nearly
    // black otherwise and the red is the only thing carrying the mood.
    const keyLight = new THREE.DirectionalLight(0xff5d47, 2.4)
    keyLight.position.set(-5, 3.5, 4)
    // --accent-warm, close in, so shards passing the camera flare as they go by.
    const warm = new THREE.PointLight(0xffb648, 14, 24, 2)
    warm.position.set(3.6, -2.6, 1.5)
    const rim = new THREE.DirectionalLight(0x7f92ff, 0.42)
    rim.position.set(4, 2, -6)
    scene.add(ambient, keyLight, warm, rim)

    const field = new THREE.Group()
    scene.add(field)

    const shardGeo = makeShardGeometry()
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x141821,
      roughness: 0.6,
      metalness: 0.2,
      flatShading: true,
    })
    const shards = new THREE.InstancedMesh(shardGeo, shardMat, SHARDS)
    shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    shards.frustumCulled = false
    field.add(shards)

    const rand = rng(0x616e6772)
    const base = new Float32Array(SHARDS * 3)
    const axis = new Float32Array(SHARDS * 3)
    const spin = new Float32Array(SHARDS)
    const size = new Float32Array(SHARDS)
    const phase = new Float32Array(SHARDS)
    const tumble = new THREE.Vector3()

    for (let i = 0; i < SHARDS; i++) {
      const a = rand() * Math.PI * 2
      const r = R_MIN + rand() * (R_MAX - R_MIN)
      base[i * 3] = Math.cos(a) * r
      base[i * 3 + 1] = Math.sin(a) * r * 0.85
      base[i * 3 + 2] = Z_FAR + rand() * (Z_NEAR - Z_FAR)
      tumble.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize()
      axis[i * 3] = tumble.x
      axis[i * 3 + 1] = tumble.y
      axis[i * 3 + 2] = tumble.z
      spin[i] = (0.08 + rand() * 0.26) * (rand() < 0.5 ? -1 : 1)
      size[i] = 0.3 + rand() * 1.05
      phase[i] = rand() * Math.PI * 2
    }

    const emberPos = new Float32Array(EMBERS * 3)
    const emberSpeed = new Float32Array(EMBERS)
    const emberPhase = new Float32Array(EMBERS)
    for (let i = 0; i < EMBERS; i++) {
      const a = rand() * Math.PI * 2
      const r = 1.2 + rand() * 7
      emberPos[i * 3] = Math.cos(a) * r
      emberPos[i * 3 + 1] = -7 + rand() * 16
      emberPos[i * 3 + 2] = Z_FAR + rand() * (Z_NEAR - Z_FAR)
      emberSpeed[i] = 0.35 + rand() * 1.1
      emberPhase[i] = rand() * Math.PI * 2
    }
    const emberGeo = new THREE.BufferGeometry()
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3))
    const emberTex = makeEmberTexture()
    const emberMat = new THREE.PointsMaterial({
      color: 0xff8a4c,
      size: 0.13,
      map: emberTex ?? undefined,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
    const embers = new THREE.Points(emberGeo, emberMat)
    embers.frustumCulled = false
    scene.add(embers)

    const dummy = new THREE.Object3D()
    const quat = new THREE.Quaternion()
    const ax = new THREE.Vector3()

    /**
     * @param t seconds since mount, @param p eased scroll progress.
     * Split out from the loop so reduced motion can render exactly one frame of
     * it and then leave the GPU alone.
     */
    function draw(t: number, p: number, dt: number) {
      for (let i = 0; i < SHARDS; i++) {
        ax.fromArray(axis, i * 3)
        quat.setFromAxisAngle(ax, t * spin[i] + phase[i])
        dummy.position.set(
          base[i * 3],
          base[i * 3 + 1] + Math.sin(t * 0.3 + phase[i]) * 0.42,
          base[i * 3 + 2],
        )
        dummy.quaternion.copy(quat)
        dummy.scale.setScalar(size[i])
        dummy.updateMatrix()
        shards.setMatrixAt(i, dummy.matrix)
      }
      shards.instanceMatrix.needsUpdate = true

      if (dt > 0) {
        for (let i = 0; i < EMBERS; i++) {
          const y = emberPos[i * 3 + 1] + dt * emberSpeed[i]
          // Wrap rather than respawn: a fixed population means no allocation
          // and no visible seam as long as the band is taller than the frustum.
          emberPos[i * 3 + 1] = y > 9 ? -9 : y
          emberPos[i * 3] += Math.sin(t * 0.8 + emberPhase[i]) * dt * 0.22
        }
        emberGeo.attributes.position.needsUpdate = true
      }

      // The camera falls down the tunnel as the page scrolls — that, and not a
      // parallax fudge, is what ties the backdrop to the narrative.
      camera.position.set(Math.sin(p * 2.1) * 0.9, 0.8 - p * 1.9, Z_NEAR + 2 - p * 15)
      camera.lookAt(0, 0, camera.position.z - 6)
      camera.rotation.z = p * 0.22

      field.rotation.z = p * 0.7
      // Hottest through the middle of the page, where the moves are.
      keyLight.intensity = 1.5 + Math.sin(p * Math.PI) * 2.8 + Math.sin(t * 1.7) * 0.18
      warm.intensity = 9 + p * 16
      warm.position.z = camera.position.z - 2
      fog.density = 0.05 + p * 0.03

      renderer.render(scene, camera)
    }

    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()

    const clock = new THREE.Clock()
    let eased = 0

    if (reduce) {
      // One static frame, no loop, no scroll coupling. Held at the top of the
      // narrative so it reads as a still image rather than a paused animation.
      draw(0, 0, 0)
      const ro = new ResizeObserver(() => {
        resize()
        draw(0, 0, 0)
      })
      ro.observe(host)
      return () => {
        ro.disconnect()
        shards.dispose()
        shardGeo.dispose()
        shardMat.dispose()
        emberGeo.dispose()
        emberMat.dispose()
        emberTex?.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    }

    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05)
      // Chases the scroll position instead of tracking it, so a flick of the
      // wheel becomes a glide rather than a jump cut.
      eased += (progress.current - eased) * Math.min(1, dt * 5)
      draw(clock.elapsedTime, eased, dt)
    })

    const ro = new ResizeObserver(resize)
    ro.observe(host)

    return () => {
      renderer.setAnimationLoop(null)
      ro.disconnect()
      shards.dispose()
      shardGeo.dispose()
      shardMat.dispose()
      emberGeo.dispose()
      emberMat.dispose()
      emberTex?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [progress])

  return <div className="lp-bg" ref={hostRef} aria-hidden="true" />
}

/** The scene owns a WebGL context; nothing about a parent repaint should touch it. */
export default memo(LandingScene)
