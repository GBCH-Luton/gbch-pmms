import { useRef, useState } from 'react'
import { speechToTextSupported } from '../lib/speechToText'

// One-shot dictation: the browser already waits for a natural pause
// in speech before firing a single final result, so there's no need
// for continuous/interim-results complexity for filling in a single
// description field. Hidden entirely on browsers without support
// (Firefox, iOS Safari) rather than rendering a button that can't work.
export default function VoiceInputButton({ onResult }) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)

  if (!speechToTextSupported()) return null

  function handleClick() {
    if (listening) { recognitionRef.current?.stop(); return }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.lang = 'en-GB'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (e) => onResult(e.results[0][0].transcript)
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={listening ? 'Stop dictation' : 'Dictate'}
      title={listening ? 'Listening…' : 'Tap to speak'}
      style={{
        background: listening ? '#fee2e2' : 'none', border: 'none', borderRadius: '8px',
        fontSize: '18px', cursor: 'pointer', flexShrink: 0, padding: '4px 8px',
        color: listening ? '#dc2626' : 'inherit',
      }}
    >
      {listening ? '⏹' : '🎤'}
    </button>
  )
}
