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
 * The brand mark: the game's own outcome — flushed cheeks, red nose, eyes
 * screwed shut. Filled rather than stroked, unlike everything else here,
 * because it has to match public/logo.svg exactly; a mark that differs between
 * the tab and the page reads as two different products.
 */
export const IconMark = ({ size = '1em', className }: IconProps) => (
  <svg
    viewBox="0 0 64 64"
    width={size}
    height={size}
    aria-hidden="true"
    focusable="false"
    className={className}
    style={{ display: 'block', overflow: 'visible' }}
  >
    <circle cx="32" cy="35" r="20" fill="#f0c9ad" />
    <ellipse cx="10.6" cy="36" rx="3" ry="4.3" fill="#e6b99c" />
    <ellipse cx="53.4" cy="36" rx="3" ry="4.3" fill="#e6b99c" />
    <path
      fill="#241c16"
      d="M12 34.6A20 20 0 0 1 52 34.6L45.6 28.8 38.8 33.4 32 28.4 25.2 33.4 18.4 28.8Z"
    />
    <ellipse cx="19.6" cy="42.6" rx="6" ry="4.5" fill="#ff5d47" opacity="0.9" />
    <ellipse cx="44.4" cy="42.6" rx="6" ry="4.5" fill="#ff5d47" opacity="0.9" />
    <ellipse cx="32" cy="40.4" rx="4.3" ry="4.7" fill="#ff5d47" />
    <path
      d="M21.6 35.4q3.8 3.4 7.6 0M34.8 35.4q3.8 3.4 7.6 0"
      stroke="#12141c"
      strokeWidth={2.6}
      fill="none"
      strokeLinecap="round"
    />
    <path
      d="M26.4 48.6q5.6-3.4 11.2 0"
      stroke="#12141c"
      strokeWidth={2.2}
      fill="none"
      strokeLinecap="round"
    />
  </svg>
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

export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.2 10.4 12 4.2l7.8 6.2V19a1.2 1.2 0 0 1-1.2 1.2H5.4A1.2 1.2 0 0 1 4.2 19z" />
    <path d="M9.6 20.2v-6h4.8v6" />
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
