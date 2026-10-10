import { defineConfig } from 'vitest/config'
import { buildId } from './build-id.ts'

// The test runner (npm test): Vitest, in node, two projects. `unit`: tests
// beside what they test (thing.test.ts, .claude/codes/ts/testing.md),
// `__BUILD__` 'dev', as the dev server says. `integration`: the game server
// end to end over real sockets on port 0 (arenas, server, client, netplay),
// one file at a time in forks, after the unit tests, the build id this
// tree's (as the bundles have it: build-id.ts), and node's garbage
// collector and web storage on (the arenas' heap numbers; the custom
// lobbies' tab mark). What tests print shows even when they pass: kills a
// minute, the pins.

const INTEGRATION = ['server/arenas.test.ts', 'server/server.test.ts', 'server/client.test.ts', 'server/netplay.test.ts']

export default defineConfig({
  test: {
    silent: false,
    // npm run test:coverage: V8's, over the game's own code, tests aside; printed only, no threshold yet
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}'],
      reporter: ['text', 'text-summary'],
    },
    projects: [
      {
        define: { __BUILD__: JSON.stringify('dev') },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', '*.test.ts'],
          exclude: INTEGRATION,
          sequence: { groupOrder: 0 },
        },
      },
      {
        define: { __BUILD__: JSON.stringify(buildId()) },
        test: {
          name: 'integration',
          environment: 'node',
          include: INTEGRATION,
          pool: 'forks',
          fileParallelism: false,
          execArgv: ['--expose-gc', '--experimental-webstorage'],
          testTimeout: 600_000,
          hookTimeout: 600_000,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
