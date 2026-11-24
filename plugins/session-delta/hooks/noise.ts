import type { NoiseKind } from '../types'

// 組み込みの /diff（cc-plugin-diff）が「tests/generated」として隠す規則をそのまま写したもの。
const GENERATED_DIRS = [
  '/dist/', '/build/', '/out/', '/output/', '/node_modules/', '/vendor/', '/vendored/', '/third_party/',
  '/third-party/', '/external/', '/.next/', '/.nuxt/', '/.svelte-kit/', '/coverage/', '/__pycache__/', '/.tox/',
  '/venv/', '/.venv/', '/target/release/', '/target/debug/', '.generated/', '/__snapshots__/',
]
const GENERATED_PATTERNS = [
  /\.min\.[a-z]+$/i, /-min\.[a-z]+$/i, /\.bundle\.[a-z]+$/i, /\.generated\.[a-z]+$/i, /\.gen\.[a-z]+$/i,
  /\.auto\.[a-z]+$/i, /_generated\.[a-z]+$/i, /_gen\.[a-z]+$/i, /\.pb\.(?:go|js|ts|py|rb)$/i, /_pb2?\.py$/i,
  /\.pb\.h$/i, /\.grpc\.[a-z]+$/i, /\.swagger\.[a-z]+$/i, /\.openapi\.[a-z]+$/i, /\.snap$/i,
]
const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'composer.lock', 'gemfile.lock',
  'cargo.lock', 'poetry.lock', 'pipfile.lock', 'shrinkwrap.json', 'npm-shrinkwrap.json',
])
const GENERATED_ENDINGS = ['.lock', '.min.js', '.min.css', '.min.html', '.bundle.js', '.bundle.css', '.generated.ts', '.generated.js', '.d.ts']
const TEST_DIRS = ['/test/', '/tests/', '/spec/', '/specs/', '/__tests__/', '/__mocks__/', '/__snapshots__/', '/__fixtures__/', '/fixtures/', '/testdata/']
const TEST_PATTERNS = [/\.test\.[a-z]+$/i, /\.spec\.[a-z]+$/i, /_test\.[a-z]+$/i, /_spec\.[a-z]+$/i, /\.snap$/i]

/** path は置き場所の根からの相対パスで渡す。根より上のフォルダ名で判定しないため。 */
export function noiseKind(path: string): NoiseKind | null {
  const name = path.split('/').at(-1) ?? path
  const lower = name.toLowerCase()
  const slashed = `/${path.replace(/^\/+/, '')}`
  const generated =
    LOCK_FILES.has(lower) ||
    GENERATED_ENDINGS.some(end => lower.endsWith(end)) ||
    GENERATED_DIRS.some(dir => slashed.includes(dir)) ||
    GENERATED_PATTERNS.some(re => re.test(lower))
  if (generated) return 'generated'
  const test = TEST_DIRS.some(dir => slashed.includes(dir)) || TEST_PATTERNS.some(re => re.test(name))
  return test ? 'test' : null
}
