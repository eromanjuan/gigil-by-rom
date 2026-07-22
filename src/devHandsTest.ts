/**
 * Dev-only hand rig inspector. Renders every hand kind, open and closed, from
 * a three-quarter angle with a marker on each contact point. Not part of the
 * game bundle - reachable at /hands-test.html while the dev server is running.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { makeHand, posesFor, type HandKind } from './game/hands'

const KINDS: HandKind[] = ['fist', 'flat', 'poke', 'pinch', 'grab']

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#14171f')
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.7

const key = new THREE.DirectionalLight('#fff1e0', 2.4)
key.position.set(2, 3, 4)
const rim = new THREE.DirectionalLight('#7f92ff', 1.2)
rim.position.set(-3, 1, -2)
scene.add(key, rim)

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100)

const label = (text: string, x: number, y: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#cfd6e4'
  ctx.font = '600 30px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 32)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
  sprite.position.set(x, y, 0)
  sprite.scale.set(1.5, 0.375, 1)
  scene.add(sprite)
}

// Two rows: open on top, closed underneath, one column per kind.
KINDS.forEach((kind, col) => {
  const x = (col - (KINDS.length - 1) / 2) * 2.6
  label(kind, x, 2.5)
  ;[0, 1].forEach((closed) => {
    const hand = makeHand(kind, { scale: 1 })
    hand.visible = true
    hand.position.set(x, closed ? -1.6 : 1.2, 0)
    // Three-quarter view so both the finger curl and the palm read.
    hand.rotation.set(0.35, 2.5, 0, 'YXZ')
    hand.setPose(...posesFor(kind), closed)
    scene.add(hand)

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 10),
      new THREE.MeshBasicMaterial({ color: '#ff4d4d' }),
    )
    dot.position.copy(hand.userData.contact as THREE.Vector3).applyMatrix4(hand.matrixWorld)
    hand.updateMatrixWorld(true)
    dot.position
      .copy(hand.userData.contact as THREE.Vector3)
      .multiply(hand.scale)
      .applyQuaternion(hand.quaternion)
      .add(hand.position)
    scene.add(dot)
  })
})

camera.position.set(0, 0, 11)
camera.lookAt(0, -0.2, 0)

addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
})

renderer.render(scene, camera)
