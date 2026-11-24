import { expect, test } from 'claude-code/testing'

import { blend, cellWidth, expandTabs, isStyle, numberWidth, openContext, styleSpec, TERMINAL_BG, wordSpans } from './look'

const texts = (spans: { text: string; changed: boolean }[]) => spans.map(s => (s.changed ? `[${s.text}]` : s.text)).join('')

test('変わった部分は、文字列の途中で切らず文字列ごとにする', () => {
  const { before, after } = wordSpans("  const mark = '?'", "  const mark = '!'")
  expect(texts(before)).toBe("  const mark = ['?']")
  expect(texts(after)).toBe("  const mark = ['!']")
  expect(texts(wordSpans("  greet('Good morning')", "  greet('Good evening')").after)).toBe("  greet(['Good evening'])")
})

test('変わった部分は、語の途中で切らない', () => {
  expect(texts(wordSpans('count = total + 1', 'count = total + 10').after)).toBe('count = total + [10]')
  expect(texts(wordSpans('const userName = a', 'const userId = a').after)).toBe('const [userId] = a')
})

test('変わった部分は、書記素の途中で切らない', () => {
  expect(texts(wordSpans('éx', 'èx').after)).toBe('[è]x')
  expect(texts(wordSpans('👨‍👩‍👧 a', '👨‍👩‍👦 a').after)).toBe('[👨‍👩‍👦] a')
  expect(texts(wordSpans('a 🍎', 'a 🍏').after)).toBe('a [🍏]')
  expect(texts(wordSpans('café', 'cofé').after)).toBe('[cofé]')
  expect(texts(wordSpans('xé y', 'xè y').after)).toBe('[xè] y')
})

test('// のコメントの中が変わったときは、コメントの終わりまでを変わった部分にする', () => {
  expect(texts(wordSpans('x = 1 // old note', 'x = 1 // new note').after)).toBe('x = 1 [// new note]')
})

test('文字列の中の // はコメントとみなさない', () => {
  expect(openContext("u = 'http://a")).toEqual({ at: 4, quote: "'" })
  expect(openContext('u = 1 // c')).toEqual({ at: 6, quote: null })
  expect(openContext("u = 'a\\'b' + c")).toBe(null)
})

test('片方にしかない部分は、もう片方では変わった部分が空になる', () => {
  expect(wordSpans('foo()', 'foo(bar)')).toEqual({
    before: [
      { text: 'foo(', changed: false },
      { text: ')', changed: false },
    ],
    after: [
      { text: 'foo(', changed: false },
      { text: 'bar', changed: true },
      { text: ')', changed: false },
    ],
  })
})

test('先頭と末尾が重なる繰り返しでも、文字を二重に数えない', () => {
  const { before, after } = wordSpans('aa', 'aaa')
  expect(before.map(s => s.text).join('')).toBe('aa')
  expect(after.map(s => s.text).join('')).toBe('aaa')
})

test('行番号の欄は最大の桁数にそろえる', () => {
  expect(numberWidth([9, 10, 100])).toBe(3)
  expect(numberWidth([])).toBe(1)
})

test('知らない色の名前は受け付けず、既定の案に落とす', () => {
  expect(isStyle('word')).toBe(true)
  expect(isStyle('original')).toBe(false)
  expect(styleSpec('word').word).toBeDefined()
})

test('淡い色は端末の背景に緑と赤を重ねた色で、背景より明るい', () => {
  expect(blend('#282828', '#2ea043', 0.15)).toBe('#293a2c')
  expect(blend('#282828', '#f85149', 0.15)).toBe('#472e2d')
  const lightness = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0)
  for (const id of ['soft', 'faint', 'word'] as const) {
    const { line } = styleSpec(id)
    expect(lightness(line.add!)).toBeGreaterThan(lightness(TERMINAL_BG))
    expect(lightness(line.del!)).toBeGreaterThan(lightness(TERMINAL_BG))
  }
})

test('全角の文字は 2 列、半角は 1 列で数え、タブは 4 つの空白に開く', () => {
  expect(cellWidth("const a = 'あ'")).toBe(14)
  expect(cellWidth('ｱa')).toBe(2)
  expect(expandTabs('\tx')).toBe('    x')
})

test('絵文字は 2 列、結合文字とゼロ幅の文字は 0 列で、見た目の 1 文字ごとに数える', () => {
  expect(cellWidth('✅⭐❌')).toBe(6)
  expect(cellWidth('✔')).toBe(1)
  expect(cellWidth('❤️')).toBe(2)
  expect(cellWidth('👨‍👩‍👧')).toBe(2)
  expect(cellWidth('🇯🇵')).toBe(2)
  expect(cellWidth('e\u0301')).toBe(1)
  expect(cellWidth('a\u200bb')).toBe(2)
  expect(cellWidth('𠮷')).toBe(2)
  expect(cellWidth('\u06001')).toBe(1)
})


test('絵文字のサロゲートペアの途中で変わった部分を切らない', () => {
  const { before, after } = wordSpans('x 😀', 'x 😃')
  expect(texts(before)).toBe('x [😀]')
  expect(texts(after)).toBe('x [😃]')
})
