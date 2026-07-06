// Generates a readable temp password — avoids confusable characters (0, O, I, l, 1)
// so the admin can read it aloud over the phone without ambiguity.
export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}
