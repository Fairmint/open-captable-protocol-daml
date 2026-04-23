import type { ClientConfig, ProviderType } from '@fairmint/canton-node-sdk';
import { EnvLoader, FileLogger, LedgerJsonApiClient, ValidatorApiClient } from '@fairmint/canton-node-sdk';
import type { ContractNetwork } from './types';

/** Populate `CANTON_*` URL / client-id / party env from committed public config when unset (see `scripts/config/cantonPublic.ts`). */
import './cantonSdkEnvCompat';

function getMissingEnvVarFromError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const prefix = 'Missing required environment variable: ';
  if (!error.message.startsWith(prefix)) {
    return null;
  }

  return error.message.slice(prefix.length);
}

/**
 * Create a LedgerJsonApiClient instance using EnvLoader for scripts
 *
 * @param network Network type ('devnet' | 'mainnet')
 * @param providerType Provider type
 * @returns Configured LedgerJsonApiClient instance
 */
export function createLedgerJsonApiClient(network: ContractNetwork, providerType: ProviderType): LedgerJsonApiClient {
  const envLoader = EnvLoader.getInstance();
  const envPrefix = `CANTON_${network.toUpperCase()}_${providerType.toUpperCase()}`;
  const apiUrlEnvVar = `${envPrefix}_LEDGER_JSON_API_URI`;
  const clientIdEnvVar = `${envPrefix}_LEDGER_JSON_API_CLIENT_ID`;
  const clientSecretEnvVar = `${envPrefix}_LEDGER_JSON_API_CLIENT_SECRET`;
  const apiUrl = envLoader.getApiUri('LEDGER_JSON_API', network, providerType) ?? '';
  const clientId = envLoader.getApiClientId('LEDGER_JSON_API', network, providerType) ?? '';
  const clientSecret = envLoader.getApiClientSecret('LEDGER_JSON_API', network, providerType) ?? '';
  const missingEnvVars: string[] = [];
  let authUrl = '';
  let partyId = '';

  if (!apiUrl) {
    missingEnvVars.push(apiUrlEnvVar);
  }
  if (!clientId) {
    missingEnvVars.push(clientIdEnvVar);
  }
  if (!clientSecret) {
    missingEnvVars.push(clientSecretEnvVar);
  }

  try {
    authUrl = envLoader.getAuthUrl(network, providerType);
  } catch (error) {
    const missingEnvVar = getMissingEnvVarFromError(error);
    if (!missingEnvVar) {
      throw error;
    }
    missingEnvVars.push(missingEnvVar);
  }

  try {
    partyId = envLoader.getPartyId(network, providerType);
  } catch (error) {
    const missingEnvVar = getMissingEnvVarFromError(error);
    if (!missingEnvVar) {
      throw error;
    }
    missingEnvVars.push(missingEnvVar);
  }

  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required LedgerJsonApiClient environment variables: ${missingEnvVars.join(', ')}`);
  }

  return new LedgerJsonApiClient({
    network,
    provider: providerType,
    authUrl,
    apis: {
      LEDGER_JSON_API: {
        apiUrl,
        auth: {
          clientId,
          clientSecret,
          grantType: 'client_credentials',
        },
        partyId,
      },
    },
    logger: new FileLogger(),
  });
}

/**
 * Create a ValidatorApiClient instance using EnvLoader for scripts
 *
 * @param network Network type ('devnet' | 'mainnet')
 * @param providerType Provider type
 * @returns Configured ValidatorApiClient instance
 */
export function createValidatorApiClient(network: ContractNetwork, providerType: ProviderType): ValidatorApiClient {
  const envLoader = EnvLoader.getInstance();
  const apiUrl = envLoader.getApiUri('VALIDATOR_API', network, providerType);
  const clientId = envLoader.getApiClientId('VALIDATOR_API', network, providerType);
  const clientSecret = envLoader.getApiClientSecret('VALIDATOR_API', network, providerType);
  const authUrl = envLoader.getAuthUrl(network, providerType);
  const partyId = envLoader.getPartyId(network, providerType);
  const userId = envLoader.getUserId(network, providerType);
  const username = envLoader.getApiUsername('VALIDATOR_API', network, providerType);
  const password = envLoader.getApiPassword('VALIDATOR_API', network, providerType);

  if (!apiUrl || !clientId || (!clientSecret && !(username && password)) || !authUrl) {
    throw new Error('Missing required environment configuration for ValidatorApiClient');
  }

  const clientConfig: ClientConfig = {
    network,
    provider: providerType,
    authUrl,
    apis: {
      VALIDATOR_API: {
        apiUrl,
        auth: {
          grantType: clientSecret ? 'client_credentials' : 'password',
          clientId,
          clientSecret,
          username,
          password,
        },
        partyId,
        userId,
      },
    },
    logger: new FileLogger(),
  };

  return new ValidatorApiClient(clientConfig);
}
