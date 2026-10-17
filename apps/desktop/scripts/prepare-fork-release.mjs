/** Assemble a version-bound installer and update metadata for a GitHub Release. */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { validateDesktopBuildVersion } from './desktop-build-version.mjs'
import { resolveForkUpdate } from './fork-update.mjs'

/**
 * Bind generated update metadata to the exact installer verified by packaging.
 * @param {object} metadata Parsed electron-builder channel document.
 * @param {{ repository: string, tag: string, filename: string, version: string, bytes: number, sha512: string }} installer Actual release file identity.
 * @returns {object} Channel document whose installer URL never follows a newer release.
 */
export function forkUpdateMetadata(metadata, installer) {
  resolveForkUpdate({ DSH_DESKTOP_FORK_REPOSITORY: installer.repository }, 'win32', 'x64', true)
  if (installer.tag !== `fork-v${installer.version}` || basename(installer.filename) !== installer.filename
    || !installer.filename.endsWith('.exe')) throw new Error('fork release: invalid installer identity')
  if (metadata?.version !== installer.version || metadata.path !== installer.filename
    || metadata.sha512 !== installer.sha512 || !Array.isArray(metadata.files) || metadata.files.length !== 1) {
    throw new Error('fork release: metadata does not match the verified installer')
  }
  const [file] = metadata.files
  if (file.url !== installer.filename || file.sha512 !== installer.sha512 || file.size !== installer.bytes) {
    throw new Error('fork release: installer checksum or size differs from metadata')
  }
  const url = `https://github.com/${installer.repository}/releases/download/${installer.tag}/${encodeURIComponent(installer.filename)}`
  return { ...metadata, path: url, files: [{ ...file, url }] }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const [repository, tag, output] = process.argv.slice(2)
  const appRoot = resolve(import.meta.dirname, '..')
  const product = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  const version = validateDesktopBuildVersion(tag?.slice('fork-v'.length), product.version)
  const root = join(appRoot, '.desktop-build/targets/win-x64/unsigned-artifacts')
  const metadata = yaml.load(readFileSync(join(root, 'nightly.yml'), 'utf8'))
  const filename = metadata.path
  if (typeof filename !== 'string' || basename(filename) !== filename) throw new Error('fork release: invalid artifact filename')
  const bytes = readFileSync(join(root, filename))
  const prepared = forkUpdateMetadata(metadata, {
    repository, tag, version, filename, bytes: bytes.length,
    sha512: createHash('sha512').update(bytes).digest('base64'),
  })
  mkdirSync(output, { recursive: true })
  copyFileSync(join(root, filename), join(output, filename))
  copyFileSync(join(root, `${filename}.blockmap`), join(output, `${filename}.blockmap`))
  writeFileSync(join(output, 'nightly.yml'), yaml.dump(prepared))
  writeFileSync(join(output, 'SHA256SUMS.txt'), `${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`)
}
