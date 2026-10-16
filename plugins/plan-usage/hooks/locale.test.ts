import { expect, test } from 'claude-code/testing'
import { pickLocale, posixLocaleOf } from './locale.ts'

test('pickLocale は language 設定が日本語なら ja', () => {
  expect(pickLocale('Japanese', undefined)).toBe('ja')
  expect(pickLocale('japanese', 'en_US.UTF-8')).toBe('ja')
  expect(pickLocale('日本語', undefined)).toBe('ja')
  expect(pickLocale('ja', undefined)).toBe('ja')
})

test('pickLocale は language 設定が日本語以外ならロケールが日本語でも en', () => {
  expect(pickLocale('English', 'ja_JP.UTF-8')).toBe('en')
  expect(pickLocale('French', 'ja_JP.UTF-8')).toBe('en')
  expect(pickLocale('Javanese', 'ja_JP.UTF-8')).toBe('en')
})

test('pickLocale は ja の言語コードを地域付きでも拾い、ja で始まる別の言語コードは拾わない', () => {
  expect(pickLocale('ja-JP', undefined)).toBe('ja')
  expect(pickLocale(undefined, 'ja')).toBe('ja')
  expect(pickLocale(undefined, 'jam_JM.UTF-8')).toBe('en')
})

test('pickLocale は language 設定が無い・空ならロケールで決める', () => {
  expect(pickLocale(undefined, 'ja_JP.UTF-8')).toBe('ja')
  expect(pickLocale('  ', 'ja_JP.UTF-8')).toBe('ja')
  expect(pickLocale(42, 'ja_JP.UTF-8')).toBe('ja')
  expect(pickLocale(undefined, 'en_US.UTF-8')).toBe('en')
  expect(pickLocale(undefined, 'C')).toBe('en')
  expect(pickLocale(undefined, undefined)).toBe('en')
})

test('posixLocaleOf は LC_ALL > LC_MESSAGES > LANG の順で、空文字は飛ばす', () => {
  expect(posixLocaleOf('ja_JP.UTF-8', 'en_US.UTF-8', 'en_US.UTF-8')).toBe('ja_JP.UTF-8')
  expect(posixLocaleOf(undefined, 'ja_JP.UTF-8', 'en_US.UTF-8')).toBe('ja_JP.UTF-8')
  expect(posixLocaleOf('', '', 'ja_JP.UTF-8')).toBe('ja_JP.UTF-8')
  expect(posixLocaleOf(undefined, undefined, undefined)).toBeUndefined()
})
