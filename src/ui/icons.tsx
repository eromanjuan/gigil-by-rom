/**
 * Line icons.
 *
 * These replace the emoji the UI used to use. Emoji are rendered by the OS, so
 * the same button was a flat glyph on one machine, a full-colour cartoon on
 * another and a tofu box on a third — three different visual weights in a
 * panel that is otherwise one consistent system. These are drawn on a shared
 * 24-unit grid with one stroke weight and take their colour from the element
 * they sit in, so they inherit hover and pressed states for free.
 *
 * Sized in `em`, so the existing `font-size` on `.ico`, `.icon-btn` and
 * `.dropzone-icon` still controls them.
 */

type IconProps = {
  /** Overrides the em-relative default; accepts any CSS length. */
  size?: string
  className?: string
}

function Svg({ size = '1em', className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {children}
    </svg>
  )
}

/**
 * The brand mark: a head in profile taking a hit. Deliberately geometric
 * rather than a literal fist — at 30px a drawn hand turns to mush, and the
 * impact lines carry the idea on their own.
 */
export const IconMark = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="12" r="6.4" />
    <path d="M7.6 10.6h.01M11.4 10.6h.01" strokeWidth={2.2} />
    <path d="M7.9 14.6c1.3 1.2 3.1 1.2 4.4 0" />
    <path d="M19.4 8.2 17 12l2.4 3.8" />
    <path d="M22 10.4 20.6 12l1.4 1.6" opacity={0.55} />
  </Svg>
)

export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16V4.6" />
    <path d="m7.6 9 4.4-4.4L16.4 9" />
    <path d="M4.5 15v2.9A1.6 1.6 0 0 0 6.1 19.5h11.8a1.6 1.6 0 0 0 1.6-1.6V15" />
  </Svg>
)

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5.5" />
    <path d="m11 5.5-5.5 6.5 5.5 6.5" />
  </Svg>
)

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6" />
  </Svg>
)

export const IconSound = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 4.8 6.4 8.7H3.4v6.6h3l4.6 3.9z" />
    <path d="M15.2 9.2a4 4 0 0 1 0 5.6" />
    <path d="M18 6.4a8 8 0 0 1 0 11.2" />
  </Svg>
)

export const IconSoundOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 4.8 6.4 8.7H3.4v6.6h3l4.6 3.9z" />
    <path d="m15.6 9.6 5 4.8M20.6 9.6l-5 4.8" />
  </Svg>
)

export const IconLight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.4 17.2a6 6 0 1 1 5.2 0" />
    <path d="M9.6 17.2h4.8M10.3 20h3.4" />
  </Svg>
)

export const IconHeal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5.4v13.2M5.4 12h13.2" />
  </Svg>
)

/** Sliders — the build panel, where the look is dialled in. */
export const IconTune = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 7.4h14.8M4.6 16.6h14.8" />
    <circle cx="9.4" cy="7.4" r="2.3" />
    <circle cx="15" cy="16.6" r="2.3" />
  </Svg>
)

export const IconPhoto = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.4" y="5" width="17.2" height="14" rx="2.2" />
    <circle cx="8.8" cy="10" r="1.5" />
    <path d="m4.2 16.4 4.2-3.9 3.5 3.1 3.2-2.8 4.7 4.1" />
  </Svg>
)
