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
 * The brand mark: a face mid-scowl, matching public/logo.svg.
 *
 * Takes `currentColor` rather than hard-coding the accent, so the one place
 * that decides the brand colour stays the stylesheet. Everything about it is
 * carried by the brows - which is what lets the same drawing work as a 44px
 * wordmark lockup and a 16px favicon.
 */
export const IconMark = ({ size = '1em', className }: IconProps) => (
  <svg
    viewBox="0 0 64 64"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={3.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={className}
    style={{ display: 'block', overflow: 'visible' }}
  >
    <circle cx="32" cy="32" r="23.4" />
    <path d="M18.6 24.2 29.4 30.4" />
    <path d="M45.4 24.2 34.6 30.4" />
    <path d="M21.4 45.6Q32 36.8 42.6 45.6" />
    <circle cx="23.4" cy="33.4" r="3.5" fill="currentColor" stroke="none" />
    <circle cx="40.6" cy="33.4" r="3.5" fill="currentColor" stroke="none" />
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

/* ------------------------------------------------------------- attacks */

/**
 * One per move, keyed by AttackId.
 *
 * Each is the *gesture* rather than the anatomy - a swipe arrow for a slap, a
 * closing pinch for the nose - because the same icon has to explain the touch
 * control and the key at once. A drawn hand at 15px is an unreadable blob and
 * says nothing about how to perform the move.
 */
export const IconPunch = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 12.4h5.2" />
    <path d="m9.6 9 3.6 3.4-3.6 3.4" />
    <circle cx="17.4" cy="12.4" r="3.4" />
    <path d="M20.6 8.6 22 7M20.6 16.2 22 17.8" />
  </Svg>
)

export const IconSlapL = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.2 12H5.6" />
    <path d="m10.8 6.4-5.2 5.6 5.2 5.6" />
    <path d="M20.4 7.6v8.8" opacity={0.5} />
  </Svg>
)

export const IconSlapR = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.8 12h13.6" />
    <path d="m13.2 6.4 5.2 5.6-5.2 5.6" />
    <path d="M3.6 7.6v8.8" opacity={0.5} />
  </Svg>
)

export const IconPoke = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 12s3.4-5.4 8.6-5.4S20.6 12 20.6 12s-3.4 5.4-8.6 5.4S3.4 12 3.4 12Z" />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    <path d="M17.6 4.8 13.4 9.6" strokeWidth={2.2} />
  </Svg>
)

export const IconPinch = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.6v5.2M12 20.4v-5.2" />
    <path d="m8.4 6.6 3.6-3 3.6 3M8.4 17.4l3.6 3 3.6-3" />
    <path d="M6.6 12h10.8" opacity={0.55} />
  </Svg>
)

export const IconStrangle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M4.4 7.6c1.8 1.6 2.6 3 2.6 4.4s-.8 2.8-2.6 4.4" />
    <path d="M19.6 7.6c-1.8 1.6-2.6 3-2.6 4.4s.8 2.8 2.6 4.4" />
  </Svg>
)

export const IconSpit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4c2.6 3.6 4.2 6.2 4.2 8.2a4.2 4.2 0 0 1-8.4 0c0-2 1.6-4.6 4.2-8.2Z" />
    <path d="M8.2 18.6 6.6 20.6M15.8 18.6l1.6 2M12 19.8v2.2" opacity={0.6} />
  </Svg>
)

export const IconSay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.4 14.6a2 2 0 0 1-2 2H9.2l-4.4 3.4V6.4a2 2 0 0 1 2-2h11.6a2 2 0 0 1 2 2z" />
    <path d="M9 9.4h6.6M9 12.6h4" />
  </Svg>
)

export const ATTACK_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  punch: IconPunch,
  slapL: IconSlapL,
  slapR: IconSlapR,
  poke: IconPoke,
  pinch: IconPinch,
  choke: IconStrangle,
  spit: IconSpit,
}

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
