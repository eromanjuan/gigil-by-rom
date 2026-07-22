import { useCallback, useEffect, useRef, useState } from 'react'
import { Game, type GameStats, type GameStatus, type LightId, type LightState } from './game/Game'
import type { AttackId } from './game/attacks'
import { defaultLook, type Look } from './game/look'
import Uploader from './ui/Uploader'
import Hud from './ui/Hud'
import HotkeyDock from './ui/HotkeyDock'
import TauntBox from './ui/TauntBox'
import LightPanel from './ui/LightPanel'
import Landing from './ui/Landing'
import Terms from './ui/Terms'
import Customiser from './ui/Customiser'

const EMPTY_STATS: GameStats = { pain: 0, combo: 0, bestCombo: 0, hits: 0 }

/**
 * Where the player is before the game starts.
 *
 * This is deliberately separate from `GameStatus`: the 3D side reports
 * 'loading' and 'playing' for a dummy built during the customiser too, and the
 * onboarding must not fall out from under the player just because a preview
 * finished building. The one place the two meet is the photo step, where a
 * successful load is the signal to start.
 */
type Stage = 'landing' | 'terms' | 'customise' | 'photo' | 'playing'

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null)
  const pulseRef = useRef<HTMLDivElement>(null)
  const dissolveRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)

  const [status, setStatus] = useState<GameStatus>('empty')
  const [error, setError] = useState<string>()
  const [stats, setStats] = useState<GameStats>(EMPTY_STATS)
  const [muted, setMuted] = useState(false)
  const [hasBust, setHasBust] = useState(false)
  const [lightsOpen, setLightsOpen] = useState(false)

  const [stage, setStage] = useState<Stage>('landing')
  const [look, setLook] = useState<Look>(defaultLook)
  /** True when the photo step was reached from a game already in progress. */
  const [swapping, setSwapping] = useState(false)
  const [tauntOpen, setTauntOpen] = useState(false)
  /**
   * Set only by the photo step. A customiser rebuild reports 'playing' too, and
   * one still in flight when the player moves on would otherwise start the game
   * out from under the uploader.
   */
  const awaitingRef = useRef(false)

  useEffect(() => {
    if (!stageRef.current) return
    const game = new Game(stageRef.current, {
      onStatus: (next, message) => {
        setStatus(next)
        setError(next === 'error' ? message : undefined)
        if (next === 'error') awaitingRef.current = false
        if (next === 'playing') {
          setHasBust(true)
          // Only a build the photo step asked for means "start the game" — the
          // customiser rebuilds constantly and stays where it is.
          if (awaitingRef.current) {
            awaitingRef.current = false
            setStage('playing')
          }
        }
      },
      onStats: setStats,
      onHit: (power) => {
        // Web Animations rather than React state - this fires on every landed
        // hit and has no business causing a re-render. It's an edge pulse, so
        // nothing ever washes across the face.
        if (prefersReducedMotion()) return
        pulseRef.current?.animate(
          [
            { opacity: 0 },
            { opacity: 0.05 + power * 0.17, offset: 0.16 },
            { opacity: 0 },
          ],
          { duration: 190 + power * 170, easing: 'ease-out' },
        )
      },
    })
    gameRef.current = game
    return () => {
      game.dispose()
      gameRef.current = null
    }
  }, [])

  const handlePick = useCallback((file: File) => {
    awaitingRef.current = true
    void gameRef.current?.loadPhoto(file)
  }, [])

  const handleDummy = useCallback(() => {
    awaitingRef.current = true
    void gameRef.current?.loadDummy(look)
  }, [look])

  const handleTrigger = useCallback((id: AttackId) => gameRef.current?.trigger(id), [])
  const handleRelease = useCallback((id: AttackId) => gameRef.current?.release(id), [])

  const handleReset = useCallback(() => {
    gameRef.current?.reset()
    if (prefersReducedMotion()) return
    // A single sweep down the viewport reading as the damage dissolving off.
    dissolveRef.current?.animate(
      [
        { opacity: 0, transform: 'translate3d(0, -34%, 0)' },
        { opacity: 1, offset: 0.3 },
        { opacity: 0, transform: 'translate3d(0, 34%, 0)' },
      ],
      { duration: 520, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)' },
    )
  }, [])

  const handleNewPhoto = useCallback(() => {
    setStatus('empty')
    setSwapping(true)
    awaitingRef.current = false
    setStage('photo')
  }, [])
  const handleCancelPick = useCallback(() => {
    setError(undefined)
    setStatus('playing')
    awaitingRef.current = false
    setStage('playing')
  }, [])
  const handleToggleMute = useCallback(() => {
    setMuted((m) => {
      gameRef.current?.setMuted(!m)
      return !m
    })
  }, [])
  const handleToggleLights = useCallback(() => setLightsOpen((v) => !v), [])

  const getLights = useCallback(() => gameRef.current?.getLights(), [])
  const setLight = useCallback(
    (id: LightId, patch: Partial<LightState>) => gameRef.current?.setLight(id, patch),
    [],
  )
  const resetLights = useCallback(() => gameRef.current?.resetLights(), [])

  /* ----------------------------------------------------------- onboarding */

  const handleStart = useCallback(() => setStage('terms'), [])
  const handleDecline = useCallback(() => setStage('landing'), [])
  // Accepting the terms goes straight to the build panel: there is no gender
  // step any more, so the dummy is raised here instead.
  const handleAccept = useCallback(() => {
    const next = defaultLook()
    setLook(next)
    setStage('customise')
    void gameRef.current?.loadDummy(next)
  }, [])

  // Every tweak goes straight to the dummy - the preview is the panel's only
  // way of showing what a preset actually does.
  const handleLookChange = useCallback((next: Look) => {
    setLook(next)
    gameRef.current?.updateLook(next)
  }, [])

  /**
   * Back to the build panel from a game in progress.
   *
   * The bust stays exactly where it is - the customiser edits it live, and it
   * now applies to a photo target too, so this is the way to restyle a face
   * you've already uploaded without re-uploading it.
   */
  const handleCustomise = useCallback(() => setStage('customise'), [])

  /**
   * Back to the start.
   *
   * `hasBust` is cleared as well as the stage, because it's what tells the
   * later screens there's a game to return to - leaving it set would make Back
   * from the customiser drop into a session the player already walked away
   * from. The bust itself is left standing; whatever is built next replaces it.
   */
  const handleHome = useCallback(() => {
    setLook(defaultLook())
    setHasBust(false)
    setStage('landing')
  }, [])

  /**
   * Leaving the build panel.
   *
   * Where "back" goes depends on how you got here. During onboarding it's the
   * previous step; opened from a game in progress it has to return to that
   * game, or tidying up a haircut would throw the session away.
   */
  const handleCustomiserBack = useCallback(() => {
    setStage(hasBust ? 'playing' : 'landing')
  }, [hasBust])

  const handleWantPhoto = useCallback(() => {
    setError(undefined)
    setStatus('empty')
    setSwapping(false)
    awaitingRef.current = false
    setStage('photo')
  }, [])
  const handleSkipPhoto = useCallback(() => {
    awaitingRef.current = false
    setStage('playing')
  }, [])

  const handleTaunt = useCallback((text: string) => gameRef.current?.taunt(text), [])
  const handleTauntToggle = useCallback(() => setTauntOpen((v) => !v), [])

  // T opens the box. It lives here rather than in Game's key handler because
  // Game owns attacks, and this one is a piece of UI that happens to have a
  // shortcut - Game has no business knowing an input exists.
  useEffect(() => {
    if (stage !== 'playing' || tauntOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 't' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      setTauntOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, tauntOpen])

  // Keystrokes shouldn't land while anything is covering the stage - and while
  // the taunt box is open the letters belong to the sentence, not the fists.
  useEffect(() => {
    if (gameRef.current) gameRef.current.inputEnabled = stage === 'playing' && !tauntOpen
  }, [stage, tauntOpen])

  // A taunt box left open over the uploader would eat its typing.
  useEffect(() => {
    if (stage !== 'playing') setTauntOpen(false)
  }, [stage])

  return (
    <div className="app">
      <div ref={stageRef} className="stage" />
      <div ref={pulseRef} className="hit-pulse" aria-hidden />
      <div ref={dissolveRef} className="dissolve" aria-hidden />

      {stage === 'playing' && (
        <>
          <Hud
            stats={stats}
            muted={muted}
            lightsOpen={lightsOpen}
            onReset={handleReset}
            onCustomise={handleCustomise}
            onHome={handleHome}
            onNewPhoto={handleNewPhoto}
            onToggleMute={handleToggleMute}
            onToggleLights={handleToggleLights}
          />

          {lightsOpen && (
            <LightPanel
              getLights={getLights}
              setLight={setLight}
              resetLights={resetLights}
              onClose={handleToggleLights}
            />
          )}

          {tauntOpen && (
            <TauntBox onSend={handleTaunt} onClose={() => setTauntOpen(false)} />
          )}

          <HotkeyDock
            onTrigger={handleTrigger}
            onRelease={handleRelease}
            onTaunt={handleTauntToggle}
            tauntOpen={tauntOpen}
          />
        </>
      )}

      {(stage === 'landing' || stage === 'terms') && (
        <Landing onStart={handleStart} behind={stage === 'terms'} />
      )}

      {stage === 'terms' && <Terms onAccept={handleAccept} onCancel={handleDecline} />}


      {stage === 'customise' && (
        <Customiser
          look={look}
          onChange={handleLookChange}
          onBack={handleCustomiserBack}
          onNext={handleWantPhoto}
        />
      )}

      {stage === 'photo' && (
        <div className="overlay">
          <div className="photo-step">
            <Uploader
              onPick={handlePick}
              onDummy={handleDummy}
              busy={status === 'loading'}
              error={error}
              onCancel={swapping && hasBust && status !== 'loading' ? handleCancelPick : undefined}
            />

            {!swapping && (
              <button
                type="button"
                className="link-button"
                onClick={handleSkipPhoto}
                disabled={status === 'loading'}
              >
                <span>Skip — keep it faceless</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
