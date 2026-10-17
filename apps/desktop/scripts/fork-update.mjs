/** Resolve the GitHub Releases update feed embedded in unsigned fork packages. */

/**
 * Select a fork feed without changing signed or ordinary unsigned builds.
 * @param {NodeJS.ProcessEnv} environment File-owned package settings.
 * @param {string} platform Target operating system.
 * @param {string} arch Target architecture.
 * @param {boolean} unsigned Whether this is an unsigned build.
 * @returns {{ repository: string, publicUrl: string } | undefined} Fork feed, or no override.
 */
export function resolveForkUpdate(environment, platform, arch, unsigned) {
  const repository = environment.DSH_DESKTOP_FORK_REPOSITORY
  if (repository === undefined) return undefined
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(repository)) {
    throw new Error('desktop fork update: repository must be a GitHub owner/repository')
  }
  if (platform !== 'win32' || arch !== 'x64' || !unsigned) {
    throw new Error('desktop fork update: only unsigned Windows x64 packages are supported')
  }
  return { repository, publicUrl: `https://github.com/${repository}/releases/latest/download/` }
}
