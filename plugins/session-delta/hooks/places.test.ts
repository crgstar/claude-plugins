import { expect, test } from 'claude-code/testing'

import { MESSAGES } from './locale'
import { ancestors, placesFor } from './places'

const HOME = '/home/u'
const PAD_TITLE = MESSAGES.ja.scratchpadGroup

test('上にたどるフォルダは、ホームと / の手前で止まる', () => {
  expect(ancestors('/home/u/bb/plug/lib/a.ts', HOME)).toEqual(['/home/u/bb/plug/lib', '/home/u/bb/plug', '/home/u/bb'])
  expect(ancestors('/home/u/.zshrc', HOME)).toEqual([])
  expect(ancestors('/etc/x/y.conf', HOME)).toEqual(['/etc/x', '/etc'])
})

test('目印のあるフォルダを見出しにし、無いものはホーム直下のフォルダごとに共通のフォルダを見出しにする', () => {
  const paths = [
    '/home/u/projects/b/y.ts',
    '/home/u/projects/a/src/x.ts',
    '/home/u/.config/ghostty/config',
    '/home/u/.config/git/config',
    '/home/u/.zshrc',
    '/etc/hosts.d/a',
  ]
  const projectOf = new Map([
    ['/home/u/projects/a/src/x.ts', '/home/u/projects/a'],
    ['/home/u/projects/b/y.ts', '/home/u/projects/b'],
  ])
  expect(placesFor(['/home/u/dotfiles', '/home/u/.claude'], paths, projectOf, HOME, null, PAD_TITLE).map(p => p.title)).toEqual([
    '~/dotfiles',
    '~/projects/a',
    '~/projects/b',
    '~/.claude',
    '/etc/hosts.d',
    '~',
    '~/.config',
  ])
})

test('このセッションの一時フォルダは名前で出し、最後に置く', () => {
  const pad = '/tmp/claude-1/p/s/scratchpad'
  const paths = [`${pad}/tools/a.swift`, `${pad}/b.ts`, '/home/u/bb/plug/lib/c.ts']
  expect(placesFor(['/repo'], paths, new Map(), HOME, pad, PAD_TITLE)).toEqual([
    { dir: '/repo', title: '/repo' },
    { dir: '/home/u/bb/plug/lib', title: '~/bb/plug/lib' },
    { dir: pad, title: PAD_TITLE },
  ])
  expect(placesFor(['/repo'], ['/home/u/bb/c.ts'], new Map(), HOME, pad, PAD_TITLE).map(p => p.title)).toEqual(['/repo', '~/bb'])
})
