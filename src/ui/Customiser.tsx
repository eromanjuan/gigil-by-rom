import {
  HAIR_STYLES,
  HAIR_SWATCHES,
  OUTFITS,
  OUTFIT_SWATCHES,
  SKIN_SWATCHES,
  randomLook,
  type Look,
} from '../game/look'
import { IconArrowLeft } from './icons'

type Props = {
  look: Look
  /** Fires on every change — the dummy behind this panel is the real preview. */
  onChange: (look: Look) => void
  onBack: () => void
  onNext: () => void
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

type SwatchProps = {
  /** Used to build the per-swatch labels, so it reads as "Hair colour #2b2119". */
  label: string
  colors: string[]
  value: string
  onPick: (color: string) => void
}

/**
 * A row of presets plus an escape hatch.
 *
 * The native colour input is deliberately the last item in the same row rather
 * than a separate control: it's the same decision as the swatches, just without
 * a preset for it, so it shouldn't look like a different feature.
 */
function Swatches({ label, colors, value, onPick }: SwatchProps) {
  const custom = !colors.some((c) => same(c, value))

  return (
    <div className="swatches">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className="swatch"
          style={{ ['--c' as string]: color }}
          aria-pressed={same(color, value)}
          aria-label={`${label} ${color}`}
          title={color}
          onClick={() => onPick(color)}
        />
      ))}

      <label className={`swatch-custom${custom ? ' is-active' : ''}`}>
        <span className="sr-only">Custom {label.toLowerCase()}</span>
        <input type="color" value={value} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  )
}

/**
 * The build panel.
 *
 * It's docked to one edge and never centred, because the thing it's editing is
 * rendering live in the middle of the same viewport — a modal here would mean
 * choosing a hairstyle you can't see. On a phone the same panel becomes a
 * bottom sheet, which keeps the head in the top half of the screen.
 */
export default function Customiser({ look, onChange, onBack, onNext }: Props) {
  const set = (patch: Partial<Look>) => onChange({ ...look, ...patch })

  return (
    <aside className="customiser glass" aria-label="Customise your target">
      <header className="cust-head">
        <h2>Build your target</h2>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => onChange(randomLook())}
          title="Roll a completely random look"
        >
          Randomize Look
        </button>
      </header>

      <div className="cust-body">
        <section className="cust-group">
          <h3 className="field-label" id="grp-hair">
            Hair type
          </h3>
          <div className="preset-grid is-scroll" role="group" aria-labelledby="grp-hair">
            {HAIR_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                className="preset-btn"
                aria-pressed={style.id === look.hair}
                onClick={() => set({ hair: style.id })}
              >
                {style.label}
              </button>
            ))}
          </div>
        </section>

        <section className="cust-group">
          <h3 className="field-label">Hair colour</h3>
          <Swatches
            label="Hair colour"
            colors={HAIR_SWATCHES}
            value={look.hairColor}
            onPick={(hairColor) => set({ hairColor })}
          />
        </section>

        <section className="cust-group">
          <h3 className="field-label" id="grp-outfit">
            Outfit
          </h3>
          <div className="preset-grid is-scroll" role="group" aria-labelledby="grp-outfit">
            {OUTFITS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="preset-btn"
                aria-pressed={item.id === look.outfit}
                onClick={() => set({ outfit: item.id })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="cust-group">
          <h3 className="field-label">Outfit colour</h3>
          <Swatches
            label="Outfit colour"
            colors={OUTFIT_SWATCHES}
            value={look.outfitColor}
            onPick={(outfitColor) => set({ outfitColor })}
          />
        </section>

        <section className="cust-group">
          <h3 className="field-label">Skin tone</h3>
          <Swatches
            label="Skin tone"
            colors={SKIN_SWATCHES}
            value={look.skinColor}
            onPick={(skinColor) => set({ skinColor })}
          />
        </section>
      </div>

      <footer className="cust-foot">
        <button type="button" className="ghost-btn back-btn" onClick={onBack}>
          <IconArrowLeft />
          <span>Back</span>
        </button>
        <button type="button" className="primary-btn" onClick={onNext}>
          Next: Add a face
        </button>
      </footer>
    </aside>
  )
}
