import type { ProviderType } from '@fairmint/canton-node-sdk';
import { LEDGER_SCRIPT_PROVIDERS } from './providers';
import { createLedgerJsonApiClient } from './utils';

export interface DevnetPackagePreference {
  packageId: string;
  packageName: string;
  packageVersion: string;
  provider: ProviderType;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isPackageNameNotFound(error: unknown): boolean {
  return /PACKAGE_NAMES?_NOT_FOUND|PackageNamesNotFound|package names?.*not found/i.test(errorText(error));
}

async function queryProvider(
  packageName: string,
  provider: (typeof LEDGER_SCRIPT_PROVIDERS)[number]
): Promise<DevnetPackagePreference | null> {
  const client = createLedgerJsonApiClient('devnet', provider);
  try {
    const response = await client.interactiveSubmissionGetPreferredPackageVersion({
      packageName,
      parties: [client.getPartyId()],
    });
    const reference = response.packagePreference?.packageReference;
    if (!reference) return null;
    if (reference.packageName !== packageName) {
      throw new Error(
        `${provider} DevNet returned ${reference.packageName} while querying preferred package ${packageName}.`
      );
    }
    return { ...reference, provider };
  } catch (error) {
    if (isPackageNameNotFound(error)) {
      return null;
    }
    throw new Error(`Unable to query ${provider} DevNet package preference for ${packageName}: ${errorText(error)}`);
  }
}

/** Query both configured DevNet participants. Any failed query fails closed. */
export async function queryDevnetPackagePreferences(packageName: string): Promise<DevnetPackagePreference[]> {
  const results = await Promise.all(
    LEDGER_SCRIPT_PROVIDERS.map(async (provider) => queryProvider(packageName, provider))
  );
  return results.filter((result): result is DevnetPackagePreference => result !== null);
}
