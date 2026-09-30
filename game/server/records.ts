import { createWriteStream, mkdirSync } from 'node:fs'
import { appendFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createGzip } from 'node:zlib'
import type { MatchRecord, ReplayLine } from './room'

// What the server keeps of its matches, under MATCH_DIR: one JSON line per
// match that ended (matches-YYYY-MM.jsonl, kept), and one replay per room
// (replays/YYYY-MM-DD/<room>-<ms>.ndjson.gz: the room's journal, gzipped as
// it runs, closed with the room; replay.ts runs it again). Replays older
// than `days` are deleted at start and then daily. Nothing here is on the
// step's path: appends and the gzip stream are asynchronous, and a write
// that fails is logged, never thrown.

export interface RecordsOptions {
  dir: string
  days: number // replays kept
  log: (message: string, fields: Record<string, unknown>) => void
}

export type Records = ReturnType<typeof createRecords>

export function createRecords({ dir, days, log }: RecordsOptions) {
  const replays = join(dir, 'replays')
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const failed = (what: string) => (error: unknown) => log('record failed', { what, error: String(error) })

  // Replay folders are named by day; the ones past `days` go.
  async function prune() {
    const cutoff = day(Date.now() - days * 24 * 3600 * 1000)
    const folders = await readdir(replays).catch(() => [] as string[])
    for (const folder of folders) if (/^\d{4}-\d{2}-\d{2}$/.test(folder) && folder < cutoff) await rm(join(replays, folder), { recursive: true, force: true }).catch(failed(`prune ${folder}`))
  }
  void prune()
  const daily = setInterval(() => void prune(), 24 * 3600 * 1000)
  daily.unref()

  return {
    match(record: MatchRecord) {
      const file = join(dir, `matches-${record.ended.slice(0, 7)}.jsonl`)
      void mkdir(dir, { recursive: true })
        .then(() => appendFile(file, `${JSON.stringify(record)}\n`))
        .catch(failed(`match ${record.room}#${record.match}`))
    },
    // A room's journal, into its replay file; `end` closes it (resolves once it's on disk).
    replay(room: string, created: number) {
      const folder = join(replays, day(created))
      const path = join(folder, `${room}-${created}.ndjson.gz`)
      mkdirSync(folder, { recursive: true })
      const gzip = createGzip()
      const file = createWriteStream(path)
      gzip.pipe(file)
      gzip.on('error', failed(`replay ${path}`))
      file.on('error', failed(`replay ${path}`))
      const done = new Promise<void>((resolve) => file.on('close', () => resolve()))
      return {
        path,
        write: (line: ReplayLine) => void gzip.write(`${JSON.stringify(line)}\n`),
        end() {
          gzip.end()
          return done
        },
      }
    },
    close: () => clearInterval(daily),
  }
}
