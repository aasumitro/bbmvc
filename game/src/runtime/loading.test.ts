// Tests for the loading runner (loading.ts), headless: progress counts
// the tasks finished, in order, and says all done only after the last one;
// async tasks are waited for; a failure stops the list at the task that
// failed and is never reported as done; a retry completes without redoing
// what a task keeps; cancelling stops between tasks; the physics engine
// starts once.
import { describe, expect, it } from 'vitest'
import { runTasks, type Progress, type Task } from './loading.ts'
import { initPhysics } from '../sim/physics.ts'

// The runner waits for a paint between tasks; here the page is a hidden
// tab, which paints nothing, so it goes straight on.
Object.assign(globalThis, { document: { hidden: true } })

// Every check is a test of its own, in order, under its label (the it.each
// at the end); a failed one fails its test, and the rest still run.
const checks: Array<[string, boolean]> = []
const check = (ok: boolean, what: string) => void checks.push([what, ok])
const later = () => new Promise((resolve) => setTimeout(resolve))
const failureOf = (run: Promise<unknown>) =>
  run.then(
    () => null,
    (error: unknown) => error,
  )

// Every report counts exactly the tasks finished so far, sync or async.
{
  let finished = 0
  const reports: Progress[] = []
  const tasks: Task[] = [
    {
      label: 'sync',
      run: () => {
        finished++
      },
    },
    {
      label: 'async',
      run: async () => {
        await later()
        finished++
      },
    },
    {
      label: 'slow',
      run: async () => {
        await later()
        await later()
        finished++
      },
    },
  ]
  const complete = await runTasks(tasks, (progress) => {
    check(progress.done === finished, `the report says ${progress.done} done when ${finished} are`)
    reports.push(progress)
  })
  check(complete, 'a full run resolves true')
  check(
    JSON.stringify(reports) ===
      JSON.stringify([
        { done: 0, total: 3, label: 'sync' },
        { done: 1, total: 3, label: 'async' },
        { done: 2, total: 3, label: 'slow' },
        { done: 3, total: 3, label: '' },
      ]),
    'one report before each task, naming it, then one at the end',
  )
}

// No report goes out while the caller (a React effect) is still running:
// the screens commit each one at once, which React can't do in an effect.
{
  let reported = false
  const run = runTasks([{ label: 'only', run: () => {} }], () => {
    reported = true
  })
  check(!reported, 'nothing is reported before the caller has returned')
  await run
  check(reported, 'the reports follow')
}

// A failure, thrown or rejected, stops the list where it happened.
const faults = [
  () => {
    throw new Error('thrown')
  },
  async () => {
    await later()
    throw new Error('rejected')
  },
]
for (const fault of faults) {
  const ran: string[] = []
  const reports: Progress[] = []
  const task = (label: string, run = () => {}): Task => ({
    label,
    run: () => {
      ran.push(label)
      return run()
    },
  })
  const error = await failureOf(runTasks([task('fine'), task('broken', fault), task('after')], (progress) => reports.push(progress)))
  check(error instanceof Error && /thrown|rejected/.test(error.message), "the run rejects with the task's own error")
  check(ran.join() === 'fine,broken', 'nothing runs after the failed task')
  check(reports.at(-1)?.label === 'broken' && reports.at(-1)?.done === 1, 'the last report names the failed task, not counted as done')
  check(!reports.some((progress) => progress.done === progress.total), 'a failed run never reports all done')
}

// Retry: the same list again once the fault is gone. What a task keeps
// (made once, like the physics engine or the renderer) is not made again.
{
  let made = 0
  let engine: Promise<void> | undefined
  let faulty = true
  const tasks: Task[] = [
    {
      label: 'engine',
      run: () => {
        engine ??= later().then(() => {
          made++
        })
        return engine
      },
    },
    {
      label: 'faulty',
      run: () => {
        if (faulty) throw new Error('not yet')
      },
    },
  ]
  check((await failureOf(runTasks(tasks, () => {}))) instanceof Error, 'the first run fails')
  faulty = false
  check(await runTasks(tasks, () => {}), 'the retry completes')
  check(made === 1, 'the retry reuses what the first run made')
}

// Cancelling (the screen went away) stops before the next task.
{
  let gone = false
  const ran: string[] = []
  const tasks: Task[] = [
    {
      label: 'first',
      run: () => {
        ran.push('first')
        gone = true
      },
    },
    { label: 'second', run: () => ran.push('second') },
  ]
  check(
    !(await runTasks(
      tasks,
      () => {},
      () => gone,
    )),
    'a cancelled run resolves false',
  )
  check(ran.join() === 'first', 'no task starts after cancelling')
}

// The physics engine starts once, however often it's asked for.
{
  const first = initPhysics()
  check(initPhysics() === first, 'asked twice while starting: one start')
  await first
  check(initPhysics() === first, 'asked again once started: the same start')
}

describe('loading', () => {
  it.each(checks)('%s', (_, ok) => expect(ok).toBe(true))
})
