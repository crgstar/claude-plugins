import { shortRoot } from './sources'

export type Place = { dir: string; title: string }

export const PROJECT_MARKERS = ['.git', 'package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', '.claude-plugin']

/** path を含むフォルダを深いほうから返す。home と / には上がらない。 */
export function ancestors(path: string, home: string): string[] {
  const dirs: string[] = []
  for (let dir = path.slice(0, path.lastIndexOf('/')); dir !== '' && dir !== home; dir = dir.slice(0, dir.lastIndexOf('/')))
    dirs.push(dir)
  return dirs
}

// ホーム直下のフォルダを鍵にする。ホーム自体を鍵にすると、ホームの下の全ファイルが 1 つの見出しに入る。
function clusterKey(path: string, home: string): string {
  const base = home !== '' && path.startsWith(`${home}/`) ? home : ''
  const parts = path.slice(base.length + 1).split('/')
  return parts.length > 1 ? `${base}/${parts[0]}` : base === '' ? '/' : base
}

function commonDir(paths: readonly string[]): string {
  const split = paths.map(p => p.split('/').slice(0, -1))
  const first = split[0] ?? []
  let n = 0
  while (n < first.length && split.every(s => s[n] === first[n])) n++
  return first.slice(0, n).join('/') || '/'
}

/**
 * roots は作業フォルダで、先頭がセッションのプロジェクト。paths は作業フォルダの外のファイル。
 * projectOf は path ごとの目印のあるフォルダ（無ければ null）。
 * 目印の無い path は、ホーム直下（ホームの外は / 直下）のフォルダごとに、共通するいちばん深いフォルダを見出しにする。
 */
export function placesFor(
  roots: readonly string[],
  paths: readonly string[],
  projectOf: ReadonlyMap<string, string | null>,
  home: string,
  scratchpad: string | null,
  scratchpadTitle: string,
): Place[] {
  const inScratchpad = (p: string) => scratchpad !== null && p.startsWith(`${scratchpad}/`)
  const projects = new Set<string>()
  const clusters = new Map<string, string[]>()
  for (const path of paths) {
    if (inScratchpad(path)) continue
    const project = projectOf.get(path) ?? null
    const key = clusterKey(path, home)
    if (project !== null) projects.add(project)
    else clusters.set(key, [...(clusters.get(key) ?? []), path])
  }
  const titled = (dirs: Iterable<string>) =>
    [...dirs].map(dir => ({ dir, title: shortRoot(dir, home) })).sort((a, b) => a.title.localeCompare(b.title))
  const [main, ...extra] = roots.map(dir => ({ dir, title: shortRoot(dir, home) }))
  // 目印で見つけたプロジェクトは、追加の作業フォルダ（~/.claude など）より上に置く。
  return [
    ...(main === undefined ? [] : [main]),
    ...titled(projects),
    ...extra,
    ...titled([...clusters.values()].map(commonDir)),
    ...(paths.some(inScratchpad) ? [{ dir: scratchpad!, title: scratchpadTitle }] : []),
  ]
}
