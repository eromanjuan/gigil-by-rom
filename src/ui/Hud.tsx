import type { GameStats } from '../game/Game'
import { IconHeal, IconLight, IconPhoto, IconSound, IconSoundOff, IconTune } from './icons'

type Props = {
  stats: GameStats
  muted: boolean
  lightsOpen: boolean
  onReset: () => void
  onCustomise: () => void
  onNewPhoto: () => void
  onToggleMute: () => void
  onToggleLights: () => void
}

/**
 * The edge rails: damage tracker top-left, tool cluster top-right. Both use
 * the shared `.glass` recipe so they read as one system rather than two boxes.
 * Nothing here ever crosses the middle of the viewport.
 */
export default function Hud({
  stats,
  muted,
  lightsOpen,
  onReset,
  onCustomise,
  onNewPhoto,
  onToggleMute,
  onToggleLights,
}: Props) {
  const pain = Math.max(0, Math.min(100, stats.pain))

  return (
    <>
      <div className="rail rail-left">
        <section
          className={`tracker glass${pain >= 85 ? ' is-critical' : ''}`}
          aria-label="Damage tracker"
        >
          <div className="tracker-head">
            <span className="label">Damage</span>
            <span
              className="value"
              role="meter"
              aria-label="Damage"
              aria-valuenow={Math.round(pain)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${Math.round(pain)} percent`}
            >
              {Math.round(pain)}
            </span>
          </div>

          <div className="meter-track" aria-hidden>
            <div className="meter-fill" style={{ width: `${pain}%` }} />
          </div>

          <div className="chips">
            <div className={`chip${stats.combo > 1 ? ' is-hot' : ''}`}>
              <b>{stats.combo}</b>
              <span>Combo</span>
            </div>
            <div className="chip">
              <b>{stats.hits}</b>
              <span>Hits</span>
            </div>
            <div className="chip">
              <b>{stats.bestCombo}</b>
              <span>Best</span>
            </div>
          </div>
        </section>
      </div>

      <div className="rail rail-right">
        <div className="tools glass" role="group" aria-label="Game controls">
          <button
            type="button"
            className="tool"
            onClick={onToggleMute}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
            title={muted ? 'Unmute sound' : 'Mute sound'}
          >
            <span className="ico" aria-hidden>
              {muted ? <IconSoundOff /> : <IconSound />}
            </span>
          </button>

          <button
            type="button"
            className="tool"
            onClick={onToggleLights}
            aria-expanded={lightsOpen}
            aria-controls="light-panel"
            aria-label="Lighting controls"
            title="Lighting controls"
          >
            <span className="ico" aria-hidden>
              <IconLight />
            </span>
            <span className="txt">Lighting</span>
          </button>

          <span className="tool-sep" aria-hidden />

          <button
            type="button"
            className="tool tool-heal"
            onClick={onReset}
            aria-label="Heal the damage and reset the score"
            title="Heal the damage and reset the score"
          >
            <span className="ico" aria-hidden>
              <IconHeal />
            </span>
            <span className="txt">Heal</span>
          </button>

          <button
            type="button"
            className="tool"
            onClick={onCustomise}
            aria-label="Change the hair and outfit"
            title="Change the hair and outfit"
          >
            <span className="ico" aria-hidden>
              <IconTune />
            </span>
            <span className="txt">Customise</span>
          </button>

          <button
            type="button"
            className="tool"
            onClick={onNewPhoto}
            aria-label="Load a different photo"
            title="Load a different photo"
          >
            <span className="ico" aria-hidden>
              <IconPhoto />
            </span>
            <span className="txt">New photo</span>
          </button>
        </div>
      </div>
    </>
  )
}
