import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { buildId } from './build-id.ts'

// https://vite.dev/config/
// __BUILD__: the build id the page says hello with (net/protocol.ts); 'dev' from the dev server.
// The libraries go in chunks of their own, so a deploy that changes only the game's code leaves them
// cached: React with the page's entry, three and Rapier with the game alone (main.tsx: a device without a
// mouse never downloads the game).
const library = (names: string[]) => new RegExp(`node_modules[\\\\/](${names.join('|')})[\\\\/]`)

// Rapier's compat build carries its WASM inline, as 2.7 MB of base64 in its JS. In the page's build the
// same bytes (the package's own rapier_wasm3d_bg.wasm: identical) go out as a file, compiled as it streams
// in. The dev server and the game server's bundle keep them inline (Node's fetch reads no files).
const rapierWasmFile: Plugin = {
  name: 'rapier-wasm-file',
  apply: 'build',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/@dimforge/rapier3d-compat/dist/rapier.mjs')) return
    const inline = /[\w$]+\.toByteArray\("[A-Za-z0-9+/=]+"\)\.buffer/
    if (!inline.test(code)) this.error('rapier.mjs has no inline WASM to take out: a new Rapier?')
    return `import rapierWasm from './rapier_wasm3d_bg.wasm?url'\n${code.replace(inline, 'rapierWasm')}`
  },
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), rapierWasmFile],
  define: { __BUILD__: JSON.stringify(command === 'serve' ? 'dev' : buildId()) },
  server: { port: 3000 },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: library(['react', 'react-dom', 'scheduler']) },
            { name: 'engine', test: library(['three', '@dimforge']) },
          ],
        },
      },
    },
  },
}))
