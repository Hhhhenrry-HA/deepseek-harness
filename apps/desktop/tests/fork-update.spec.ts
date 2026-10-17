import { parseEnv } from 'node:util'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { parseUpdateInfo, resolveFiles } from 'electron-updater/out/providers/Provider.js'
import { resolveForkUpdate } from '../scripts/fork-update.mjs'
import { forkUpdateMetadata } from '../scripts/prepare-fork-release.mjs'
import { windowsCiSettings } from '../scripts/prepare-fork-windows-ci.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'

const repository = 'example/harness-fork'
const version = '0.2.1-alpha.2.20261017.2'
const tag = `fork-v${version}`
const filename = `deepseek-harness-${version}-win-x64-unsigned.exe`
const installer = { repository, tag, filename, version, bytes: 123, sha512: Buffer.alloc(64, 1).toString('base64') }
const metadata = { version, path: filename, sha512: installer.sha512,
  files: [{ url: filename, sha512: installer.sha512, size: installer.bytes }] }

describe('fork Windows update distribution', () => {
  it('embeds only the fork update source, without an official mandatory policy or signing credentials', () => {
    const settings = parseEnv(windowsCiSettings({
      PACKAGE_FORK_REPOSITORY: repository, PACKAGE_BUILD_VERSION: version,
    }, '0.2.1-alpha.2').settings)
    expect(() => { validateDesktopPackageEnvironment(settings, { platform: 'win32', arch: 'x64' }, { unsigned: true }) }).not.toThrow()
    const config = createElectronBuilderConfig({ ...settings, DSH_DESKTOP_UNSIGNED: '1' }, 'win32', 'x64')
    expect(config.publish).toEqual([{ provider: 'generic', url: `https://github.com/${repository}/releases/latest/download/`, channel: 'nightly' }])
    expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
    expect(config.win.signtoolOptions.publisherName).toBeUndefined()
    expect(() => { validateDesktopPackageEnvironment(settings, { platform: 'win32', arch: 'x64' }) }).toThrow()
  })

  it('does not enable updates for an ordinary unsigned build', () => {
    expect(resolveForkUpdate({}, 'win32', 'x64', true)).toBeUndefined()
  })

  it.each(['', 'https://github.com/owner/repo', 'owner/repo/path', 'owner/repo\nOTHER=value'])('rejects an invalid repository %j', (value) => {
    expect(() => resolveForkUpdate({ DSH_DESKTOP_FORK_REPOSITORY: value }, 'win32', 'x64', true)).toThrow()
  })

  it.each([['darwin', 'arm64', true], ['win32', 'arm64', true], ['win32', 'x64', false]] as const)(
    'does not apply unsigned Windows distribution to %s/%s unsigned=%s', (platform, arch, unsigned) => {
      expect(() => resolveForkUpdate({ DSH_DESKTOP_FORK_REPOSITORY: repository }, platform, arch, unsigned)).toThrow()
    },
  )

  it('keeps the checked installer pinned when the latest release changes before download', () => {
    const prepared = forkUpdateMetadata(metadata, installer)
    const parsed = parseUpdateInfo(yaml.dump(prepared), 'nightly.yml', new URL('https://github.com/example/harness-fork/releases/latest/download/nightly.yml'))
    const files = resolveFiles(parsed, new URL('https://github.com/example/harness-fork/releases/latest/download/'))
    expect(files).toHaveLength(1)
    expect(files[0]!.url.href).toBe(`https://github.com/${repository}/releases/download/${tag}/${filename}`)
    expect(files[0]!.info.sha512).toBe(installer.sha512)
  })

  it.each([
    { ...metadata, version: '0.2.1-alpha.2' },
    { ...metadata, sha512: 'wrong' },
    { ...metadata, files: [{ ...metadata.files[0], size: 124 }] },
    { ...metadata, files: [{ ...metadata.files[0], sha512: 'wrong' }] },
    { ...metadata, files: [{ ...metadata.files[0], url: 'https://elsewhere.example/app.exe' }] },
    { ...metadata, files: [] },
  ])('rejects a channel document that differs from the built installer', (input) => {
    expect(() => forkUpdateMetadata(input, installer)).toThrow()
  })

  it('rejects an installer attached to a different version tag', () => {
    expect(() => forkUpdateMetadata(metadata, { ...installer, tag: 'fork-vother' })).toThrow()
  })
})
