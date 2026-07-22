/**
 * What the target looks like.
 *
 * This is the contract between the customiser UI and the 3D side: the UI only
 * ever produces a `Look`, and the bust builder only ever reads one. Neither
 * knows anything else about the other, which is what lets the preview rebuild
 * from a single object rather than a pile of setters.
 */

/**
 * There is no gender here on purpose.
 *
 * There was, briefly - a whole step of the flow - but the two bodies differed
 * only by a few percent of jaw width and brow, which nobody could see. A choice
 * that changes nothing visible is a choice not worth asking anyone to make, so
 * every style and every garment is now in one list and the step is gone.
 */

/**
 * A hairstyle, as parameters rather than a mesh.
 *
 * Real hair assets would mean a model per style per head shape, and the head
 * shape here is generated. So instead the one shell generator is driven by
 * numbers, and a "style" is a named set of them - which also means a style
 * fits any head it's put on, including one rebuilt from a photo.
 */
export type HairStyle = {
  id: string
  label: string
  /** Scales all bulk. 0 is bald, and skips the geometry entirely. */
  volume: number
  /** How far below the ear line it hangs, in face heights. 0 stops at the ear. */
  length: number
  /** Roundness. High values give the near-spherical mass of an afro. */
  puff: number
  /** Flyaway density, relative to the default. */
  wisp: number
  /** Hairline height. Positive drops it down the forehead, negative recedes it. */
  hairline: number
  /** Side coverage. 0 shaves them, 1 keeps full thickness to the temples. */
  sides: number
  /** Where the parting sits: -1 hard left, 0 centre, 1 hard right. */
  part: number
  /** How deep the parting groove cuts. 0 leaves no parting at all. */
  partDepth: number
  /** How far a fringe hangs over the forehead, in face heights. */
  fringe: number
  /** End shape on the fall: 0 is a blunt cut, 1 is heavily layered. */
  taper: number
  /** Outward flare of the fall. A bob kicks out; long hair falls straight. */
  flare: number
  /** A gathered mass of hair, tied off somewhere. */
  gather: 'none' | 'bun' | 'ponytail'
}

/**
 * A garment.
 *
 * The camera only ever sees the top of the chest, so what actually
 * distinguishes one top from another here is the neckline and the shoulders -
 * a sleeve or a hemline is never on screen. Modelling anything below that
 * would be geometry nobody can see.
 */
export type Outfit = {
  id: string
  label: string
  /** Neckline depth below the collar line, in face heights. */
  neck: number
  /** Neckline width, as a fraction of shoulder width. */
  neckWidth: number
  collar: 'none' | 'polo' | 'shirt'
  /** Shoulder coverage. 0 is bare (a vest), 1 is a full shoulder seam. */
  shoulders: number
}

export type Look = {
  hair: string
  hairColor: string
  outfit: string
  outfitColor: string
  skinColor: string
}

/* ------------------------------------------------------------------ hair */

/** Everything a style doesn't say is the default: centre, no parting, no fringe. */
const BASE = {
  part: 0,
  partDepth: 0,
  fringe: 0,
  taper: 0.5,
  flare: 0,
  gather: 'none',
} satisfies Partial<HairStyle>

const style = (s: Omit<HairStyle, keyof typeof BASE> & Partial<HairStyle>): HairStyle => ({
  ...BASE,
  ...s,
})

const BALD = style({ id: 'bald', label: 'Bald', volume: 0, length: 0, puff: 0, wisp: 0, hairline: 0, sides: 0 })

/**
 * Men's cuts. Short, structured, and mostly distinguished by where the weight
 * sits and how hard the parting is - which is why parting and fringe had to
 * become real geometry: at these lengths there is nothing else to tell them
 * apart with.
 */
const HAIR_MALE: HairStyle[] = [
  BALD,
  style({ id: 'buzz', label: 'Buzz Cut', volume: 0.18, length: 0, puff: 0.08, wisp: 0.15, hairline: 0.02, sides: 1 }),
  style({ id: 'crew', label: 'Crew Cut', volume: 0.36, length: 0, puff: 0.18, wisp: 0.45, hairline: 0, sides: 0.95, part: 0.5, partDepth: 0.25 }),
  style({ id: 'shortSide', label: 'Short Side Part', volume: 0.55, length: 0.01, puff: 0.25, wisp: 0.6, hairline: 0.01, sides: 1, part: 0.5, partDepth: 0.75, fringe: 0.03 }),
  style({ id: 'quiff', label: 'Quiff', volume: 0.72, length: 0, puff: 0.3, wisp: 1.2, hairline: -0.03, sides: 0.8, fringe: 0.05 }),
  style({ id: 'spiky', label: 'Spiky', volume: 0.5, length: 0, puff: 0.22, wisp: 3, hairline: 0, sides: 0.8 }),
  style({ id: 'undercut', label: 'Undercut', volume: 0.66, length: 0, puff: 0.28, wisp: 0.7, hairline: -0.02, sides: 0.12, part: 0.55, partDepth: 0.8 }),
  style({ id: 'curtains', label: 'Curtains', volume: 0.76, length: 0.07, puff: 0.35, wisp: 1, hairline: 0.06, sides: 1, part: 0, partDepth: 0.85, fringe: 0.13, taper: 0.3 }),
  style({ id: 'afro', label: 'Afro', volume: 1, length: 0.03, puff: 1, wisp: 1.4, hairline: 0.04, sides: 1 }),
  style({ id: 'dreads', label: 'Dreads', volume: 0.78, length: 0.16, puff: 0.5, wisp: 2.6, hairline: 0.02, sides: 1, taper: 0.15 }),
  style({ id: 'manBun', label: 'Man Bun', volume: 0.5, length: 0.03, puff: 0.2, wisp: 0.35, hairline: -0.02, sides: 0.9, part: 0, partDepth: 0.3, gather: 'bun' }),
  style({ id: 'receding', label: 'Receding', volume: 0.38, length: 0, puff: 0.18, wisp: 0.4, hairline: -0.13, sides: 1 }),
]

/**
 * Women's cuts. Longer, so these are separated by how the ends behave - a
 * blunt bob kicks outward, layered hair tapers, a ponytail gathers it all
 * behind - rather than by bulk on the skull.
 */
const HAIR_FEMALE: HairStyle[] = [
  BALD,
  style({ id: 'pixie', label: 'Pixie', volume: 0.48, length: 0.02, puff: 0.28, wisp: 0.9, hairline: 0.03, sides: 0.85, part: 0.45, partDepth: 0.6, fringe: 0.07 }),
  style({ id: 'bobBlunt', label: 'Blunt Bob', volume: 0.85, length: 0.19, puff: 0.3, wisp: 0.5, hairline: 0.05, sides: 1, partDepth: 0.5, fringe: 0.12, taper: 0, flare: 0.55 }),
  style({ id: 'bobLayered', label: 'Layered Bob', volume: 0.82, length: 0.22, puff: 0.45, wisp: 1.2, hairline: 0.03, sides: 1, part: 0.35, partDepth: 0.6, taper: 0.85, flare: 0.2 }),
  style({ id: 'shoulder', label: 'Shoulder Length', volume: 0.9, length: 0.36, puff: 0.4, wisp: 0.9, hairline: 0.03, sides: 1, part: 0.3, partDepth: 0.55, taper: 0.5 }),
  style({ id: 'long', label: 'Long Straight', volume: 0.92, length: 0.62, puff: 0.35, wisp: 0.7, hairline: 0.03, sides: 1, partDepth: 0.6, taper: 0.4 }),
  style({ id: 'longWavy', label: 'Long Wavy', volume: 1, length: 0.56, puff: 0.7, wisp: 1.7, hairline: 0.04, sides: 1, part: 0.25, partDepth: 0.5, taper: 0.75, flare: 0.25 }),
  style({ id: 'sideSwept', label: 'Side Swept', volume: 0.88, length: 0.34, puff: 0.45, wisp: 1.1, hairline: 0.05, sides: 1, part: 0.85, partDepth: 0.95, fringe: 0.15, taper: 0.7 }),
  style({ id: 'ponytail', label: 'Ponytail', volume: 0.6, length: 0.06, puff: 0.15, wisp: 0.3, hairline: 0.02, sides: 1, partDepth: 0.35, gather: 'ponytail' }),
  style({ id: 'bun', label: 'Bun', volume: 0.55, length: 0.02, puff: 0.15, wisp: 0.3, hairline: 0.02, sides: 1, partDepth: 0.4, gather: 'bun' }),
  style({ id: 'curly', label: 'Curly', volume: 0.9, length: 0.2, puff: 0.85, wisp: 2, hairline: 0.04, sides: 1, taper: 0.8 }),
  style({ id: 'afro', label: 'Afro', volume: 1, length: 0.04, puff: 1, wisp: 1.5, hairline: 0.04, sides: 1 }),
  style({ id: 'braids', label: 'Braids', volume: 0.7, length: 0.5, puff: 0.2, wisp: 0.25, hairline: 0.02, sides: 1, partDepth: 0.7, taper: 0.1 }),
]

/** One list. Shorter cuts first, so the grid reads roughly by length. */
export const HAIR_STYLES: HairStyle[] = [
  ...HAIR_MALE,
  ...HAIR_FEMALE.filter((f) => !HAIR_MALE.some((m) => m.id === f.id)),
]

/* --------------------------------------------------------------- outfits */

const OUTFIT_MALE: Outfit[] = [
  { id: 'tshirt', label: 'T-Shirt', neck: 0.1, neckWidth: 0.34, collar: 'none', shoulders: 1 },
  { id: 'polo', label: 'Polo', neck: 0.16, neckWidth: 0.3, collar: 'polo', shoulders: 1 },
  { id: 'poloShirt', label: 'Polo Shirt', neck: 0.2, neckWidth: 0.32, collar: 'shirt', shoulders: 1 },
  { id: 'buttonUp', label: 'Button-Up', neck: 0.24, neckWidth: 0.28, collar: 'shirt', shoulders: 1 },
  { id: 'sando', label: 'Sando', neck: 0.2, neckWidth: 0.5, collar: 'none', shoulders: 0.22 },
  { id: 'hoodie', label: 'Hoodie', neck: 0.08, neckWidth: 0.42, collar: 'polo', shoulders: 1 },
  // Deep and narrow, because a lapel opens far further down than a shirt does.
  { id: 'suit', label: 'Suit & Tie', neck: 0.3, neckWidth: 0.24, collar: 'shirt', shoulders: 1 },
]

const OUTFIT_FEMALE: Outfit[] = [
  { id: 'dress', label: 'Dress', neck: 0.18, neckWidth: 0.44, collar: 'none', shoulders: 0.7 },
  { id: 'blouse', label: 'Blouse', neck: 0.14, neckWidth: 0.34, collar: 'shirt', shoulders: 1 },
  { id: 'tshirt', label: 'T-Shirt', neck: 0.1, neckWidth: 0.34, collar: 'none', shoulders: 1 },
  { id: 'tankTop', label: 'Tank Top', neck: 0.22, neckWidth: 0.52, collar: 'none', shoulders: 0.18 },
  { id: 'offShoulder', label: 'Off-Shoulder', neck: 0.26, neckWidth: 0.78, collar: 'none', shoulders: 0.05 },
  { id: 'sweater', label: 'Sweater', neck: 0.06, neckWidth: 0.3, collar: 'polo', shoulders: 1 },
]

export const OUTFITS: Outfit[] = [
  ...OUTFIT_MALE,
  ...OUTFIT_FEMALE.filter((o) => !OUTFIT_MALE.some((m) => m.id === o.id)),
]

/* --------------------------------------------------------------- lookups */

export function hairStyle(id: string): HairStyle {
  return HAIR_STYLES.find((h) => h.id === id) ?? HAIR_STYLES[3] ?? HAIR_STYLES[0]
}

export function outfit(id: string): Outfit {
  return OUTFITS.find((o) => o.id === id) ?? OUTFITS[0]
}

/* ------------------------------------------------------------- randomise */

/** A spread of plausible hair colours, from black through to bleached. */
export const HAIR_SWATCHES = [
  '#1b1613', '#2b2119', '#3d2b1f', '#5a3a22', '#7b5230',
  '#a06f3a', '#c99a5b', '#e0c184', '#8c8c8c', '#d8d8d8',
  '#7a2f2f', '#4a3f6b', '#2f5f4a',
]

export const SKIN_SWATCHES = [
  '#f2d5c0', '#e8c3a6', '#d9a184', '#c78a68', '#a86b4b',
  '#8d5a3c', '#6b422b', '#4a2d1d',
]

export const OUTFIT_SWATCHES = [
  '#3a4250', '#5b6474', '#8b93a3', '#d7dbe2', '#2f3742',
  '#7a2f36', '#2f5f4a', '#4a3f6b', '#c2803a', '#1b1e24',
]

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]

/** A complete random look, used by the Randomize button. */
export function randomLook(): Look {
  return {
    hair: pick(HAIR_STYLES).id,
    hairColor: pick(HAIR_SWATCHES),
    outfit: pick(OUTFITS).id,
    outfitColor: pick(OUTFIT_SWATCHES),
    skinColor: pick(SKIN_SWATCHES),
  }
}

export function defaultLook(): Look {
  return {
    hair: 'shortSide',
    hairColor: '#2b2119',
    outfit: 'tshirt',
    outfitColor: '#3a4250',
    skinColor: '#d9a184',
  }
}
