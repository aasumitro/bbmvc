import { defineConfig, type Plugin } from 'vite'
import { buildId } from './build-id.ts'

// The game server's build (npm run server:build): server/ bundled for Node
// with everything it imports — the browser's own simulation, modes, bots,
// arenas and registries, Three.js, Rapier (its WASM is inline) and ws — so
// dist-server/ runs with plain `node` and nothing installed next to it.
// Vite, not plain node, because the shared code reads import.meta.env and
// __BUILD__. The capacity tool and the replay runner build with it.
// __BUILD__ is the build id (build-id.ts): the pages the server lets in.

const ENTRIES = {
  main: 'server/main.ts',
  load: 'server/load.ts',
  replay: 'server/replay-main.ts',
}

// dist-server/ is ES modules wherever it's copied to (the server has no package.json next to it).
const moduleType: Plugin = {
  name: 'module-type',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'package.json', source: '{ "type": "module" }\n' })
  },
}

export default defineConfig({
  publicDir: false, // the browser's static files have no place on the server
  define: { __BUILD__: JSON.stringify(buildId()) },
  plugins: [moduleType],
  ssr: { noExternal: true, external: ['bufferutil', 'utf-8-validate'] }, // ws's optional native helpers: it does without
  build: {
    ssr: true,
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    minify: false, // stack traces a person can read in the server's logs
    rolldownOptions: {
      input: ENTRIES,
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[hash].js' },
    },
  },
})
