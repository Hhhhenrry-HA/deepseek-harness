/** Retirement of the fork's standalone Exa addon; settings and credentials belong to the built-in provider. */
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { dump, load } from 'js-yaml'
import type { ProfileManifest } from './profile.ts'

/** Standalone addon replaced by the fork's built-in Exa provider and settings page. */
export const RETIRED_EXA_ADDON = '@hhhhenrry-ha/dsh-exa-search'
const LEGACY_EXA_PROVIDER = '@deepseek-ai/dsh-web-search-exa'
const LEGACY_EXA_PROVIDER_VERSION = '0.2.0-rc.2'

function mapping(value: unknown, filename: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid package-manager mapping in ${filename}`)
  }
  return value as Record<string, unknown>
}

/** Remove only the retired addon's keys, retaining other packages and their dependency versions. */
function pruneEntries(
  value: unknown, filename: string, retired: ReadonlySet<string>, exact = false,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  const entries = mapping(value, filename)
  const kept = Object.entries(entries).filter(([key]) =>
    ![...retired].some(name => exact ? key === name : key.startsWith(`${name}@`)))
  return kept.length === Object.keys(entries).length ? undefined : Object.fromEntries(kept)
}

function prunePackageMetadata(dir: string, filename: string, retired: ReadonlySet<string>): void {
  if (!existsSync(filename) || !isProfilePath(dir, filename)) return
  const document = mapping(load(readFileSync(filename, 'utf8')), filename)
  let changed = false
  if (document.importers !== undefined) {
    const importer = mapping(document.importers, filename)['.']
    if (importer !== undefined) {
      const root = mapping(importer, filename)
      const dependencies = pruneEntries(root.dependencies, filename, retired, true)
      if (dependencies !== undefined) {
        root.dependencies = dependencies
        changed = true
      }
    }
  }
  for (const field of ['packages', 'snapshots', 'hoistedDependencies', 'hoistedLocations']) {
    const kept = pruneEntries(document[field], filename, retired)
    if (kept !== undefined) {
      document[field] = kept
      changed = true
    }
  }
  if (changed) writeFileSync(filename, dump(document, { noRefs: true, lineWidth: -1 }))
}

/** Package-manager files linked outside this profile are not owned by the migration. */
function isProfilePath(dir: string, path: string): boolean {
  if (!existsSync(path)) return false
  const candidate = relative(realpathSync(dir), realpathSync(path))
  return candidate !== '..' && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate)
}

/** Never traverse external ancestors; removing a final symlink only unlinks it. */
function removeProfilePath(dir: string, path: string): void {
  if (!isProfilePath(dir, dirname(path))) return
  rmSync(path, { recursive: true, force: true })
}

/** The old addon's provider can shadow the built-in package; remove it only when no other package requires it. */
function orphanedLegacyProvider(dir: string, manifest: ProfileManifest): boolean {
  const filename = join(dir, 'node_modules', LEGACY_EXA_PROVIDER, 'package.json')
  if (!existsSync(filename)) return false
  const provider = mapping(JSON.parse(readFileSync(filename, 'utf8')), filename)
  if (provider.name !== LEGACY_EXA_PROVIDER || provider.version !== LEGACY_EXA_PROVIDER_VERSION) return false
  const referencesProvider = (entry: Record<string, unknown>, source: string): boolean =>
    ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(field =>
      entry[field] !== undefined && mapping(entry[field], source)[LEGACY_EXA_PROVIDER] !== undefined)
  if (referencesProvider(manifest, join(dir, 'package.json'))) return false
  const lockPath = join(dir, 'pnpm-lock.yaml')
  if (!existsSync(lockPath)) return false
  const lock = mapping(load(readFileSync(lockPath, 'utf8')), lockPath)
  for (const field of ['importers', 'packages', 'snapshots']) {
    if (lock[field] === undefined) continue
    for (const [name, value] of Object.entries(mapping(lock[field], lockPath))) {
      if (name.startsWith(`${RETIRED_EXA_ADDON}@`)) continue
      if (referencesProvider(mapping(value, lockPath), lockPath)) return false
    }
  }
  return true
}

/**
 * Remove the old Exa dependency, package-manager records, installed entry and owned local source without running pnpm.
 * The addon's old provider is also removed when no other package requires it, so it cannot shadow the built-in provider.
 * External source directories, unrelated packages, user patches and credential stores are never removed.
 * Errors propagate; completed removals are idempotent and retried on the next profile load.
 * @param dir - profile package directory.
 * @param manifest - profile manifest before retirement.
 * @returns the manifest without the standalone Exa dependency; the caller persists it after bundle retirement.
 */
export function retireExaAddon(dir: string, manifest: ProfileManifest): ProfileManifest {
  const installed = join(dir, 'node_modules', RETIRED_EXA_ADDON)
  const source = join(dir, 'addons', 'exa-search')
  const registered = manifest.dependencies?.[RETIRED_EXA_ADDON] !== undefined
    || manifest.dsh?.profile?.bundles?.includes(RETIRED_EXA_ADDON) === true
  const orphanedProvider = orphanedLegacyProvider(dir, manifest)
  if (!registered && !existsSync(installed) && !existsSync(source) && !orphanedProvider) return manifest
  const retired = new Set([RETIRED_EXA_ADDON, ...orphanedProvider ? [LEGACY_EXA_PROVIDER] : []])

  for (const filename of ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml', 'node_modules/.modules.yaml']) {
    prunePackageMetadata(dir, join(dir, filename), retired)
  }
  for (const name of retired) removeProfilePath(dir, join(dir, 'node_modules', name))
  const virtualStore = join(dir, 'node_modules', '.pnpm')
  if (isProfilePath(dir, virtualStore)) {
    for (const entry of readdirSync(virtualStore)) {
      if ([...retired].some(name => entry.startsWith(`${name.replace('/', '+')}@`))) {
        removeProfilePath(dir, join(virtualStore, entry))
      }
    }
  }
  const sourceManifest = join(source, 'package.json')
  if (existsSync(sourceManifest)
    && mapping(JSON.parse(readFileSync(sourceManifest, 'utf8')), sourceManifest).name === RETIRED_EXA_ADDON) {
    removeProfilePath(dir, source)
  }
  if (manifest.dependencies?.[RETIRED_EXA_ADDON] === undefined) return manifest
  const dependencies = Object.fromEntries(Object.entries(manifest.dependencies).filter(([key]) => key !== RETIRED_EXA_ADDON))
  return { ...manifest, dependencies }
}
