import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// One test runner: the plain-node checks (`*.check.ts`, run by `npm run
// check` and the bundled `server:check`) all moved into Vitest in the
// refactor's stage 9, every assertion one test. None comes back.

const game = fileURLToPath(new URL('.', import.meta.url))

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.name.endsWith('.check.ts')) yield path
  }
}

describe('one test runner', () => {
  it('no *.check.ts is left', () => {
    const left = [...walk(join(game, 'src')), ...walk(join(game, 'server')), ...readdirSync(game).filter((name) => name.endsWith('.check.ts'))]
    expect(left).toEqual([])
  })
})

// Code outside a mode learns about modes from its traits (src/modes/traits.ts),
// never by comparing ids: no 'tdm' or 'ffa' string literal outside the modes,
// the data that lists them, and the checks; and the screens and the HUD never
// ask which mode runs (a mode's own panels do: src/modes/views.ts).
const MODE_LITERAL = /(['"`])(tdm|ffa)\1/
const MODE_KIND = /\bkind\s*[!=]==/
const ALLOWED = [
  /^src\/modes\/(ids|traits|modes)\.ts$/,
  /^src\/modes\/(tdm|ffa)\//,
  /^src\/content\/arenas\/maps\.ts$/, // the modes each arena hosts
  /^src\/App\.tsx$/, // the first pick
  /\.(check|test)\.tsx?$/,
  /^server\/(browser|load)\.ts$/, // the checks' page, the capacity tool
]

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sources(path)
    else if (/\.tsx?$/.test(entry.name)) yield relative(game, path).split(sep).join('/')
  }
}

describe('no mode literal outside the modes', () => {
  const files = [...sources(join(game, 'src')), ...sources(join(game, 'server'))].filter((file) => !ALLOWED.some((allowed) => allowed.test(file)))

  it('reads the sources', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it.each(files)('%s', (file) => {
    const ui = /^src\/(hud|screens)\//.test(file)
    const lines = readFileSync(join(game, file), 'utf8')
      .split('\n')
      .flatMap((line, i) => (MODE_LITERAL.test(line) || (ui && /\bmode\.kind\b/.test(line) && MODE_KIND.test(line)) ? [`${i + 1}: ${line.trim()}`] : []))
    expect(lines, 'compare against MODE_TRAITS (src/modes/traits.ts), not a mode id').toEqual([])
  })
})
