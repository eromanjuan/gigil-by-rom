import { useEffect, useId, useRef, useState } from 'react'

type Props = {
  onAccept: () => void
  onCancel: () => void
}

/**
 * The gate.
 *
 * Everything past this point is a game about hitting a face, so the agreement
 * is deliberately in the way: Accept stays disabled until the box is ticked,
 * and the box is the only thing that turns it on. No auto-tick, no "agree by
 * continuing" — if it's worth writing down it's worth a deliberate click.
 */
export default function Terms({ onAccept, onCancel }: Props) {
  const [agreed, setAgreed] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const checkId = useId()

  useEffect(() => {
    // Moving focus into the dialog is what makes Escape and the tab order
    // behave; the landing behind is disabled for the same reason.
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="overlay">
      <div
        ref={dialogRef}
        className="panel glass terms"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className="terms-title">
          Before you start
        </h2>

        <div className="terms-body">
          <section>
            <h3>It gets violent</h3>
            <p>
              This is a game about repeatedly hitting a cartoon head. Expect exaggerated impacts,
              swelling, bruises, handprints and a running commentary of pained noises. It's
              stylised and silly rather than gory, but it is unmistakably violence.
            </p>
          </section>

          <section>
            <h3>Not suitable for young audiences</h3>
            <p>
              Not for children, and not for young minds still working out where the line between
              a joke and a person is. If a child is nearby, this one waits.
            </p>
          </section>

          <section>
            <h3>Your side of the deal</h3>
            <ul>
              <li>
                Don't use a photo of a real person without their consent. A friend who thinks it's
                funny is fine. Anyone who hasn't said yes is not.
              </li>
              <li>
                Don't use this to harass, threaten, humiliate or pressure anybody — don't send it to
                them, don't post it at them, don't show it to them "as a joke".
              </li>
              <li>
                It's a toy, not a threat. The whole point is that it stays on this screen and never
                becomes something you do to a person.
              </li>
              <li>
                If the anger you're carrying feels bigger than a browser tab can hold, please talk
                to someone you trust instead.
              </li>
            </ul>
          </section>
        </div>

        <label className="agree" htmlFor={checkId}>
          <input
            id={checkId}
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>I have read and agree</span>
        </label>

        <div className="terms-actions">
          <button type="button" className="ghost-btn wide-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-btn wide-btn"
            onClick={onAccept}
            disabled={!agreed}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
