// Web Speech API isn't available in Firefox or in Safari on iOS --
// only Chrome/Edge (desktop and Android) and Safari on macOS support
// it. Same feature-detection convention as pushNotificationsSupported()
// in pushNotifications.js: a plain sync check, callers hide the whole
// button when unsupported rather than showing a broken one.
export function speechToTextSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}
