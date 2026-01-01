/**
 * Safe package manager wrapper for WebContainer runtime installs.
 */

export interface SafeInstallResult {
  success: boolean;
  output: string;
}

export async function safeInstall(
  runtime: any,
  packages: string[],
  retries = 1
): Promise<SafeInstallResult> {
  if (!runtime || typeof runtime.installPackages !== 'function') {
    throw new Error('Invalid runtime');
  }

  let attempt = 0;
  let last: SafeInstallResult = { success: false, output: '' };

  while (attempt <= retries) {
    attempt++;
    try {
      last = await runtime.installPackages(packages);
      if (last.success) return last;
    } catch (e) {
      last = { success: false, output: String(e) };
    }
  }

  return last;
}

export default { safeInstall };
