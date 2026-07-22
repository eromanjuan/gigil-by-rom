// Pulls the two things MediaPipe needs at runtime into public/ so the game
// works offline and never hits a CDN mid-punch:
//   public/wasm/*        - the vision task WASM runtime (copied from node_modules)
//   public/models/*.task - the face landmarker weights (downloaded once)
import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

// Directories report size 0 on Windows, so treat "is a directory" as present.
const exists = (p) =>
  stat(p).then(
    (s) => s.isDirectory() || s.size > 0,
    () => false,
  )

async function copyWasm() {
  const from = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm')
  const to = resolve(root, 'public/wasm')
  if (!(await exists(from))) {
    console.warn('[assets] @mediapipe/tasks-vision not installed yet, skipping wasm copy')
    return
  }
  await cp(from, to, { recursive: true })
  console.log('[assets] wasm runtime -> public/wasm')
}

async function fetchModel() {
  const to = resolve(root, 'public/models/face_landmarker.task')
  if (await exists(to)) {
    console.log('[assets] face_landmarker.task already present')
    return
  }
  await mkdir(dirname(to), { recursive: true })
  console.log('[assets] downloading face_landmarker.task (~3.7MB)...')
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  await writeFile(to, Buffer.from(await res.arrayBuffer()))
  console.log('[assets] face_landmarker.task -> public/models')
}

try {
  await copyWasm()
  await fetchModel()
} catch (err) {
  // Never fail the install over this - the app degrades to the flat-projection
  // fallback and prints a clear message in the console.
  console.warn('[assets] setup incomplete:', err.message)
  console.warn('[assets] run `npm run setup:assets` once you have network access')
}
