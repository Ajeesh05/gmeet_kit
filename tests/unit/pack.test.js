import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectFiles } from '../helpers/pack.mjs'

/**
 * What goes into the zip that is uploaded to the Chrome Web Store.
 *
 * The packer was a deny-list, so anything a tool dropped into the tree shipped
 * unless someone had thought to name it. That is how gitleaks' own SARIF report
 * ended up inside a packaged extension: CI wrote results.sarif to the repo root
 * and the packer had no opinion about it. That report happened to be clean, but
 * the same path publishes matched secret fragments and internal file paths to
 * anyone who downloads the extension.
 */
let root

const write = (rel, body = 'x') => {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, body)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pack-'))
  write('manifest.json', '{"version":"1.0.0"}')
  write('popup.html')
  write('scripts/background.js')
  write('styles/popup.css')
  write('images/icon16.png')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('what reaches the store', () => {
  it('keeps everything an extension actually needs', () => {
    expect(collectFiles(root).sort()).toEqual([
      'images/icon16.png',
      'manifest.json',
      'popup.html',
      'scripts/background.js',
      'styles/popup.css'
    ])
  })

  it('leaves out a security scanner\'s report', () => {
    write('results.sarif', '{"runs":[{"results":[{"secret":"redacted"}]}]}')
    expect(collectFiles(root)).not.toContain('results.sarif')
  })

  it('leaves out report artifacts wherever they land, not just the root', () => {
    write('scripts/debug.log', 'internal paths')
    write('styles/.DS_Store')
    write('images/notes.sarif')

    const files = collectFiles(root)
    expect(files).not.toContain('scripts/debug.log')
    expect(files).not.toContain('images/notes.sarif')
    expect(files.some(f => f.includes('.DS_Store'))).toBe(false)
  })

  it('does not mistake a directory for an unshippable file', () => {
    // Directories have no extension; judging them by one emptied the package.
    mkdirSync(join(root, '_locales', 'en'), { recursive: true })
    write('_locales/en/messages.json', '{}')
    expect(collectFiles(root)).toContain(join('_locales', 'en', 'messages.json'))
  })

  it('keeps fonts, sounds and wasm, which extensions legitimately ship', () => {
    write('fonts/x.woff2')
    write('sounds/alert.mp3')
    write('lib/engine.wasm')

    const files = collectFiles(root)
    expect(files).toEqual(expect.arrayContaining([
      join('fonts', 'x.woff2'),
      join('sounds', 'alert.mp3'),
      join('lib', 'engine.wasm')
    ]))
  })
})
