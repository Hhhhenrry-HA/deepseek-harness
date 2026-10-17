/** Prepare the fork's public Windows build settings without local credentials. */

/**
 * Validate a version and create the public packaging environment.
 * @param environment - GitHub run identity and manual build inputs.
 * @param productVersion - Version declared by the selected checkout.
 * @param now - Time used for automatic build identifiers.
 * @returns Validated build version and public dotenv content.
 */
export function windowsCiSettings(
  environment: NodeJS.ProcessEnv, productVersion: string, now?: Date,
): { version: string, settings: string }
