import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildFace, HEAD_HEIGHT, NoFaceError, type FaceRig } from './faceBuilder'
import { buildBust, type Bust } from './bust'
import { DeformField } from './deform'
import { HeadRig } from './springs'
import { CameraShake, ImpactFlash, Particles } from './fx'
import { makeHand, type Hand, type HandKind } from './hands'
import { loadHandPieces, makeModelHand } from './handModel'
import { LM } from './landmarks'
import { MAX_TAUNT, randomTauntColour, Taunts } from './taunt'
import { attachGestures } from './gestures'
import { buildDummyRig } from './dummy'
import { defaultLook, type Look } from './look'

/** The dummy generator wants colours; the look carries hex strings. */
const tonesFor = (look: Look) => ({
  skin: new THREE.Color(look.skinColor),
  hair: new THREE.Color(look.hairColor),
  clothing: new THREE.Color(look.outfitColor),
})
import { sfx } from './audio'
import {
  Attack,
  ATTACK_LIST,
  createAttack,
  SUSTAINED,
  type AttackContext,
  type AttackId,
  type TargetName,
} from './attacks'

export type GameStatus = 'empty' | 'loading' | 'playing' | 'error'


export type GameStats = {
  pain: number
  combo: number
  bestCombo: number
  hits: number
}

export type LightId = 'key' | 'fill' | 'rim'

/** Spherical placement around the bust, so the UI can drag lights around it. */
export type LightState = {
  /** Degrees. 0 is straight in front of the bust, positive swings to its left. */
  azimuth: number
  /** Degrees. Positive is above. */
  elevation: number
  intensity: number
  color: string
}

export const LIGHT_DEFAULTS: Record<LightId, LightState> = {
  key: { azimuth: 32, elevation: 28, intensity: 2.6, color: '#fff1e0' },
  fill: { azimuth: -46, elevation: -8, intensity: 0.5, color: '#ffd9b0' },
  rim: { azimuth: -145, elevation: 22, intensity: 1.5, color: '#5f7cff' },
}

export type GameEvents = {
  onStatus(status: GameStatus, message?: string): void
  onStats(stats: GameStats): void
  /** 0..1, for the HUD's impact flash. */
  onHit(power: number): void
}

const KEY_MAP = new Map<string, AttackId>(ATTACK_LIST.map((a) => [a.key.toLowerCase(), a.id]))

const PHYSICS_STEP = 1 / 120
const COMBO_TIMEOUT = 1.7

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private clock = new THREE.Clock()
  private accumulator = 0
  private time = 0
  private frame = 0

  private field = new DeformField()
  private rig = new HeadRig()
  private particles = new Particles()
  private flash = new ImpactFlash()
  private shake: CameraShake

  private handCache = new Map<string, Hand>()
  /** Null until fetched, and stays null if the scan can't be loaded. */
  private handPieces: THREE.BufferGeometry[] | null = null
  /** Undefined on the plain photo path, where the photo's own tones are used. */
  private look: Look | undefined
  /** Whether the current target is generated rather than reconstructed. */
  private onDummy = false
  private handRoot = new THREE.Group()
  private taunts = new Taunts()
  private detachGestures: () => void = () => {}
  private lights = {} as Record<LightId, THREE.DirectionalLight>
  private lightStates = {} as Record<LightId, LightState>

  private bust: Bust | null = null
  private faceRig: FaceRig | null = null
  private active = new Map<AttackId, Attack>()
  private held = new Set<AttackId>()

  private stats: GameStats = { pain: 0, combo: 0, bestCombo: 0, hits: 0 }
  private comboTimer = 0
  private voiceCooldown = 0
  private lastPush = 0
  private disposed = false
  private resizeObserver: ResizeObserver

  constructor(
    private container: HTMLElement,
    private events: GameEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    this.camera.position.set(0, 0.02, 3.3)
    this.camera.lookAt(0, -0.04, 0)
    this.shake = new CameraShake(this.camera)

    this.buildStage()
    this.scene.add(this.handRoot, this.particles.points, this.flash.group, this.taunts.group)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.releaseAll)

    // Touch goes straight on the canvas. `inputEnabled` gates it for the same
    // reason it gates the keys: an overlay is up and the stage is not in play.
    this.detachGestures = attachGestures(this.renderer.domElement, {
      screenOf: (name) => (this.inputEnabled ? this.screenOf(name) : null),
      trigger: (id) => this.inputEnabled && this.trigger(id),
      release: (id) => this.release(id),
    })

    this.renderer.setAnimationLoop(this.tick)
    this.events.onStatus('empty')
  }

  /* ------------------------------------------------------------- staging */

  private buildStage() {
    this.scene.background = new THREE.Color('#12141c')

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.55
    pmrem.dispose()

    for (const id of ['key', 'fill', 'rim'] as LightId[]) {
      const state = { ...LIGHT_DEFAULTS[id] }
      const light = new THREE.DirectionalLight(state.color, state.intensity)
      if (id === 'key') {
        light.castShadow = true
        light.shadow.mapSize.set(1024, 1024)
        light.shadow.camera.near = 0.5
        light.shadow.camera.far = 12
        light.shadow.camera.left = -3
        light.shadow.camera.right = 3
        light.shadow.camera.top = 3
        light.shadow.camera.bottom = -3
        light.shadow.bias = -0.0012
        light.shadow.normalBias = 0.02
      }
      this.lights[id] = light
      this.lightStates[id] = state
      this.scene.add(light)
      this.applyLight(id)
    }

    // A dark floor to catch the shadow and give the bust somewhere to stand.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: '#0d0f16', roughness: 1, metalness: 0 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -HEAD_HEIGHT * 2.6
    floor.receiveShadow = true
    this.scene.add(floor)
  }

  /** Places a light on a sphere around the bust from its azimuth/elevation. */
  private applyLight(id: LightId) {
    const state = this.lightStates[id]
    const light = this.lights[id]
    const az = THREE.MathUtils.degToRad(state.azimuth)
    const el = THREE.MathUtils.degToRad(state.elevation)
    const radius = 4.2
    light.position.set(
      Math.sin(az) * Math.cos(el) * radius,
      Math.sin(el) * radius,
      Math.cos(az) * Math.cos(el) * radius,
    )
    light.target.position.set(0, 0, 0)
    light.target.updateMatrixWorld()
    light.intensity = state.intensity
    light.color.set(state.color)
    // The hair's anisotropic sheen is lit by hand rather than through three's
    // light loop, so it has to be told where the key light went.
    if (id === 'key' && this.bust) {
      this.bust.hairUniforms.uHairLightDir.value.copy(light.position).normalize()
      this.bust.hairUniforms.uHairLightColor.value.set(state.color).multiplyScalar(
        THREE.MathUtils.clamp(state.intensity / 2.6, 0, 2),
      )
    }
  }

  /**
   * Nudges the key and fill toward the photo's own colour cast so the
   * procedurally generated body doesn't look lit by a different sun than the
   * face texture. Only a partial blend - going all the way throws away the
   * warm/cool separation that gives the bust its shape.
   */
  private matchLightingTo(ambient: THREE.Color) {
    // Normalise brightness out; we want the hue cast, not the exposure.
    const level = Math.max(0.08, (ambient.r + ambient.g + ambient.b) / 3)
    const cast = ambient.clone().multiplyScalar(1 / level)
    for (const id of ['key', 'fill'] as LightId[]) {
      const base = new THREE.Color(LIGHT_DEFAULTS[id].color)
      const tinted = base.clone().lerp(base.clone().multiply(cast), 0.45)
      this.lightStates[id].color = `#${tinted.getHexString()}`
      this.applyLight(id)
    }
  }

  getLights(): Record<LightId, LightState> {
    return {
      key: { ...this.lightStates.key },
      fill: { ...this.lightStates.fill },
      rim: { ...this.lightStates.rim },
    }
  }

  setLight(id: LightId, patch: Partial<LightState>) {
    Object.assign(this.lightStates[id], patch)
    this.applyLight(id)
  }

  resetLights() {
    for (const id of ['key', 'fill', 'rim'] as LightId[]) {
      this.lightStates[id] = { ...LIGHT_DEFAULTS[id] }
      this.applyLight(id)
    }
  }

  private resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // On portrait screens, back off so the shoulders still fit horizontally.
    const portrait = Math.max(0, 1 - this.camera.aspect)
    this.camera.position.z = 3.3 + portrait * 2.6
    this.camera.updateProjectionMatrix()
    this.particles.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov)
    this.shake.rebase()
  }

  /**
   * A verbal attack: the player's own words, thrown at the head.
   *
   * Damage scales with length but flattens quickly - a long insult should be
   * worth more than "oi" without turning the box into a damage exploit for
   * whoever can paste the most text.
   */
  taunt(text: string) {
    const trimmed = text.trim().slice(0, MAX_TAUNT)
    if (!trimmed || !this.bust || !this.faceRig) return
    void sfx.resume()

    const at = this.pointOf('noseBridge')
    const colour = randomTauntColour()
    const power = THREE.MathUtils.clamp(0.35 + trimmed.length / 40, 0.35, 1)

    this.taunts.spawn(trimmed, at, colour, () => {
      // Words rock the head back rather than denting it: there is no contact
      // point, so a directional dent would be inventing one.
      this.rig.hit(
        new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.12, -0.85 * power),
        new THREE.Vector3(-1.5 * power, (Math.random() - 0.5) * 1.6, 0),
        -0.02,
        0.5 * power,
      )
      this.shake.add(0.16 * power)
      this.flash.spawn(at.clone().setZ(at.z + 0.25), 0.34 * power, colour)
      this.particles.emit('star', at, new THREE.Vector3(0, 0.9, 1.1), 7, {
        speed: 2.6,
        spread: 1.4,
        size: 0.03,
        life: 0.7,
      })
      // Being spoken to like that flushes the face; it doesn't bruise it.
      for (const name of ['cheekL', 'cheekR'] as const) {
        const uv = this.uvOf(name)
        this.bust?.bruises.mark('redness', uv.u, uv.v, 0.4 * power)
      }
      this.hit({ damage: 3 + 7 * power, power: 0.3 * power })
    })
  }

  /* --------------------------------------------------------------- target */

  /**
   * Puts a generated dummy on the stage. No photo, no face detection, no
   * network - so this is also the fallback whenever a photo can't be used.
   */
  async loadDummy(look?: Look) {
    this.events.onStatus('loading')
    try {
      this.look = look ?? defaultLook()
      this.onDummy = true
      this.rebuild(buildDummyRig(tonesFor(this.look)))
      // Deliberately not awaited. The scanned hands are 5.6MB and aren't needed
      // until something is thrown, so the dummy appears immediately and the
      // procedural rig covers anything that lands before they arrive.
      void this.loadHands()
      this.events.onStatus('playing')
    } catch (err) {
      this.events.onStatus(
        'error',
        err instanceof Error ? err.message : 'Something went wrong building the dummy.',
      )
    }
  }

  /**
   * Rebuilds the target with a new look, keeping the photo rig if there is one.
   *
   * The customiser calls this on every click, so it has to be cheap enough to
   * feel immediate. It isn't incremental - the whole bust is regenerated - but
   * hair and clothing are generated geometry, and there's no meaningful way to
   * edit a hairstyle in place that isn't just building it again.
   */
  updateLook(look: Look) {
    const previous = this.look
    this.look = look
    if (!this.faceRig || !this.bust) return

    // Colour is a uniform; style and garment are geometry. Dragging a colour
    // picker fires continuously, and rebuilding a head of hair per frame to
    // change its tint would make the control feel broken.
    if (previous && previous.hair === look.hair && previous.outfit === look.outfit) {
      this.bust.recolour(look)
      return
    }
    this.rebuild(this.onDummy ? buildDummyRig(tonesFor(look)) : this.faceRig)
  }

  /** Swaps in a rig, preserving nothing - damage and score reset with it. */
  private rebuild(rig: FaceRig) {
    this.teardownBust()
    this.faceRig = rig
    this.bust = buildBust(rig, this.field, this.look)
    this.scene.add(this.bust.root)
    this.applyLight('key')
    this.resetStats()
  }

  async loadPhoto(source: File | Blob | string) {
    this.events.onStatus('loading')
    try {
      const url = typeof source === 'string' ? source : URL.createObjectURL(source)
      try {
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.src = url
        await image.decode()

        // The scanned hands are fetched alongside the face rather than after
        // it: both are slow, neither needs the other, and hands built before
        // the pieces arrive would be cached as procedural for the session.
        const [rig] = await Promise.all([buildFace(image), this.loadHands()])
        this.onDummy = false
        // Through rebuild, so the chosen look rides along. A photo replaces the
        // face, not the haircut and not the clothes - those were picked before
        // the upload and throwing them away here was the bug.
        this.rebuild(rig)
        this.matchLightingTo(rig.ambientTone)
        // The bust didn't exist when the lights were first placed.
        this.applyLight('key')
        this.events.onStatus('playing')
      } finally {
        if (typeof source !== 'string') URL.revokeObjectURL(url)
      }
    } catch (err) {
      const message =
        err instanceof NoFaceError
          ? "Couldn't find a face in that photo. Try one that's front-on and well lit."
          : err instanceof Error
            ? err.message
            : 'Something went wrong loading that photo.'
      this.events.onStatus('error', message)
    }
  }

  private teardownBust() {
    for (const attack of this.active.values()) attack.cancel(this.context())
    this.active.clear()
    this.held.clear()
    for (const hand of this.handCache.values()) hand.visible = false
    this.field.clear()
    this.rig.reset()
    this.particles.clear()
    this.flash.clear()
    this.taunts.clear()
    if (this.bust) {
      this.scene.remove(this.bust.root)
      this.bust.dispose()
      this.bust = null
    }
    this.faceRig = null
  }

  hasBust() {
    return !!this.bust
  }

  reset() {
    if (!this.bust) return
    for (const attack of this.active.values()) attack.cancel(this.context())
    this.active.clear()
    this.held.clear()
    for (const hand of this.handCache.values()) hand.visible = false
    this.field.clear()
    this.rig.reset()
    this.particles.clear()
    this.flash.clear()
    this.taunts.clear()
    this.shake.reset()
    this.bust.bruises.clear()
    this.field.heal()
    this.resetStats()
  }

  private resetStats() {
    this.stats = { pain: 0, combo: 0, bestCombo: 0, hits: 0 }
    this.comboTimer = 0
    this.voiceCooldown = 0
    this.pushStats(true)
  }

  /* --------------------------------------------------------------- input */

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

    const id = KEY_MAP.get(event.key.toLowerCase())
    if (!id || !this.inputEnabled) return
    // Only swallow the key once we're sure we're acting on it, so an overlay
    // that's up can still receive whatever the player is typing.
    event.preventDefault()
    if (event.repeat) return
    this.trigger(id)
  }

  private onKeyUp = (event: KeyboardEvent) => {
    const id = KEY_MAP.get(event.key.toLowerCase())
    if (!id) return
    this.held.delete(id)
    if (SUSTAINED.has(id)) this.active.get(id)?.onRelease(this.context())
  }

  private releaseAll = () => {
    for (const id of this.held) {
      if (SUSTAINED.has(id)) this.active.get(id)?.onRelease(this.context())
    }
    this.held.clear()
  }

  /** Turned off while an overlay is up, so typing doesn't punch through it. */
  inputEnabled = true

  /** Public so the HUD's on-screen buttons can drive the same code path. */
  trigger(id: AttackId) {
    if (!this.bust || !this.inputEnabled) return
    void sfx.resume()

    const current = this.active.get(id)
    if (current && !current.done) {
      if (!current.retriggerable) return
      current.cancel(this.context())
    }
    this.held.add(id)
    this.active.set(id, createAttack(id))
  }

  /** Matches trigger() for pointer input on touch devices. */
  release(id: AttackId) {
    this.held.delete(id)
    if (SUSTAINED.has(id)) this.active.get(id)?.onRelease(this.context())
  }

  /* ------------------------------------------------------------- context */

  /**
   * Fetches the scanned hand pieces once. A failure here is not fatal - the
   * procedural rig is a complete implementation of the same interface, so the
   * game simply runs with it instead.
   */
  private async loadHands() {
    if (this.handPieces) return
    try {
      this.handPieces = await loadHandPieces()
    } catch {
      console.warn('[gigil] scanned hands unavailable, using the procedural rig')
      this.handPieces = null
    }
  }

  private hand = (kind: HandKind, slot: 'a' | 'b' = 'a'): Hand => {
    const key = `${kind}:${slot}`
    let hand = this.handCache.get(key)
    if (!hand) {
      const opts = { mirror: slot === 'b', scale: HEAD_HEIGHT * 0.42 }
      hand = this.handPieces
        ? makeModelHand(kind, this.handPieces, opts)
        : makeHand(kind, opts)
      this.handRoot.add(hand)
      this.handCache.set(key, hand)
    }
    return hand
  }

  private scratch = new THREE.Vector3()
  private project = new THREE.Vector3()

  /**
   * Where a named target currently is on screen, in CSS pixels.
   *
   * Taken through the head's world matrix rather than from the rest pose,
   * because the head is recoiling constantly - aiming a poke at where the eye
   * was before the last punch would miss by half a face.
   */
  private screenOf = (name: TargetName) => {
    if (!this.bust) return null
    this.bust.head.updateWorldMatrix(true, false)
    this.project.copy(this.pointOf(name)).applyMatrix4(this.bust.head.matrixWorld)
    this.project.project(this.camera)
    if (this.project.z > 1) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    return {
      x: ((this.project.x + 1) / 2) * rect.width,
      y: ((1 - this.project.y) / 2) * rect.height,
    }
  }

  /**
   * Resolves a named target against the current head.
   *
   * The MediaPipe vertex numbers stop here rather than travelling out into the
   * attacks, so a head that has no landmarks - a generated dummy - only has to
   * answer the same nine names to be punchable.
   */
  private pointOf = (name: TargetName): THREE.Vector3 => {
    const index = LM[name]
    const attr = this.faceRig?.geometry.getAttribute('position')
    if (!attr || index >= attr.count) return this.scratch.set(0, 0, 0)
    return this.scratch.fromBufferAttribute(attr as THREE.BufferAttribute, index).clone()
  }

  private uvOf = (name: TargetName) => {
    const index = LM[name]
    const attr = this.faceRig?.geometry.getAttribute('uv')
    if (!attr || index >= attr.count) return { u: 0.5, v: 0.5 }
    return { u: attr.getX(index), v: attr.getY(index) }
  }

  private hit = (info: { damage: number; power: number }) => {
    this.stats.hits += 1
    this.stats.pain = Math.min(100, this.stats.pain + info.damage)
    this.stats.combo += 1
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.stats.combo)
    this.comboTimer = COMBO_TIMEOUT
    if (this.stats.combo > 1) sfx.comboBlip(this.stats.combo - 2)
    this.speak()
    this.events.onHit(Math.min(1, info.power))
    this.pushStats(true)
  }

  /**
   * Whether the head says anything, and what.
   *
   * The reflex yelp already fires on every single hit - that belongs to the
   * attack. Words are rationed on top of it, because something that talks on
   * every frame of a combo stops being funny in about four seconds. What comes
   * out climbs with the damage, and once they're nearly finished they stop
   * forming words at all.
   */
  private speak() {
    if (this.voiceCooldown > 0 || !sfx.voiceIdle) return
    const pain = this.stats.pain

    // Damage maps straight onto which clips are eligible - short exclamations
    // early, longer ones as they wear down. The audio side owns the banding,
    // so adding a recording needs no change here.
    const intensity = Math.min(1, pain / 90)
    // Strain climbs with the damage, so the voice tightens as they wear down.
    const spoken = sfx.voice(intensity, 0.95 + pain / 260 + Math.random() * 0.1)
    // A long utterance buys a correspondingly long silence after it. If nothing
    // played - muted, or something else still talking - retry again shortly.
    this.voiceCooldown = spoken > 0 ? 1.2 + spoken + Math.random() * 0.9 : 0.4
  }

  private cachedContext: AttackContext | null = null

  private context(): AttackContext {
    if (!this.cachedContext) {
      this.cachedContext = {
        bust: this.bust!,
        rig: this.rig,
        field: this.field,
        particles: this.particles,
        flash: this.flash,
        shake: this.shake,
        sfx,
        hand: this.hand,
        pointOf: this.pointOf,
        uvOf: this.uvOf,
        hit: this.hit,
      }
    }
    // The bust is swapped out on every new photo, so keep the reference fresh.
    this.cachedContext.bust = this.bust!
    return this.cachedContext
  }

  /* ---------------------------------------------------------------- loop */

  private pushStats(force = false) {
    const now = performance.now()
    if (!force && now - this.lastPush < 80) return
    this.lastPush = now
    this.events.onStats({ ...this.stats })
  }

  private tick = () => {
    if (this.disposed) return
    const dt = Math.min(this.clock.getDelta(), 0.1)
    this.time += dt
    this.frame += 1

    if (this.bust) {
      const ctx = this.context()
      for (const [id, attack] of this.active) {
        attack.update(dt, ctx)
        if (attack.done) this.active.delete(id)
      }

      // Fixed-step the springs so a slow frame can't make the head explode.
      this.accumulator += dt
      let steps = 0
      while (this.accumulator >= PHYSICS_STEP && steps < 8) {
        this.rig.update(PHYSICS_STEP)
        this.accumulator -= PHYSICS_STEP
        steps += 1
      }

      this.rig.applyTo(this.bust.neckPivot, this.bust.head, this.bust.torso)
      // Idle life: a slow breath and sway on top of whatever the springs did.
      this.bust.neckPivot.position.y += Math.sin(this.time * 1.5) * 0.006
      this.bust.neckPivot.rotation.y += Math.sin(this.time * 0.63) * 0.03
      this.bust.neckPivot.rotation.x += Math.sin(this.time * 1.07 + 2) * 0.012

      this.field.update(dt, this.rig.wobble)
      this.bust.bruises.update(dt)

      if (this.voiceCooldown > 0) this.voiceCooldown -= dt
      if (this.comboTimer > 0) {
        this.comboTimer -= dt
        if (this.comboTimer <= 0 && this.stats.combo !== 0) {
          this.stats.combo = 0
          this.pushStats(true)
        }
      }
      if (this.stats.pain > 0) {
        this.stats.pain = Math.max(0, this.stats.pain - dt * 3.5)
        this.pushStats()
      }
    }

    this.particles.update(dt)
    this.taunts.update(dt)
    this.flash.update(dt, this.camera)
    this.shake.update(dt)

    this.renderer.render(this.scene, this.camera)
  }

  setMuted(muted: boolean) {
    sfx.setMuted(muted)
  }

  dispose() {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.releaseAll)
    this.detachGestures()
    this.resizeObserver.disconnect()
    this.teardownBust()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
