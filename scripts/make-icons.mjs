/**
 * Renders the brand mark to PNG app icons.
 *
 * Android needs raster icons to offer an install, and iOS needs one for the
 * home screen - neither takes the SVG the browser tab is happy with. There is
 * no image library in this project and adding one (sharp, canvas, resvg) drags
 * in native binaries for a build step that runs about twice a year, so the
 * handful of shapes in the mark are rasterised directly and the PNG is written
 * by hand. Node's zlib is the only thing needed.
 *
 * Run with: npm run icons
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const TILE = [0x12, 0x14, 0x1c]
const MARK = [0xff, 0x5d, 0x47]

/* ------------------------------------------------------------------- png */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  // Every scanline is prefixed with its filter type. Zero - no filtering -
  // costs a little size but keeps this readable, and these are tiny files.
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ----------------------------------------------------------- geometry */

const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy)

/** Distance from a point to a segment - the primitive behind every stroke. */
function distToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1e-9
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2))
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
}

/** The mouth, as a quadratic flattened into segments once at module load. */
const MOUTH = (() => {
  const pts = []
  for (let i = 0; i <= 20; i++) {
    const t = i / 20
    const u = 1 - t
    pts.push([
      u * u * 22.2 + 2 * u * t * 32 + t * t * 41.8,
      u * u * 44.8 + 2 * u * t * 36.6 + t * t * 44.8,
    ])
  }
  return pts
})()

/**
 * Is this point inside the mark, in the 64-unit space the SVG uses?
 *
 * Mirrors favicon.svg: a ring, two brows, two eyes and a mouth.
 */
function inMark(x, y) {
  const W = 4.4 / 2

  if (Math.abs(dist(x, y, 32, 32) - 21.6) <= W) return true
  if (distToSegment(x, y, 19.8, 25, 29.2, 30.6) <= W) return true
  if (distToSegment(x, y, 44.2, 25, 34.8, 30.6) <= W) return true
  if (dist(x, y, 23.8, 33.6) <= 3.8) return true
  if (dist(x, y, 40.2, 33.6) <= 3.8) return true

  for (let i = 1; i < MOUTH.length; i++) {
    const [ax, ay] = MOUTH[i - 1]
    const [bx, by] = MOUTH[i]
    if (distToSegment(x, y, ax, ay, bx, by) <= W) return true
  }
  return false
}

/** Rounded-square tile, matching the SVG's rx. */
function inTile(x, y, r) {
  const qx = Math.abs(x - 32) - (32 - r)
  const qy = Math.abs(y - 32) - (32 - r)
  if (qx <= 0 || qy <= 0) return Math.max(qx, qy) <= 0 || Math.min(qx, qy) <= 0
  return Math.hypot(qx, qy) <= r
}

/**
 * @param size    pixels square
 * @param inset   how much of the tile the mark occupies, 0..1. Maskable icons
 *                get a smaller one because Android crops them to a circle and
 *                anything near the corners is cut off.
 * @param bleed   true fills the whole square; false rounds the corners.
 * @param markOnly true draws the mark on transparency with no tile at all -
 *                for the adaptive foreground, which sits over its own colour
 *                background layer and would otherwise stack two tiles.
 */
function render(size, inset, bleed, markOnly = false) {
  const rgba = Buffer.alloc(size * size * 4)
  const SS = 4 // supersamples per axis
  const scale = 64 / size

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0
      let mark = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale
          const y = (py + (sy + 0.5) / SS) * scale
          if (bleed || inTile(x, y, 14)) tile++
          // Scale the mark about the centre for the maskable safe zone.
          const mx = 32 + (x - 32) / inset
          const my = 32 + (y - 32) / inset
          if (inMark(mx, my)) mark++
        }
      }
      const total = SS * SS
      const a = tile / total
      const m = mark / total
      const o = (py * size + px) * 4
      if (markOnly) {
        // Just the mark, floating on transparency.
        rgba[o] = MARK[0]
        rgba[o + 1] = MARK[1]
        rgba[o + 2] = MARK[2]
        rgba[o + 3] = Math.round(255 * m)
        continue
      }
      // Mark over tile, then the whole thing over transparency.
      for (let c = 0; c < 3; c++) {
        rgba[o + c] = Math.round(TILE[c] * (1 - m) + MARK[c] * m)
      }
      rgba[o + 3] = Math.round(255 * Math.max(a, m * a))
    }
  }
  return encodePng(size, rgba)
}

mkdirSync(OUT, { recursive: true })
const jobs = [
  ['icon-192.png', 192, 1, false],
  ['icon-512.png', 512, 1, false],
  // Android crops maskable icons to a circle, so the mark is pulled in to sit
  // inside the safe zone and the background runs to the edges.
  ['icon-maskable-512.png', 512, 0.66, true],
]
for (const [name, size, inset, bleed] of jobs) {
  const png = render(size, inset, bleed)
  writeFileSync(join(OUT, name), png)
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`)
}

/* --------------------------------------------------- android launcher */

// The native launcher icon, per density. The round and foreground variants use
// the maskable inset so the mark clears Android's circular and squircle masks.
const RES = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main', 'res')
const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]
try {
  for (const [density, px] of DENSITIES) {
    const dir = join(RES, `mipmap-${density}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ic_launcher.png'), render(px, 1, false))
    writeFileSync(join(dir, 'ic_launcher_round.png'), render(px, 0.66, true))
    // The adaptive foreground is drawn at 108/72 of the icon so the outer ring
    // is safe-zone padding the system trims to whatever mask it uses.
    writeFileSync(
      join(dir, 'ic_launcher_foreground.png'),
      render(Math.round(px * 1.5), 0.44, true, true),
    )
  }
  console.log('android launcher icons written')
} catch {
  // The android/ project only exists after `npx cap add android`. Skipping it
  // is fine when only the web icons are wanted.
  console.log('android res not found - skipped launcher icons')
}
