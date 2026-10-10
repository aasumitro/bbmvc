// Tests for the bots' router.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { routesTo } from './navigation.ts'

// Every check is a test of its own, in order, under its label (the it.each
// at the end); a failed one fails its test, and the rest still run.
const checks: Array<[string, boolean]> = []
const check = (ok: boolean, what: string) => void checks.push([what, ok])

// A 100 m square with one diagonal road; node 4 is cut off.
//   0 --- 1
//   |   / |
//   3 --- 2      4
const at = (x: number, z: number) => new THREE.Vector3(x, 0, z)
const nav = { nodes: [at(0, 0), at(100, 0), at(100, 100), at(0, 100), at(300, 300)], links: [[1, 3], [0, 2, 3], [1, 3], [0, 2, 1], []] }
const { cost, next } = routesTo(nav, 3)
check(next[3] === -1, 'the end has no next hop')
check(next[1] === 3 && Math.abs(cost[1] - Math.hypot(100, 100)) < 1e-9, 'the diagonal beats going round')
check(next[0] === 3 && next[2] === 3, 'neighbours drive straight there')
check(cost[4] === Infinity && next[4] === -1, 'a cut-off node has no route')
describe('the router', () => {
  it.each(checks)('%s', (_, ok) => expect(ok).toBe(true))
})
