import * as THREE from 'three'
import { createRng } from '../../shared/rng.ts'

// Vector artwork (faction crest, banners, mesh grates) is easier to draw with
// Canvas 2D than in a shader, so these textures are painted here instead of baked.

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return { canvas, ctx: canvas.getContext('2d')! }
}

function toTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function polygon(ctx: CanvasRenderingContext2D, points: Array<[number, number]>) {
  ctx.beginPath()
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
  ctx.fill()
}

// Tapered feather from a root point; angle is radians above the +x axis.
function feather(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, width: number) {
  const dx = Math.cos(angle)
  const dy = -Math.sin(angle)
  const along = (t: number, side: number): [number, number] => [x + dx * length * t - dy * width * side, y + dy * length * t + dx * width * side]
  polygon(ctx, [along(0, 0.5), along(0.8, 0.3), along(1, 0), along(0.75, -0.35), along(0, -0.5)])
}

// Right half of the crest in a 512-unit box, x measured from the centre line.
// Shapes overlap the centre slightly so the mirrored halves meet without a seam.
function drawCrestHalf(ctx: CanvasRenderingContext2D) {
  const wing = [
    [72, 200, 30],
    [54, 205, 28],
    [36, 190, 26],
    [18, 165, 24],
    [0, 130, 22],
  ]
  wing.forEach(([degrees, length, width], i) => feather(ctx, 34 + i * 8, 236 + i * 10, (degrees * Math.PI) / 180, length, width))
  ctx.beginPath()
  ctx.ellipse(62, 244, 42, 28, -0.4, 0, Math.PI * 2)
  ctx.fill()

  // skull, crest spikes, shield body, tail
  ctx.beginPath()
  ctx.moveTo(-2, 166)
  ctx.quadraticCurveTo(46, 166, 50, 212)
  ctx.lineTo(44, 262)
  ctx.lineTo(26, 298)
  ctx.lineTo(-2, 312)
  ctx.closePath()
  ctx.fill()
  polygon(ctx, [
    [-2, 172],
    [9, 112],
    [20, 170],
  ])
  polygon(ctx, [
    [22, 176],
    [42, 134],
    [40, 190],
  ])
  polygon(ctx, [
    [-2, 292],
    [38, 284],
    [14, 362],
    [-2, 424],
  ])
  feather(ctx, 10, 372, (-62 * Math.PI) / 180, 92, 20)
  feather(ctx, 4, 390, (-82 * Math.PI) / 180, 80, 18)

  // eye socket, nose, teeth are cut out of the skull
  ctx.globalCompositeOperation = 'destination-out'
  polygon(ctx, [
    [8, 214],
    [38, 204],
    [35, 228],
    [12, 236],
  ])
  polygon(ctx, [
    [-2, 246],
    [8, 262],
    [-2, 266],
  ])
  ctx.fillRect(6, 278, 4, 18)
  ctx.fillRect(18, 276, 4, 14)
  ctx.globalCompositeOperation = 'source-over'
}

// White crest on transparent, already chipped so it reads as old paint.
function drawCrest(size: number, seed: number) {
  const { canvas, ctx } = createCanvas(size, size)
  ctx.fillStyle = '#f2ede4'
  for (const side of [1, -1]) {
    ctx.save()
    ctx.scale(size / 512, size / 512)
    ctx.translate(256, 0)
    ctx.scale(side, 1)
    drawCrestHalf(ctx)
    ctx.restore()
  }

  const rng = createRng(seed)
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 500; i++) {
    ctx.beginPath()
    ctx.arc(rng() * size, rng() * size, (0.5 + rng() * 2.5) * (size / 512), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

export function createEmblemTexture() {
  return toTexture(drawCrest(512, 7))
}

// Hanging faction banner: dyed cloth, dark header, crest, torn hem (alpha).
export function createBannerTexture() {
  const width = 256
  const height = 512
  const rng = createRng(11)
  const { canvas, ctx } = createCanvas(width, height)

  const cloth = ctx.createLinearGradient(0, 0, width, 0)
  cloth.addColorStop(0, '#5a0b08')
  cloth.addColorStop(0.5, '#8f1711')
  cloth.addColorStop(1, '#5a0b08')
  ctx.fillStyle = cloth
  ctx.fillRect(0, 0, width, height)

  // weave grain and vertical folds
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,190,160,0.06)'
    ctx.fillRect(rng() * width, rng() * height, 1 + rng() * 3, 1)
  }
  for (let x = 0; x < width; x += 32) {
    const fold = ctx.createLinearGradient(x, 0, x + 32, 0)
    fold.addColorStop(0, 'rgba(0,0,0,0.18)')
    fold.addColorStop(0.5, 'rgba(255,255,255,0.04)')
    fold.addColorStop(1, 'rgba(0,0,0,0.18)')
    ctx.fillStyle = fold
    ctx.fillRect(x, 0, 32, height)
  }

  ctx.fillStyle = '#1a1411'
  ctx.fillRect(0, 0, width, 36)
  ctx.globalAlpha = 0.92
  ctx.drawImage(drawCrest(512, 3), 18, 96, 220, 220)
  ctx.globalAlpha = 1

  // soot creeping up from the hem
  const soot = ctx.createLinearGradient(0, height * 0.6, 0, height)
  soot.addColorStop(0, 'rgba(20,10,6,0)')
  soot.addColorStop(1, 'rgba(20,10,6,0.75)')
  ctx.fillStyle = soot
  ctx.fillRect(0, height * 0.6, width, height * 0.4)

  // torn hem
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.moveTo(0, height)
  for (let x = 0; x <= width; x += 8) ctx.lineTo(x, height - 6 - rng() * 44)
  ctx.lineTo(width, height)
  ctx.closePath()
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  return toTexture(canvas)
}

// Diamond mesh for window guards and fences; opaque wire on transparent.
export function createGrateTexture() {
  const size = 128
  const { canvas, ctx } = createCanvas(size, size)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 7
  for (let i = -size; i <= size * 2; i += size / 4) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + size, size)
    ctx.moveTo(i, size)
    ctx.lineTo(i + size, 0)
    ctx.stroke()
  }
  const texture = toTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

// Soft round spot, white at the centre fading to nothing at the rim.
export function createGlowTexture() {
  const size = 128
  const { canvas, ctx } = createCanvas(size, size)
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.3, 'rgba(255,255,255,0.6)')
  glow.addColorStop(0.65, 'rgba(255,255,255,0.18)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  return toTexture(canvas)
}

// Neon tube lettering on black (meant for additive blending): a coloured
// halo around each stroke and a white-hot core. `vertical` stacks one letter
// per row, for blade signs.
export function createNeonTexture(text: string, color: string, vertical: boolean) {
  const cell = 128
  const letters = vertical ? [...text] : [text]
  const width = vertical ? cell : Math.min(2048, Math.ceil(text.length * 0.7 * cell) + cell)
  const height = vertical ? cell * letters.length : cell * 1.25
  const { canvas, ctx } = createCanvas(width, height)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.font = `800 ${cell * 0.74}px Manrope, "Arial Black", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const [lineWidth, style, blur] of [
    [10, color, 26],
    [5, color, 8],
    [1.8, '#fff6ea', 0],
  ] as const) {
    ctx.shadowBlur = blur
    ctx.shadowColor = color
    ctx.strokeStyle = style
    ctx.lineWidth = lineWidth
    letters.forEach((letter, i) => ctx.strokeText(letter, width / 2, vertical ? cell * (i + 0.55) : height / 2))
  }
  return toTexture(canvas)
}

const ADS = [
  { sky: ['#9b2014', '#2a0806'], headline: 'SCRAP COLA', tagline: 'TASTES LIKE VICTORY', accent: '#f2c14e', ink: '#f7efe2' },
  { sky: ['#1d3346', '#07090c'], headline: 'MAYHEM MOTORS', tagline: '0% APR ON WAR RIGS', accent: '#ef4444', ink: '#f2ece0' },
  { sky: ['#e8dcc2', '#a8946d'], headline: 'BURNOUT', tagline: "INSURANCE · WE DON'T COVER THIS", accent: '#8e1b12', ink: '#1c1a18' },
]

// Weathered roadside advert: gradient, a slash of accent colour, headline and
// tagline, then drips, sun-bleached patches and a torn corner.
export function createBillboardTexture(variant: number) {
  const ad = ADS[variant % ADS.length]
  const width = 1024
  const height = 512
  const rng = createRng(31 + variant)
  const { canvas, ctx } = createCanvas(width, height)
  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, ad.sky[0])
  sky.addColorStop(1, ad.sky[1])
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = ad.accent
  polygon(ctx, [
    [0, height * 0.72],
    [width, height * 0.5],
    [width, height * 0.62],
    [0, height * 0.84],
  ])

  ctx.fillStyle = ad.ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `800 ${ad.headline.length > 10 ? 118 : 150}px Manrope, "Arial Black", sans-serif`
  ctx.fillText(ad.headline, 56, 230)
  ctx.font = '700 44px Manrope, "Arial Black", sans-serif'
  ctx.fillText(ad.tagline.split('').join(String.fromCharCode(8202)), 60, 300)

  // weather: drips from the top edge, bleached patches, grime, a torn corner
  for (let i = 0; i < 90; i++) {
    const x = rng() * width
    const length = 20 + rng() * 220
    const drip = ctx.createLinearGradient(0, 0, 0, length)
    drip.addColorStop(0, 'rgba(20,14,10,0.55)')
    drip.addColorStop(1, 'rgba(20,14,10,0)')
    ctx.fillStyle = drip
    ctx.fillRect(x, 0, 2 + rng() * 5, length)
  }
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(255,248,235,${0.04 + rng() * 0.1})`
    ctx.beginPath()
    ctx.ellipse(rng() * width, rng() * height, 20 + rng() * 90, 10 + rng() * 50, rng() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.05)'
    ctx.fillRect(rng() * width, rng() * height, 1 + rng() * 3, 1 + rng() * 3)
  }
  ctx.fillStyle = '#0d0b0a'
  polygon(ctx, [
    [width, 0],
    [width - 170 - rng() * 60, 0],
    [width - 120, 40 + rng() * 30],
    [width - 60, 70 + rng() * 40],
    [width, 150 + rng() * 60],
  ])
  return toTexture(canvas)
}
