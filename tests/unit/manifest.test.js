import { describe, it, expect } from 'vitest'
import { lintManifest } from '../helpers/manifest-lint.mjs'

const ROOT = process.cwd()

describe('minimum_chrome_version', () => {
  it('covers every Chrome API the extension actually calls', () => {
    const problems = lintManifest(ROOT)
    const versionErrors = problems.filter(p => p.rule === 'minimum-chrome-version')

    expect(versionErrors).toEqual([])
  })
})
