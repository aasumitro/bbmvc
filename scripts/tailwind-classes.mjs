// Every Tailwind class in the game and the site, held to the form Tailwind itself writes it in.
// Each project's own Tailwind prints each class its scanner finds (canonicalizeCandidates, a 16 px
// root, as the editor's Tailwind language server does for its suggestCanonicalClasses warning), and
// every class that comes out another way is listed with the form to use. Exits non-zero if it lists
// any. Needs each project's dependencies installed (npm ci in game/ and www/).
//   node scripts/tailwind-classes.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const PROJECTS = [
  { dir: 'game', css: 'src/index.css', sources: ['src', 'index.html'] },
  { dir: 'www', css: 'src/styles/global.css', sources: ['src'] },
]
const TEXT = /\.(tsx?|astro|mdx?|html|css)$/

const walk = (path, out = []) => {
  if (TEXT.test(path)) return [...out, path]
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const next = join(path, entry.name)
    if (entry.isDirectory()) walk(next, out)
    else if (TEXT.test(entry.name)) out.push(next)
  }
  return out
}

let found = 0
let scanned = 0
for (const project of PROJECTS) {
  const base = join(root, project.dir)
  const need = createRequire(join(base, 'package.json'))
  const { __unstable__loadDesignSystem } = await import(need.resolve('@tailwindcss/node'))
  const { Scanner } = need('@tailwindcss/oxide')
  const css = join(base, project.css)
  const tailwind = await __unstable__loadDesignSystem(readFileSync(css, 'utf8'), { base: dirname(css) })
  const scanner = new Scanner({})
  for (const file of project.sources.flatMap((source) => walk(join(base, source)))) {
    scanned++
    const content = readFileSync(file)
    const listed = new Set()
    for (const { candidate, position } of scanner.getCandidatesWithPositions({ content: content.toString('utf8'), extension: extname(file).slice(1) })) {
      if (tailwind.candidatesToCss([candidate])[0] == null) continue // not a class
      const canonical = tailwind.canonicalizeCandidates([candidate], { rem: 16 })[0]
      if (canonical === candidate) continue
      const before = content.subarray(0, position).toString('utf8')
      const at = `${relative(root, file)}:${before.split('\n').length}:${before.length - before.lastIndexOf('\n')}`
      if (listed.has(at)) continue
      listed.add(at)
      found++
      console.log(`${at}  ${candidate}  →  ${canonical}`)
    }
  }
}
console.log(found ? `\n${found} classes to write as Tailwind writes them (${scanned} files)` : `every class as Tailwind writes it (${scanned} files)`)
process.exit(found ? 1 : 0)
