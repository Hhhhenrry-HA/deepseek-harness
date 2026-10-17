import type { UpdateInfo } from 'electron-updater'

/** Bind generated metadata to the installer bytes verified by packaging; reject any mismatch. */
export function forkUpdateMetadata(
  metadata: unknown,
  installer: { repository: string, tag: string, filename: string, version: string, bytes: number, sha512: string },
): UpdateInfo
