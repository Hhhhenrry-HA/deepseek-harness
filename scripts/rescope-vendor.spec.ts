/** Recorded npm evidence stays intact while authored files and exact edits remain checked. */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { exactEditState, isRescopeExcluded, rescopeFiles, rescopeVendorText } from './rescope-vendor.ts'

const ANCHOR = '\n## Sync procedure'
const INSERTED = `\n15. **rescope**: one log entry.\n${ANCHOR}`

describe('rescope file selection', () => {
  it('includes new authored files and omits deleted tracked files', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rescope-files-'))
    onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
    execFileSync('git', ['init', '--quiet', root])
    writeFileSync(join(root, '.gitignore'), 'ignored.ts\n')
    writeFileSync(join(root, 'present.ts'), '')
    writeFileSync(join(root, 'deleted.ts'), '')
    execFileSync('git', ['add', '.'], { cwd: root })
    rmSync(join(root, 'deleted.ts'))
    writeFileSync(join(root, 'new.ts'), '')
    writeFileSync(join(root, 'ignored.ts'), '')
    expect(rescopeFiles(root)).toEqual(['new.ts', 'present.ts'])
  })

  it('preserves the recorded npm resolution', () => {
    expect(isRescopeExcluded('scripts/dependency-catalog/package-lock.json')).toBe(true)
  })

  it.each([
    'scripts/dependency-catalog/package.json',
    'scripts/dependency-catalog/source.ts',
    'scripts/other/package-lock.json',
    'packages/example/src/index.ts',
    'packages/example/package.json',
  ])('keeps %s subject to upstream package-name checks', (file) => {
    expect(isRescopeExcluded(file)).toBe(false)
  })
})

describe('product identifiers and module references', () => {
  const presetFiles = [
    'apps/cli/tests/optional-bundle-transitions.e2e.ts',
    'apps/web/tests/agent-preset-selection.e2e.ts',
    'apps/web/tests/developer-tools-settings.e2e.ts',
    'packages/client/ui-agent-preset/src/client/CreatePluginMenuItem.tsx',
    'packages/client/ui-agent-preset/tests/components.client.spec.tsx',
    'packages/client/ui-agent-preset/tests/create-plugin-menu-item.client.spec.tsx',
    'packages/client/ui-agent-preset/tests/section-store.client.spec.ts',
    'packages/bundle/web-app/cordis.patch.yml',
    'docs/subsystems/schedule.md', 'docs/subsystems/schedule.zh.md',
    'docs/user/guide/schedule.md', 'docs/user/guide/schedule.zh.md',
    'docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md',
    'docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.zh.md',
    'docs/upgrade-guide/v0.2.1-alpha.1/subagent-preset-composition/guide.md',
    'docs/upgrade-guide/v0.2.1-alpha.1/subagent-preset-composition/guide.zh.md',
  ]
  it.each(presetFiles)('preserves the preset id but checks package references in %s', (file) => {
    const product = file.endsWith('.md') ? 'The `cordis` preset.\n'
      : file.endsWith('.yml') ? '# The `cordis` preset.\n' : "const preset = 'cordis'\n"
    const reference = file.endsWith('.yml') ? "- name: 'cordis'\n"
      : file.endsWith('.md') ? "```ts\nimport { Context } from 'cordis'\n```\n"
        : "import { Context } from 'cordis'\n"
    expect(rescopeVendorText(product, file).text).toBe(product)
    expect(rescopeVendorText(product + reference, file).text).toBe(product + reference.replace("'cordis'", "'@deepseek-ai/cordis'"))
  })

  it.each([
    'packages/extensions/cordis-host-runner/tests/inspect-registry.spec.ts',
    'snapshots/session/cordis-inspect-liveness/client-fixture.mjs',
    'snapshots/session/cordis-inspect-timeout/client-fixture.mjs',
  ])('preserves inspection event names but checks module imports in %s', (file) => {
    const product = "ctx.on('cordis/inspect-query', handler)\n"
    const reference = "import { Context } from 'cordis'\n"
    expect(rescopeVendorText(product + reference, file).text)
      .toBe(product + reference.replace("'cordis'", "'@deepseek-ai/cordis'"))
  })

  it.each([
    "import 'cordis'", "import type { Context } from 'cordis'", "export * from 'cordis'",
    "const load = () => import(\n'cordis'\n)", "const library = require('cordis')",
    "const path = require.resolve('cordis')", "import library = require('cordis')",
    "declare module 'cordis' {}", 'const load = () => import(`cordis`)', "export * from 'cordis/subpath'",
    "type Context = import('cordis').Context", "type Library = typeof import('cordis')",
  ])('checks explicit module syntax despite a product-id exception: %s', (source) => {
    const file = presetFiles[0]!
    const next = rescopeVendorText(source, file).text
    expect(next).toBe(source.replace('cordis', '@deepseek-ai/cordis'))
    expect(rescopeVendorText(next, file).text).toBe(next)
    expect(rescopeVendorText(next, file, true).text).toBe(source)
  })

  it('preserves literal type arguments while rescoping an import type', () => {
    const source = "type Preset = import('cordis').Preset<'cordis'>"
    expect(rescopeVendorText(source, presetFiles[0]!).text)
      .toBe("type Preset = import('@deepseek-ai/cordis').Preset<'cordis'>")
  })

  it.each(['cordis', "'cordis'", '"cordis"'])('checks a Loader name with spelling %s', (name) => {
    const source = `- name: ${name}\n`
    expect(rescopeVendorText(source, 'packages/bundle/web-app/cordis.patch.yml').text)
      .toBe(source.replace('cordis', '@deepseek-ai/cordis'))
  })
})

describe('exactEditState', () => {
  it('classifies an insertion by its target form, so a duplicate is invalid', () => {
    expect(exactEditState(`log\n${ANCHOR}\n`, ANCHOR, INSERTED, 1)).toBe('pending')
    expect(exactEditState(`log${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('applied')
    // The anchor survives an insertion, so counting the source form would have
    // called this pending and inserted the entry a second time.
    expect(exactEditState(`log${INSERTED}${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('invalid')
    expect(exactEditState('log\n', ANCHOR, INSERTED, 1)).toBe('invalid')
  })

  it('classifies a deletion by its source form, and requires its remainder to survive', () => {
    const remainder = 'exclude:\n'
    const withEntries = 'exclude:\n  - cordis@4\n'
    expect(exactEditState(withEntries, withEntries, remainder, 1)).toBe('pending')
    expect(exactEditState(remainder, withEntries, remainder, 1)).toBe('applied')
    // Upstream dropped the whole field: the source form is gone, but so is the
    // remainder, so this is a moved site rather than a completed deletion.
    expect(exactEditState('unrelated:\n', withEntries, remainder, 1)).toBe('invalid')
  })

  it('requires a replacement to leave no source form and the exact target count', () => {
    expect(exactEditState('a = 1\n', 'a = 1', 'b = 2', 1)).toBe('pending')
    expect(exactEditState('b = 2\n', 'a = 1', 'b = 2', 1)).toBe('applied')
    expect(exactEditState('b = 2\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    // A moved or partially applied site: neither state is complete.
    expect(exactEditState('a = 1\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    expect(exactEditState('x\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
  })
})
