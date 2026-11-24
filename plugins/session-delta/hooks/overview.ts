import type { CoreEngineInterface } from 'claude-code'

import type { DiffBase, Overview, OverviewFile, OverviewGroup, OverviewHunk } from '../types'
import { addedHunks, countChanges } from './diff'
import type { Messages } from './locale'
import { noiseKind } from './noise'
import { ancestors, placesFor, PROJECT_MARKERS, type Place } from './places'
import {
  collectFirstTouches,
  displayPath,
  expandHome,
  parseGitDiff,
  parseHunks,
  parseNumstat,
  renameDisplay,
  rootOf,
  type GitFile,
  type NumstatEntry,
} from './sources'
import { loadRecords, planBase } from './touches'
import { buildTurns } from './turns'

type Engine = Pick<CoreEngineInterface, 'session' | 'process' | 'fs' | 'settings' | 'env' | 'clock'>

const UNTRACKED_LIMIT = 50
const UNTRACKED_MAX_BYTES = 200_000
const MAX_LISTED = 500
// これ未満で失敗したら Claude Code の拒否、以上なら git の時間切れ（timeoutMs 10 秒）とみなす境界
const REFUSED_WITHIN_MS = 2_000

/** git が時間内に終わらなかった、または起動できなかった。 */
export class GitUnavailable extends Error {}

const fileOf = (path: string, hunks: OverviewHunk[], note?: string): OverviewFile => ({
  path,
  display: path,
  ...countChanges(hunks),
  hunks,
  ...(note === undefined ? {} : { note }),
})

/** 差分の中身を読むときの pathspec。名前を変えたファイルは元の名前も渡す。新しい名前だけだと新規ファイルとして出るため。 */
export const hunkPathspecs = (entries: readonly NumstatEntry[]): string[] =>
  entries.flatMap(e => [e.path, ...(e.oldPath === undefined ? [] : [e.oldPath])]).map(p => `:(top,literal)${p}`)

/** 一覧の行と、読んだ差分の中身を合わせる。出力が上限で切れたときは、途中で切れた最後のファイルと、出力に無いファイルを「大きいため省略」にする。 */
export function gitFiles(
  repoRoot: string,
  entries: readonly NumstatEntry[],
  wanted: ReadonlySet<string>,
  parsed: readonly GitFile[],
  isTruncated: boolean,
  m: Messages,
): OverviewFile[] {
  const byPath = new Map(parsed.map(f => [f.path, f]))
  const cut = isTruncated ? parsed.at(-1)?.path : undefined
  return entries.map(e => {
    const path = `${repoRoot}/${e.path}`
    const head = {
      path,
      ...(e.oldPath === undefined ? {} : { oldPath: `${repoRoot}/${e.oldPath}` }),
      display: path,
      added: e.added,
      removed: e.removed,
    }
    const noBody = (note: string): OverviewFile => ({ ...head, hunks: [], note })
    if (e.isBinary) return noBody(m.note.binary)
    if (e.added + e.removed === 0) return noBody(e.oldPath === undefined ? m.note.noContentChange : m.note.renameOnly)
    if (!wanted.has(e.path)) return { ...head, hunks: null }
    const found = byPath.get(e.path)
    if (found === undefined || e.path === cut) return noBody(isTruncated ? m.note.tooLarge : m.note.unavailable)
    return { ...head, hunks: found.hunks }
  })
}

async function untrackedFile($: Engine, path: string, wantHunks: boolean, m: Messages): Promise<OverviewFile> {
  const size = await $.fs.stat(path).then(s => s.size, () => 0)
  if (size > UNTRACKED_MAX_BYTES) return fileOf(path, [], m.note.tooLarge)
  const text = await $.fs.read(path).catch(() => null)
  if (typeof text !== 'string' || text.includes('\0')) return fileOf(path, [], m.note.binary)
  if (text === '') return fileOf(path, [], m.note.emptyFile)
  const hunks = addedHunks(text)
  return { path, display: path, ...countChanges(hunks), hunks: wantHunks ? hunks : null }
}

type GitPart = { repoRoot: string | null; files: OverviewFile[]; earlier: OverviewFile[]; notes: string[]; gitMs: number }

async function baseCommit(git: (args: string[]) => ReturnType<Engine['process']['run']>, base: DiffBase) {
  if (base !== 'branch') return 'HEAD'
  const remote = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  const candidates = [...(remote.exitCode === 0 ? [remote.stdout.trim()] : []), 'origin/main', 'main', 'origin/master', 'master']
  for (const name of candidates) {
    const mergeBase = await git(['merge-base', 'HEAD', name])
    if (mergeBase.exitCode === 0) return mergeBase.stdout.trim()
  }
  return 'HEAD'
}

/**
 * 一覧は `--numstat` で取り、差分の中身は want（絶対パス）に入っているファイルの分だけ読む。
 * git diff に出ない未追跡ファイルも、新規として含める。gitMs は差分の中身を除いた読み取りにかかった時間。
 */
async function gitPart($: Engine, cwd: string, base: DiffBase, want: ReadonlySet<string>, m: Messages): Promise<GitPart> {
  const run = (args: string[]) =>
    $.process.run(['git', '--no-optional-locks', '-c', 'core.quotePath=false', '-c', 'diff.relative=false', ...args], {
      cwd,
      env: { LC_ALL: 'C' },
      timeoutMs: 10_000,
    })
  const git = (args: string[]) =>
    run(args).catch((error: unknown) => {
      throw new GitUnavailable(String(error))
    })
  const started = await $.clock.now()
  const top = await git(['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return { repoRoot: null, files: [], earlier: [], notes: [], gitMs: 0 }
  const repoRoot = top.stdout.trim()
  const commit = await baseCommit(git, base)
  const stat = await git(['diff', commit, '--numstat', '-z', '-M', '--no-ext-diff', '--no-textconv'])
  const spent = async () => (await $.clock.now()) - started
  if (stat.exitCode !== 0)
    return { repoRoot, files: [], earlier: [], notes: [m.gitFailed(stat.stderr.trim())], gitMs: await spent() }
  const entries = parseNumstat(stat.stdout)
  if (stat.isStdoutTruncated || entries.length > MAX_LISTED) {
    return { repoRoot, files: [], earlier: [], notes: [m.tooManyChanged(entries.length, stat.isStdoutTruncated)], gitMs: await spent() }
  }
  const notes: string[] = []
  // ls-files は既定で cwd の下だけを cwd 起点で返す。根起点の全体に固定する。
  const untracked = (await git(['ls-files', '--others', '--exclude-standard', '-z', '--full-name', '--', ':(top)'])).stdout
    .split('\0')
    .filter(p => p !== '')
  const untrackedFiles: OverviewFile[] = []
  for (const rel of untracked.slice(0, UNTRACKED_LIMIT)) {
    const path = `${repoRoot}/${rel}`
    untrackedFiles.push(await untrackedFile($, path, want.has(path), m))
  }
  if (untracked.length > UNTRACKED_LIMIT) notes.push(m.untrackedOmitted(untracked.length - UNTRACKED_LIMIT))
  const gitMs = await spent()

  const wanted = new Set(entries.filter(e => want.has(`${repoRoot}/${e.path}`)).map(e => e.path))
  const asked = entries.filter(e => wanted.has(e.path) && !e.isBinary && e.added + e.removed > 0)
  const readPatch = (list: readonly NumstatEntry[]) =>
    run(['diff', commit, '-p', '-M', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '--', ...hunkPathspecs(list)])
  let parsed: GitFile[] = []
  let isTruncated = false
  if (asked.length > 0) {
    const tried = await $.clock.now()
    const patch = await readPatch(asked).catch(() => null)
    if (patch !== null) {
      parsed = parseGitDiff(patch.stdout)
      isTruncated = patch.isStdoutTruncated
    } else if ((await $.clock.now()) - tried >= REFUSED_WITHIN_MS) {
      throw new GitUnavailable('git diff -p')
    } else {
      // 設定ファイルのパスを含む process.run は Claude Code が即座に断る。まとめて読むと全部失敗するので 1 ファイルずつ読み、断られた分は parsed に入らず比較不可になる。
      for (const e of asked) {
        const one = await readPatch([e]).catch(() => null)
        if (one !== null && !one.isStdoutTruncated) parsed.push(...parseGitDiff(one.stdout))
      }
    }
  }
  const files = [...gitFiles(repoRoot, entries, wanted, parsed, isTruncated, m), ...untrackedFiles]
  if (base !== 'session') return { repoRoot, files, earlier: [], notes, gitMs }

  const { startedAt } = await $.session.usage()
  const kept: OverviewFile[] = []
  const earlier: OverviewFile[] = []
  for (const file of files) {
    const mtime = await $.fs.stat(file.path).then(s => s.mtimeMs, () => Number.POSITIVE_INFINITY)
    ;(mtime >= startedAt ? kept : earlier).push(file)
  }
  return { repoRoot, files: kept, earlier, notes, gitMs }
}

/** git の対象外になる path（作業ツリーの外か、無視されているもの）だけを返す。 */
async function outsideGit($: Engine, repoRoot: string | null, paths: readonly string[]): Promise<Set<string>> {
  if (repoRoot === null) return new Set(paths)
  const inside = paths.filter(p => p.startsWith(`${repoRoot}/`))
  const outside = new Set(paths.filter(p => !p.startsWith(`${repoRoot}/`)))
  if (inside.length === 0) return outside
  // 失敗したら無視されたものは無いとみなす。一覧全体を読み込み失敗にしないため。
  const ran = await $.process
    .run(['git', '--no-optional-locks', 'check-ignore', '-z', '--stdin'], {
      cwd: repoRoot,
      stdin: inside.join('\0'),
      timeoutMs: 10_000,
    })
    .catch(() => null)
  if (ran === null) return outside
  for (const p of ran.stdout.split('\0')) if (p !== '') outside.add(p.startsWith('/') ? p : `${repoRoot}/${p}`)
  return outside
}

export function groupByPlace(
  files: readonly OverviewFile[],
  places: readonly Place[],
  m: Messages,
  earlier: { dir: string; files: readonly OverviewFile[] } | null = null,
): OverviewGroup[] {
  const unique = places.filter((p, i) => places.findIndex(q => q.dir === p.dir) === i)
  const dirs = unique.map(p => p.dir)
  const place = (file: OverviewFile, dir: string | null): OverviewFile => {
    const shown = displayPath(file.path, dir)
    const display = file.oldPath === undefined ? shown : renameDisplay(displayPath(file.oldPath, dir), shown)
    const noise = noiseKind(shown)
    return { ...file, display, ...(noise === null ? {} : { noise }) }
  }
  const byDir = new Map<string | null, OverviewFile[]>()
  for (const file of files) {
    const dir = rootOf(file.path, dirs)
    byDir.set(dir, [...(byDir.get(dir) ?? []), place(file, dir)])
  }
  return [...unique, { dir: null, title: m.otherGroup }].flatMap(({ dir, title }) => {
    const list = byDir.get(dir) ?? []
    const before = earlier !== null && dir === earlier.dir ? earlier.files.map(f => place(f, dir)) : []
    if (list.length === 0 && before.length === 0) return []
    return [{ title, files: list, ...(before.length > 0 ? { earlier: before } : {}) }]
  })
}

/** path ごとの、目印のあるいちばん近い上位フォルダ（無ければ null）。 */
async function projectRoots($: Engine, paths: readonly string[], home: string): Promise<Map<string, string | null>> {
  const marked = new Map<string, Promise<boolean>>()
  const hasMarker = (dir: string) => {
    if (!marked.has(dir))
      marked.set(
        dir,
        $.fs.list(dir).then(entries => entries.some(e => PROJECT_MARKERS.includes(e.name)), () => false),
      )
    return marked.get(dir)!
  }
  const found = new Map<string, string | null>()
  for (const path of paths) {
    let project: string | null = null
    for (const dir of ancestors(path, home))
      if (await hasMarker(dir)) {
        project = dir
        break
      }
    found.set(path, project)
  }
  return found
}

async function placesOf($: Engine, files: readonly OverviewFile[], roots: readonly string[], home: string, m: Messages): Promise<Place[]> {
  const outside = files.map(f => f.path).filter(p => rootOf(p, roots) === null)
  if (outside.length === 0) return placesFor(roots, [], new Map(), home, null, m.scratchpadGroup)
  const { scratchpadDir } = await $.session.info().catch(() => ({ scratchpadDir: undefined }))
  // macOS では /tmp が /private/tmp へのリンクなので、ファイルのパスが使っている側の綴りに scratchpadDir を揃える。
  const scratchpad =
    scratchpadDir === undefined
      ? null
      : ([scratchpadDir, scratchpadDir.replace(/^\/tmp\//, '/private/tmp/'), scratchpadDir.replace(/^\/private\/tmp\//, '/tmp/')].find(dir =>
          outside.some(p => p.startsWith(`${dir}/`)),
        ) ?? scratchpadDir)
  const projects = await projectRoots($, outside.filter(p => scratchpad === null || !p.startsWith(`${scratchpad}/`)), home)
  return placesFor(roots, outside, projects, home, scratchpad, m.scratchpadGroup)
}

/**
 * want は差分の中身を読むファイルの path（展開しているものと ask を押したもの）。
 * gitMs は作業フォルダの git の読み取りにかかった時間。
 */
export async function loadOverview(
  $: Engine,
  base: DiffBase,
  turn: string,
  want: ReadonlySet<string>,
  m: Messages,
): Promise<{ overview: Overview; gitMs: number; turnGone?: true }> {
  const [ranged, cwd, settings, homeVar] = await Promise.all([
    // uuid は last か after を付けたときだけ行に付く。ターンの id に uuid を使うので last を付ける。
    $.session.messages({ last: 4096 }),
    $.session.root(),
    $.settings.read(),
    $.env.get('HOME'),
  ])
  const messages = Array.isArray(ranged) ? ranged : await $.session.messages()
  const home = homeVar ?? ''
  const listed = (settings as { permissions?: { additionalDirectories?: unknown } }).permissions?.additionalDirectories
  const extraRoots = (Array.isArray(listed) ? listed : [])
    .filter((d): d is string => typeof d === 'string')
    .map(d => expandHome(d, home))
  const turns = buildTurns(messages)
  const turnList = turns.map(t => ({ id: t.id, preview: t.preview }))

  if (turn !== '') {
    const picked = turns.find(t => t.id === turn)
    if (picked === undefined) return { overview: { groups: [], turns: turnList }, gitMs: 0, turnGone: true }
    const files = picked.files.map(f => fileOf(f.path, f.hunks, f.hunks.length === 0 ? m.note.emptyFile : undefined))
    return { overview: { groups: groupByPlace(files, await placesOf($, files, [cwd, ...extraRoots], home, m), m), turns: turnList }, gitMs: 0 }
  }

  const git = await gitPart($, cwd, base, want, m)
  const records = await loadRecords($)
  const touches = collectFirstTouches(messages)
  const touchOf = new Map(touches.map(t => [t.path, t]))
  // paths は会話の記録と保存した記録の和集合にする。サブエージェントの編集や、messages() が返す新しい 4096 件より前の編集は、会話の記録に無いことがあるため。
  const paths = [...new Set([...touches.map(t => t.path), ...records.keys()])]
  const outside = await outsideGit($, git.repoRoot, paths)
  const sessionFiles: OverviewFile[] = []
  for (const path of paths) {
    if (!outside.has(path)) continue
    const record = records.get(path)
    const plan = planBase(record, touchOf.get(path))
    const before = plan.kind === 'base' ? plan.base : plan.kind === 'record' ? await record!.read().catch(() => null) : null
    if (before === null) {
      sessionFiles.push(fileOf(path, [], m.note[plan.kind === 'note' ? plan.note : 'unavailable']))
      continue
    }
    const exists = await $.fs.stat(path).then(() => true, () => false)
    const ran = await $.process
      .run(['diff', '-u', '--label', 'before', '--label', 'after', '-', exists ? path : '/dev/null'], { stdin: before })
      .catch(() => null)
    if (ran?.exitCode === 0) continue
    sessionFiles.push(
      ran === null || ran.exitCode > 1
        ? fileOf(path, [], m.note.unavailable)
        : fileOf(path, parseHunks(ran.stdout.split('\n')), exists ? undefined : m.note.deleted),
    )
  }
  const projectRoot = git.repoRoot ?? cwd
  const files = [...git.files, ...sessionFiles]
  const places = await placesOf($, [...files, ...git.earlier], [projectRoot, ...extraRoots], home, m)
  const groups = groupByPlace(files, places, m, { dir: projectRoot, files: git.earlier })
  return { overview: { groups, turns: turnList, ...(git.notes.length > 0 ? { note: m.joinNotes(git.notes) } : {}) }, gitMs: git.gitMs }
}
