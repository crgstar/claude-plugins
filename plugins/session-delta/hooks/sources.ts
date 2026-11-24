import type { OverviewHunk } from '../types'

type ToolUseLike = { tool_use_id?: string; tool: string; result?: unknown; isError?: true }
type MessageLike = { toolUses?: readonly ToolUseLike[] }

/**
 * 最初に触る前の内容。null は結果から取り出せなかった場合（空のファイルを Edit した場合も含む）。
 * later は同じファイルを 2 回目以降に書き換えた呼び出しの tool_use_id。
 */
export type FirstTouch = { path: string; base: string | null; later: string[] }

/** 最初に触った順。新規作成の base は空文字。 */
export function collectFirstTouches(messages: readonly MessageLike[]): FirstTouch[] {
  const seen = new Map<string, FirstTouch>()
  for (const message of messages)
    for (const use of message.toolUses ?? []) {
      if ((use.tool !== 'Edit' && use.tool !== 'Write') || use.isError === true) continue
      const result = use.result
      if (typeof result !== 'object' || result === null) continue
      const r = result as { filePath?: unknown; originalFile?: unknown; type?: unknown; staged?: unknown }
      if (typeof r.filePath !== 'string' || r.staged === true) continue
      const first = seen.get(r.filePath)
      if (first !== undefined) {
        if (use.tool_use_id !== undefined) first.later.push(use.tool_use_id)
        continue
      }
      // originalFile が空文字なら null にする。Claude Code は古い結果の originalFile を空にするので、空は中身と区別できない。
      const base =
        use.tool === 'Write' && r.type === 'create'
          ? ''
          : typeof r.originalFile === 'string' && r.originalFile !== ''
            ? r.originalFile
            : null
      seen.set(r.filePath, { path: r.filePath, base, later: [] })
    }
  return [...seen.values()]
}

/**
 * unified diff の本文をハンクに分ける。ハンクの終わりは見出しの行数で決める。
 * 中身が `--` で始まる削除行は `---` になり、ファイルの見出しと見分けられないため。
 */
export function parseHunks(lines: readonly string[]): OverviewHunk[] {
  const hunks: OverviewHunk[] = []
  let oldLeft = 0
  let newLeft = 0
  for (const line of lines) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('\\')) continue
      hunks[hunks.length - 1]!.lines.push(line === '' ? ' ' : line)
      if (!line.startsWith('+')) oldLeft--
      if (!line.startsWith('-')) newLeft--
      continue
    }
    const head = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (head === null) continue
    hunks.push({ oldStart: Number(head[1]), newStart: Number(head[3]), lines: [] })
    oldLeft = head[2] === undefined ? 1 : Number(head[2])
    newLeft = head[4] === undefined ? 1 : Number(head[4])
  }
  return hunks
}

export type GitFile = { path: string; hunks: OverviewHunk[]; isBinary: boolean }

// 名前に空白を含むと `a/x b/y` の切れ目が見出しの行だけでは決まらないので、新旧が同じ名前のときだけ見出しから取る。
function samePathOfHeader(line: string): string | null {
  if (!line.startsWith('diff --git a/')) return null
  const rest = line.slice('diff --git a/'.length)
  const half = (rest.length - ' b/'.length) / 2
  if (!Number.isInteger(half) || half <= 0) return null
  const path = rest.slice(0, half)
  return rest.slice(half) === ` b/${path}` ? path : null
}

// git は空白を含む名前の `---` / `+++` の行の末尾にタブを足す。タブを含む名前は引用符で囲まれるので、末尾のタブは名前の一部ではない。
const withoutTab = (name: string) => (name.endsWith('\t') ? name.slice(0, -1) : name)

/**
 * `git diff --src-prefix=a/ --dst-prefix=b/ -p` の出力を、ファイルごとに分ける。path は作業ツリーの根からの相対パスで、
 * 名前を変えたファイルは新しい名前。中身の行が「+++ b/」で始まっても見出しと取り違えないよう、見出しは最初の @@ より前の行だけから読む。
 */
export function parseGitDiff(text: string): GitFile[] {
  type Block = { path: string | null; header: string; body: string[]; isBinary: boolean; inHeader: boolean }
  const blocks: Block[] = []
  for (const line of text.split('\n')) {
    // 引用符で囲まれた名前も区切る。区切らないと本文が前のファイルのハンクになる。
    // 名前は解かないので path が決まらず、結果に出ない。
    if (line.startsWith('diff --git ')) {
      blocks.push({ path: null, header: line, body: [], isBinary: false, inHeader: true })
      continue
    }
    const current = blocks[blocks.length - 1]
    if (current === undefined) continue
    if (current.inHeader) {
      if (line.startsWith('@@')) current.inHeader = false
      else if (line.startsWith('rename to ')) current.path = line.slice('rename to '.length)
      else if (line.startsWith('+++ b/')) current.path = withoutTab(line.slice('+++ b/'.length))
      else if (line.startsWith('--- a/') && current.path === null) current.path = withoutTab(line.slice('--- a/'.length))
      else if (line.startsWith('Binary files ')) current.isBinary = true
    }
    current.body.push(line)
  }
  return blocks.flatMap(b => {
    const path = b.path ?? samePathOfHeader(b.header)
    return path === null ? [] : [{ path, hunks: parseHunks(b.body), isBinary: b.isBinary }]
  })
}

/** path は作業ツリーの根からの相対パス。 */
export type NumstatEntry = { path: string; oldPath?: string; added: number; removed: number; isBinary: boolean }

/** `git diff --numstat -z` の出力を読む。 */
export function parseNumstat(text: string): NumstatEntry[] {
  const tokens = text.split('\0')
  const entries: NumstatEntry[] = []
  for (let i = 0; i < tokens.length; i++) {
    const head = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(tokens[i]!)
    if (head === null) continue
    const counts = { added: Number(head[1]) || 0, removed: Number(head[2]) || 0, isBinary: head[1] === '-' }
    if (head[3] !== '') {
      entries.push({ path: head[3]!, ...counts })
      continue
    }
    const [oldPath, path] = [tokens[i + 1], tokens[i + 2]]
    if (oldPath === undefined || path === undefined) break
    entries.push({ path, oldPath, ...counts })
    i += 2
  }
  return entries
}

/** git が名前の変更を書く形（`src/{a.ts => b.ts}`）。git の diff.c の pprint_rename に合わせる。 */
export function renameDisplay(a: string, b: string): string {
  let pfx = 0
  for (let i = 0; i < a.length && i < b.length && a[i] === b[i]; i++) if (a[i] === '/') pfx = i + 1
  // 前の共通部分の末尾の / は、後ろからの比較でも使えるようにする。
  const floor = pfx > 0 ? pfx - 1 : 0
  let sfx = 0
  for (let i = a.length, j = b.length; i >= floor && j >= floor && (a[i] ?? '') === (b[j] ?? ''); i--, j--)
    if (a[i] === '/') sfx = a.length - i
  const aMid = a.slice(pfx, Math.max(pfx, a.length - sfx))
  const bMid = b.slice(pfx, Math.max(pfx, b.length - sfx))
  return pfx + sfx > 0 ? `${a.slice(0, pfx)}{${aMid} => ${bMid}}${a.slice(a.length - sfx)}` : `${a} => ${b}`
}

/** 末尾の / を落とし、~ 始まりはホームに展開する。 */
export function expandHome(path: string, home: string): string {
  const full = path === '~' ? home : path.startsWith('~/') ? `${home}${path.slice(1)}` : path
  return full.length > 1 && full.endsWith('/') ? full.slice(0, -1) : full
}

/** path を含む根のうち、いちばん深いもの。どれにも入らなければ null。 */
export function rootOf(path: string, roots: readonly string[]): string | null {
  let best: string | null = null
  for (const root of roots)
    if ((path === root || path.startsWith(`${root}/`)) && (best === null || root.length > best.length)) best = root
  return best
}

export function displayPath(path: string, root: string | null): string {
  return root !== null && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

export function shortRoot(root: string, home: string): string {
  return root === home ? '~' : root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root
}
