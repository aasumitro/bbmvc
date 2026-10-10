// Just enough DOM for the arena builders to run in Node: the canvases they
// paint (the ground's layout, signs, banners, neon) are fakes whose 2D
// context takes every call and draws nothing. The builders run unchanged, so
// every call happens in the same order and their seeded streams draw the
// same numbers: the layout comes out as the browser's. Defines `document`
// only — no `window` — which is how render/materials/library.ts knows to skip the
// GPU bake. Imported first by anything on the server that builds an arena.

interface Anything {
  (...args: unknown[]): Anything
  [key: string | symbol]: Anything
}

// A value any call, property or chain on it resolves to (gradients, patterns, paths).
const dummy: Anything = new Proxy(function () {} as unknown as Anything, {
  get: (_target, key) => (key === Symbol.toPrimitive ? () => 0 : dummy),
  apply: () => dummy,
  set: () => true,
})

const pixels = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(Math.max(0, width * height * 4)) })

function context2d(canvas: object) {
  const state: Record<PropertyKey, unknown> = { canvas } // fillStyle, font, filter...: kept, never used
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'measureText') return () => ({ width: 0 })
      if (key === 'getImageData') return (_x: number, _y: number, width: number, height: number) => pixels(width, height)
      if (key === 'createImageData')
        return (width: number | { width: number; height: number }, height?: number) =>
          typeof width === 'number' ? pixels(width, height ?? 0) : pixels(width.width, width.height)
      return () => dummy
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
}

function createCanvas() {
  const canvas: Record<string, unknown> = { width: 300, height: 150 }
  const context = context2d(canvas)
  canvas.getContext = () => context
  return canvas
}

if (typeof globalThis.document === 'undefined') {
  Reflect.set(globalThis, 'document', { createElement: (tag: string) => (tag === 'canvas' ? createCanvas() : {}) })
}
