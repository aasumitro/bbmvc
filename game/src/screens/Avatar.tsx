// A person's badge, drawn from a hash of their user id (FNV-1a): a helmet in
// its own two colours with one of four markings, the same on every page and
// for every viewer; no files. A bot gets the robot glyph.

const MARKINGS = [
  <rect key="stripe" x="14.5" y="7.5" width="3" height="9" />,
  <path key="twin" d="M11 9h2.5v8H11zM18.5 9H21v8h-2.5z" />,
  <path key="chevron" d="m10 15 6-5 6 5v3l-6-5-6 5z" />,
  <path key="dots" d="M12 12.5a1.6 1.6 0 1 0 0 .1zM16 10a1.6 1.6 0 1 0 0 .1zM20 12.5a1.6 1.6 0 1 0 0 .1z" />,
]

export function Avatar({ uid, className = 'h-9 w-9' }: { uid: string; className?: string }) {
  let hash = 0x811c9dc5
  for (let i = 0; i < uid.length; i++) hash = Math.imul(hash ^ uid.charCodeAt(i), 0x01000193)
  hash >>>= 0
  const hue = hash % 360
  const trim = (hue + 90 + ((hash >>> 9) % 180)) % 360
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={`shrink-0 rounded-sm ${className}`}>
      <rect width="32" height="32" fill={`hsl(${hue} 30% 16%)`} />
      <path d="M5 26v-5C5 12 10 6 16 6s11 6 11 15v5z" fill={`hsl(${hue} 55% 46%)`} />
      <g fill={`hsl(${trim} 70% 62%)`}>{MARKINGS[(hash >>> 17) % MARKINGS.length]}</g>
      <path d="M8 19.5h16l-1.5 4h-13z" fill="#0b0908" />
      <path d="M10 21h5" stroke="white" strokeOpacity="0.45" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  )
}

export function Robot({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 4v4M12 4h8" />
      <rect x="7" y="8" width="18" height="12" rx="3" />
      <circle cx="12.5" cy="14" r="1.2" fill="currentColor" />
      <circle cx="19.5" cy="14" r="1.2" fill="currentColor" />
      <path d="M4 12v4M28 12v4M11 20v3h10v-3M13 23v5M19 23v5M9 28h14" />
    </svg>
  )
}
