import type { CoreEngineInterface } from 'claude-code'

import type { NoteKey } from './locale'

type Engine = Pick<CoreEngineInterface, 'fs' | 'process'>

export type TouchState = 'text' | 'absent' | 'large' | 'unreadable'
export type TouchRecord = { path: string; state: TouchState; toolUseId: string }

export type BasePlan = { kind: 'record' } | { kind: 'base'; base: string } | { kind: 'note'; note: NoteKey }

export const MAX_BASE_BYTES = 1_000_000
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000

const STATES: readonly string[] = ['text', 'absent', 'large', 'unreadable']
// セッションのフォルダ名に使う。. や / を含む名前は、消すときにフォルダの外を指しうるので受け付けない。
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

export const touchKey = (path: string): string => fnv1a(path, 0x811c9dc5) + fnv1a(path, 0x9e3779b9)

export function parseRecord(text: string): TouchRecord | null {
  try {
    const value = JSON.parse(text) as { path?: unknown; state?: unknown; toolUseId?: unknown }
    return typeof value.path === 'string' &&
      typeof value.state === 'string' &&
      STATES.includes(value.state) &&
      typeof value.toolUseId === 'string'
      ? { path: value.path, state: value.state as TouchState, toolUseId: value.toolUseId }
      : null
  } catch {
    return null
  }
}

/**
 * 記録を優先する。会話の記録の中身は、古くなると空になって使えないため。
 * ただし記録の呼び出しが会話の記録で 2 回目以降の書き換えなら、記録の中身は最初に触る前ではないので使わない（mod の読み込み前に編集済みのファイルで起きる）。
 */
export function planBase(
  record: { state: TouchState; toolUseId: string } | undefined,
  touch: { base: string | null; later: readonly string[] } | undefined,
): BasePlan {
  const state = record === undefined || touch?.later.includes(record.toolUseId) === true ? undefined : record.state
  if (state === 'text') return { kind: 'record' }
  if (state === 'absent') return { kind: 'base', base: '' }
  if (state === 'large') return { kind: 'note', note: 'tooLarge' }
  if (state === 'unreadable') return { kind: 'note', note: 'unavailable' }
  return typeof touch?.base === 'string' ? { kind: 'base', base: touch.base } : { kind: 'note', note: 'unavailable' }
}

/** ツールが書き換えたときの、結果に書かれたパス。拒否・エラー・保留（staged）で書き換えていなければ null。 */
export function writtenPath(outcome: { deny?: unknown; isError?: unknown; result?: unknown }, fallback: string): string | null {
  if (typeof outcome.deny === 'string' || outcome.isError === true) return null
  const r = (typeof outcome.result === 'object' && outcome.result !== null ? outcome.result : {}) as { filePath?: unknown; staged?: unknown }
  if (r.staged === true) return null
  return typeof r.filePath === 'string' ? r.filePath : fallback
}

export function staleSessions(
  dirs: readonly { name: string; mtimeMs: number }[],
  now: number,
  current: string,
  keepMs = KEEP_MS,
): string[] {
  return dirs.filter(d => d.name !== current && SESSION_ID.test(d.name) && now - d.mtimeMs > keepMs).map(d => d.name)
}

type Place = { root: string; session: string }

async function placeOf($: Engine): Promise<Place | null> {
  const env = await $.process.hookEnv()
  const data = env.CLAUDE_PLUGIN_DATA ?? ''
  const session = env.CLAUDE_CODE_SESSION_ID ?? ''
  return data.startsWith('/') && SESSION_ID.test(session) ? { root: `${data}/first-touches`, session } : null
}

export type Capture = { dir: string; path: string; toolUseId: string; state: TouchState; text?: string }

// 同じファイルへの書き換えが重なると、2 本目が 1 本目の書き換え後を読んで記録しうるので、読み取り中の鍵を持つ。
const capturing = new Set<string>()

/** path がこのセッションでまだ記録されていなければ、いまの状態を読む。記録済み・読み取り中なら null。 */
export async function captureBefore($: Engine, path: string, toolUseId: string): Promise<Capture | null> {
  const place = await placeOf($)
  if (place === null) return null
  const dir = `${place.root}/${place.session}`
  const key = touchKey(path)
  if (capturing.has(key)) return null
  capturing.add(key)
  try {
    if (await $.fs.exists(`${dir}/${key}.json`)) {
      capturing.delete(key)
      return null
    }
    const at = { dir, path, toolUseId }
    if (!(await $.fs.exists(path))) return { ...at, state: 'absent' }
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file') return { ...at, state: 'unreadable' }
    if (stat.size > MAX_BASE_BYTES) return { ...at, state: 'large' }
    const text = await $.fs.read(path).catch(() => null)
    return typeof text === 'string' ? { ...at, state: 'text', text } : { ...at, state: 'unreadable' }
  } catch (error) {
    capturing.delete(key)
    throw error
  }
}

/**
 * 読んだ状態を書き込む。path はツールの結果のパスで、変更一覧が会話の記録と突き合わせる綴りに揃える。
 * 中身を先に書き、記録の .json を後に書く（.json があれば中身も揃っている）。
 */
export async function saveCapture($: Engine, capture: Capture, path: string): Promise<void> {
  try {
    const key = touchKey(path)
    const record = `${capture.dir}/${key}.json`
    if (await $.fs.exists(record)) return
    if (capture.state === 'text') await $.fs.write(`${capture.dir}/${key}.txt`, capture.text ?? '')
    await $.fs.write(record, JSON.stringify({ path, state: capture.state, toolUseId: capture.toolUseId }))
  } finally {
    capturing.delete(touchKey(capture.path))
  }
}

export const dropCapture = (capture: Capture) => capturing.delete(touchKey(capture.path))

export type Recorded = { state: TouchState; toolUseId: string; read: () => Promise<string> }

export async function loadRecords($: Engine): Promise<Map<string, Recorded>> {
  const found = new Map<string, Recorded>()
  const place = await placeOf($).catch(() => null)
  if (place === null) return found
  const dir = `${place.root}/${place.session}`
  const entries = await $.fs.list(dir).catch(() => [])
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue
    const text = await $.fs.read(`${dir}/${entry.name}`).catch(() => null)
    const record = typeof text === 'string' ? parseRecord(text) : null
    if (record === null || found.has(record.path)) continue
    const txt = `${dir}/${entry.name.slice(0, -'.json'.length)}.txt`
    found.set(record.path, {
      state: record.state,
      toolUseId: record.toolUseId,
      read: async () => {
        const body = await $.fs.read(txt)
        if (typeof body !== 'string') throw new Error('not text')
        return body
      },
    })
  }
  return found
}

export async function removeStale($: Engine, now: number): Promise<void> {
  const place = await placeOf($)
  if (place === null) return
  const entries = await $.fs.list(place.root).catch(() => [])
  const dirs: { name: string; mtimeMs: number }[] = []
  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    const stat = await $.fs.stat(`${place.root}/${entry.name}`).catch(() => null)
    if (stat !== null) dirs.push({ name: entry.name, mtimeMs: stat.mtimeMs })
  }
  const stale = staleSessions(dirs, now, place.session)
  if (stale.length > 0) await $.process.run(['rm', '-rf', '--', ...stale.map(name => `${place.root}/${name}`)], { timeoutMs: 10_000 })
}
