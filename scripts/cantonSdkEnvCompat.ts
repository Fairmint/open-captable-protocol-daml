/**
 * Backfill `CANTON_{NETWORK}_{PROVIDER}_*` env vars from committed public topology when unset, matching
 * `canton/src/utils/cantonSdkEnvCompat.ts`. Enables `upload-dar` and other scripts without a local `.env` for
 * non-secret settings. Client secrets and passwords must still be supplied via env or secret store.
 */
import type { CantonScriptNetwork, CantonScriptProvider } from './config/cantonPublic';
import { getConfiguredCantonProviderEntries } from './config/cantonPublic';

function setLegacyPublicEnvIfMissing(key: string, value: string): void {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

function applyLegacyPublicConfigEnv(
  network: CantonScriptNetwork,
  provider: CantonScriptProvider,
  config: {
    authUrl: string;
    partyId: string;
    managedParties: string[];
    ledgerJsonApi: { apiUrl: string; clientId: string };
    validatorApi: { apiUrl: string; clientId: string };
  }
): void {
  const prefix = `CANTON_${network.toUpperCase()}_${provider.toUpperCase()}`;
  setLegacyPublicEnvIfMissing(`${prefix}_AUTH_URL`, config.authUrl);
  setLegacyPublicEnvIfMissing(`${prefix}_PARTY_ID`, config.partyId);
  setLegacyPublicEnvIfMissing(`${prefix}_LEDGER_JSON_API_URI`, config.ledgerJsonApi.apiUrl);
  setLegacyPublicEnvIfMissing(`${prefix}_LEDGER_JSON_API_CLIENT_ID`, config.ledgerJsonApi.clientId);
  setLegacyPublicEnvIfMissing(`${prefix}_VALIDATOR_API_URI`, config.validatorApi.apiUrl);
  setLegacyPublicEnvIfMissing(`${prefix}_VALIDATOR_API_CLIENT_ID`, config.validatorApi.clientId);
  setLegacyPublicEnvIfMissing(`${prefix}_MANAGED_PARTIES`, config.managedParties.join(','));
}

export function hydrateLegacyCantonPublicEnv(): void {
  for (const { network, provider, config } of getConfiguredCantonProviderEntries()) {
    applyLegacyPublicConfigEnv(network, provider, config);
  }
}

hydrateLegacyCantonPublicEnv();
