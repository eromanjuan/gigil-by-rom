import { useEffect, useRef, useState } from 'react'
import { ATTACK_LIST } from '../game/attacks'
import { IconMark } from './icons'
import LandingScene from './LandingScene'
import './landing.css'

type Props = {
  onStart: () => void
  /**
   * The terms dialog opens on top of this screen rather than replacing it, so
   * everything here has to stop being reachable while that's up — otherwise the
   * Start button is still tabbable underneath the modal.
   */
  behind?: boolean
}

/**
 * Ko-fi's own button, self-hosted.
 *
 * Their snippet hotlinks the image from storage.ko-fi.com and their widget goes
 * further and runs a third-party script. Two paragraphs up, this page promises
 * the whole thing runs on your own device and nothing is uploaded - and every
 * request to someone else's server hands them a visitor's IP and referrer.
 * The button is 4KB; serving it ourselves keeps that promise literally true,
 * costs nothing, and can't break when their CDN path changes.
 */
const KOFI_URL = 'https://ko-fi.com/O8B623NRHI'

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Landing-only, like IconDown - the app icon set has no platform glyphs. */
const IconAndroid = () => (
  <svg
    viewBox="0 0 24 24"
    width="1.15em"
    height="1.15em"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    style={{ display: 'block' }}
  >
    <path d="M6 9.6h12v7.2a1.2 1.2 0 0 1-1.2 1.2h-.6v2.1a1.05 1.05 0 0 1-2.1 0v-2.1h-2.1v2.1a1.05 1.05 0 0 1-2.1 0v-2.1h-.6A1.2 1.2 0 0 1 6 16.8zM3.9 9.9a1.05 1.05 0 0 1 2.1 0v4.8a1.05 1.05 0 0 1-2.1 0zm14.1 0a1.05 1.05 0 0 1 2.1 0v4.8a1.05 1.05 0 0 1-2.1 0zM7.8 8.4a4.2 4.2 0 0 1 8.4 0zm1.5-3.3-.9-1.35a.35.35 0 0 1 .58-.4l.95 1.43a5 5 0 0 1 4.14 0l.95-1.43a.35.35 0 0 1 .58.4l-.9 1.35M9.9 6.6h.02M14.08 6.6h.02" />
  </svg>
)

/** Local because icons.tsx is the shared set and this arrow is landing-only. */
const IconDown = () => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    style={{ display: 'block' }}
  >
    <path d="M12 5v14" />
    <path d="m5.5 13 6.5 6 6.5-6" />
  </svg>
)

/**
 * The pitch, told as a scroll.
 *
 * It owns its own scroll container rather than letting the page scroll, because
 * the app shell sets `overflow: hidden` on the body and every other stage
 * depends on that — a landing page is not a reason to unpin the whole game.
 */
export default function Landing({ onStart, behind = false }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLElement>(null)
  /** Written on scroll, read by the render loop. Deliberately not state. */
  const progress = useRef(0)
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const span = el.scrollHeight - el.clientHeight
      progress.current = span > 0 ? el.scrollTop / span : 0
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [])

  // The hero's Start scrolls away and never comes back, so a second one docks
  // once it leaves. Observed rather than measured against a scroll threshold,
  // which would need re-tuning every time the copy changes length.
  useEffect(() => {
    const hero = heroRef.current
    const root = scrollRef.current
    if (!hero || !root || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver(([entry]) => setPinned(!entry.isIntersecting), {
      root,
      threshold: 0.2,
    })
    io.observe(hero)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    // Reduced motion gets the finished state up front: no transform to drive,
    // nothing tied to scroll position at all.
    if (prefersReducedMotion() || typeof IntersectionObserver !== 'function') {
      for (const el of items) el.classList.add('is-in')
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          io.unobserve(entry.target)
        }
      },
      { root, rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
    )
    for (const el of items) io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      className={`lp${behind ? ' is-behind' : ''}`}
      ref={scrollRef}
      aria-hidden={behind || undefined}
    >
      <LandingScene progress={progress} />
      <div className="lp-veil" aria-hidden="true" />

      <div className={`lp-pin${pinned && !behind ? ' is-on' : ''}`}>
        <button
          type="button"
          className="primary-btn lp-pin-btn"
          onClick={onStart}
          disabled={behind}
          tabIndex={pinned && !behind ? undefined : -1}
          aria-hidden={pinned && !behind ? undefined : true}
        >
          Start
        </button>
      </div>

      <main className="lp-main">
        <section className="lp-sec lp-hero" ref={heroRef} aria-labelledby="lp-title">
          <p className="lp-eyebrow">A stress toy. Not a fight.</p>

          <div className="lp-brand">
            <span className="lp-mark" aria-hidden="true">
              <IconMark />
            </span>
            <h1 id="lp-title">
              Gigil<em>!</em>
            </h1>
          </div>

          <p className="lp-lead">
            Don't hold it in. <em>Let the feeling out before it takes over.</em>
          </p>

          <p className="lp-sub">
            Someone has been living rent-free in your head all week. You are never going to lay a
            finger on them, and you shouldn't. So build them here, take it out on a pile of
            polygons, and go back to your evening a lighter person.
          </p>

          <div className="lp-cta">
            <button type="button" className="primary-btn lp-start" onClick={onStart} disabled={behind}>
              Start
            </button>
            <span className="lp-cta-note">No account. Nothing leaves this device.</span>
          </div>

          <p className="lp-scroll" aria-hidden="true">
            <span>Keep going</span>
            <IconDown />
          </p>
        </section>

        <section className="lp-sec" aria-labelledby="lp-word">
          <p className="lp-kicker" data-reveal>
            The word
          </p>
          <h2 id="lp-word" className="lp-h2" data-reveal>
            gigil
          </h2>
          <p className="lp-pron" data-reveal>
            /ˈɡi.ɡil/ · Tagalog · noun
          </p>
          <p className="lp-body" data-reveal>
            The full-body tremble that arrives when a feeling gets bigger than the person holding
            it. Jaw locked, hands closing on nothing. Filipinos use it for the urge to squeeze a
            baby's cheeks — and for the other thing, the one with no cheeks to squeeze.
          </p>
          <blockquote className="lp-quote" data-reveal>
            Anger isn't the problem. Having nowhere to put it is.
          </blockquote>
        </section>

        <section className="lp-sec" aria-labelledby="lp-how">
          <p className="lp-kicker" data-reveal>
            How it works
          </p>
          <h2 id="lp-how" className="lp-h2" data-reveal>
            Three steps. Two minutes.
          </h2>

          <ol className="lp-steps">
            <li className="glass lp-step" data-reveal>
              <span className="lp-step-n" aria-hidden="true">
                1
              </span>
              <div>
                <h3>Build your target</h3>
                <p>
                  Hair, outfit, skin, colours. Get it close enough that your jaw tightens when you
                  look at it. Close enough is the whole trick.
                </p>
              </div>
            </li>
            <li className="glass lp-step" data-reveal>
              <span className="lp-step-n" aria-hidden="true">
                2
              </span>
              <div>
                <h3>Give it a face</h3>
                <p>
                  Optional. Drop in a photo and it's fitted to the head right here, in this tab.
                  Nothing is uploaded, nothing is stored, nothing is shown to anyone.
                </p>
              </div>
            </li>
            <li className="glass lp-step" data-reveal>
              <span className="lp-step-n" aria-hidden="true">
                3
              </span>
              <div>
                <h3>Let go</h3>
                <p>
                  Seven keys, one very patient head. Swing until the feeling gets smaller, then wipe
                  every bruise with one button and close the tab.
                </p>
                <div className="lp-keys" aria-label="Attack keys">
                  {ATTACK_LIST.map((attack) => (
                    <span className="key-chip" key={attack.id}>
                      <kbd>{attack.key}</kbd>
                      <span>{attack.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            </li>
          </ol>
        </section>

        <section className="lp-sec" aria-labelledby="lp-moves">
          <p className="lp-kicker" data-reveal>
            The moves
          </p>
          <h2 id="lp-moves" className="lp-h2" data-reveal>
            Seven ways to be unreasonable.
          </h2>
          <p className="lp-body" data-reveal>
            No combos to memorise, no score to chase. Press whichever one matches the feeling.
          </p>

          <ul className="lp-moves">
            {ATTACK_LIST.map((attack) => (
              <li className="glass lp-move" key={attack.id} data-reveal>
                <kbd>{attack.key}</kbd>
                <div>
                  <strong>{attack.label}</strong>
                  <span>{attack.hint}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-sec" aria-labelledby="lp-notice">
          <p className="lp-kicker" data-reveal>
            Read this part
          </p>
          <h2 id="lp-notice" className="lp-h2 lp-h2-plain" data-reveal>
            Before you start
          </h2>

          <div className="lp-notice" data-reveal>
            <ul>
              <li>
                <strong>Stylised cartoon violence.</strong> Squashing, bruising and a lot of
                yelping. The damage is deliberately non-photoreal — it looks like a dented toy,
                never like an injury — and one button wipes all of it.
              </li>
              <li>
                <strong>Not for young audiences.</strong> This isn't a children's game, and it isn't
                meant to be watched by one over your shoulder.
              </li>
              <li>
                <strong>Don't upload people without their consent.</strong> Photos never leave your
                device, which is exactly why the judgement is yours alone. Someone who hasn't agreed
                to be here doesn't belong here.
              </li>
              <li>
                <strong>It's a toy, not treatment.</strong> If the anger frightens you, or it's
                about someone you think you might actually hurt, close the tab and talk to a real
                person instead.
              </li>
            </ul>
          </div>
        </section>

        <section className="lp-sec lp-final" aria-labelledby="lp-go">
          <h2 id="lp-go" className="lp-h2 lp-h2-big" data-reveal>
            Go on, then.
          </h2>
          <p className="lp-body" data-reveal>
            It's a pile of polygons. It has no feelings. You have several.
          </p>
          <div className="lp-cta" data-reveal>
            <button type="button" className="primary-btn lp-start" onClick={onStart} disabled={behind}>
              Start in browser
            </button>
            <a
              className="ghost-cta"
              href="https://github.com/eromanjuan/gigil-by-rom/releases/latest/download/gigil.apk"
              rel="noopener noreferrer"
            >
              <IconAndroid />
              <span>Download for Android</span>
            </a>
          </div>
          <p className="lp-dl-note" data-reveal>
            The Android build is the same game in a standalone app. It's not from the Play Store, so
            your phone will ask you to allow the install — that's expected for a direct download.
          </p>
          <div className="lp-support" data-reveal>
            <p>
              Gigil is free, has no ads and never sees your photos. If it took the edge off a bad
              day, you can buy me a coffee — entirely optional, and nothing is gated behind it.
            </p>
            <a className="kofi-btn" href={KOFI_URL} target="_blank" rel="noopener noreferrer">
              <img
                src="/kofi-button.png"
                alt="Buy me a coffee at ko-fi.com"
                width={141}
                height={36}
                loading="lazy"
              />
            </a>
          </div>

          <p className="lp-foot">
            Runs entirely on this device. No account, no upload, no leaderboard of people you're mad
            at.
          </p>
        </section>
      </main>
    </div>
  )
}
