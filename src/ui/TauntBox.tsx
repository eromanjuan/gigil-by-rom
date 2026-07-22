import { useEffect, useRef, useState } from 'react'
import { MAX_TAUNT } from '../game/taunt'

type Props = {
  onSend: (text: string) => void
  onClose: () => void
}

/**
 * The verbal attack input.
 *
 * Stays open after sending rather than closing, because the point of it is a
 * volley - closing after every word would make the second insult cost three
 * actions. Escape is the way out, and the game's own key handling is suspended
 * while this has focus so typing "z" doesn't also throw a punch.
 */
export default function TauntBox({ onSend, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const send = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div className="taunt-wrap">
      <form
        className="taunt glass"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <label className="sr-only" htmlFor="taunt-input">
          Say something to the target
        </label>
        <input
          id="taunt-input"
          ref={inputRef}
          className="taunt-input"
          value={text}
          maxLength={MAX_TAUNT}
          autoComplete="off"
          spellCheck={false}
          placeholder="Say it to their face…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
            // The dock listens on window for the attack keys; while this is
            // focused they belong to the sentence being typed.
            e.stopPropagation()
          }}
        />
        <span className="taunt-count" aria-hidden>
          {MAX_TAUNT - text.length}
        </span>
        <button type="submit" className="taunt-send" disabled={!text.trim()}>
          Throw it
        </button>
      </form>
      <p className="taunt-hint">Enter to throw · Esc to close</p>
    </div>
  )
}
