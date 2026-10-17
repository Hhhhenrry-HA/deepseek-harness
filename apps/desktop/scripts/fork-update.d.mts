/** Resolve the GitHub Releases update feed embedded in unsigned fork packages. */
export function resolveForkUpdate(
  environment: NodeJS.ProcessEnv,
  platform: string,
  arch: string,
  unsigned: boolean,
): { repository: string, publicUrl: string, channel: 'nightly' } | undefined
