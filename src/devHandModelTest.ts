/**
 * Dev-only inspector for the scanned hand GLB, at /hand-model-test.html.
 *
 * hand.glb holds six separate hands in six poses, laid out side by side like a
 * product sheet. Attacks pick a pose per move, so the one thing that has to be
 * established is which piece index is which pose - and that's a question for
 * eyes, not for cluster analysis. This lays every piece out in its own slot
 * with its index over it, already canonicalised into the rig's frame (wrist at
 * the origin, fingers down -Z, palm up +Y) so what's drawn here is exactly
 * what the game will place.
 *
 * Not part of the game bundle.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { loadHandPieces } from './game/handModel'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#14171f')
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.9

const key = new THREE.DirectionalLight('#fff1e0', 2.2)
key.position.set(2, 3, 4)
const rim = new THREE.DirectionalLight('#7f92ff', 1)
rim.position.set(-3, 1, -2)
scene.add(key, rim, new THREE.GridHelper(24, 24, '#2a3040', '#1c212c'))

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 200)
camera.position.set(0, 3.4, 9.5)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.4, 0)

const hud = document.createElement('pre')
hud.style.cssText =
  'position:fixed;top:0;left:0;margin:0;padding:10px 14px;color:#cfd6e4;' +
  'font:12px/1.6 ui-monospace,monospace;background:rgba(0,0,0,.6);white-space:pre'
hud.textContent = 'loading hand.glb…'
document.body.appendChild(hud)

function label(text: string, x: number, y: number, size = 3) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffd7a8'
  ctx.font = '700 92px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 64)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
  sprite.position.set(x, y, 0)
  sprite.scale.set(size, size / 2, 1)
  scene.add(sprite)
}

loadHandPieces()
  .then((pieces) => {
    hud.textContent =
      `hand.glb -> ${pieces.length} pieces\n` +
      'Canonicalised: wrist at origin, fingers toward the viewer.\n' +
      'In use: 1=punch  2=poke  0=slap (mirrored pair)  5=pinch  4=strangle (pair)\n' +
      'drag to orbit · scroll to zoom'

    const COLS = 3
    const SPACING_X = 3.2
    const SPACING_Y = 3.0
    pieces.forEach((geometry, i) => {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const x = (col - (COLS - 1) / 2) * SPACING_X
      const y = -row * SPACING_Y + 1.2

      const material =
        (geometry.userData.material as THREE.Material | undefined) ??
        new THREE.MeshStandardMaterial({ color: '#e6bdae', roughness: 0.75 })
      const mesh = new THREE.Mesh(geometry, material)
      // Turn the fingers toward the camera so the pose is legible at a glance.
      mesh.rotation.set(-0.5, 0, 0)
      mesh.position.set(x, y, 0)
      scene.add(mesh)

      label(String(i), x, y + 1.35)
      const axes = new THREE.AxesHelper(0.7)
      axes.position.set(x, y, 0)
      scene.add(axes)
    })
  })
  .catch((err) => {
    hud.textContent = `FAILED: ${String(err?.message ?? err)}`
  })

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
})

renderer.setAnimationLoop(() => {
  controls.update()
  renderer.render(scene, camera)
})
