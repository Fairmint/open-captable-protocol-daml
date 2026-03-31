import type { ClientConfig, NetworkType, ProviderType } from '@fairmint/canton-node-sdk';
import { EnvLoader, FileLogger, LedgerJsonApiClient, ValidatorApiClient } from '@fairmint/canton-node-sdk';
import type { ContractNetwork } from './types';

type ScriptNetwork = ContractNetwork;

function toSdkNetwork(network: ScriptNetwork): NetworkType {
  if (network === 'staging') {
    // The installed SDK runtime supports staging config, but its published type union has not caught up yet.
    return network as NetworkType;
  }
  return network;
}

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
 * @param network Network type ('devnet' | 'mainnet' | 'staging')
 * @param providerType Provider type
 * @returns Configured LedgerJsonApiClient instance
 */
export function createLedgerJsonApiClient(network: ScriptNetwork, providerType: ProviderType): LedgerJsonApiClient {
  const envLoader = EnvLoader.getInstance();
  const sdkNetwork = toSdkNetwork(network);
  const envPrefix = `CANTON_${sdkNetwork.toUpperCase()}_${providerType.toUpperCase()}`;
  const apiUrlEnvVar = `${envPrefix}_LEDGER_JSON_API_URI`;
  const clientIdEnvVar = `${envPrefix}_LEDGER_JSON_API_CLIENT_ID`;
  const clientSecretEnvVar = `${envPrefix}_LEDGER_JSON_API_CLIENT_SECRET`;
  const apiUrl = envLoader.getApiUri('LEDGER_JSON_API', sdkNetwork, providerType) ?? '';
  const clientId = envLoader.getApiClientId('LEDGER_JSON_API', sdkNetwork, providerType) ?? '';
  const clientSecret = envLoader.getApiClientSecret('LEDGER_JSON_API', sdkNetwork, providerType) ?? '';
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
    authUrl = envLoader.getAuthUrl(sdkNetwork, providerType);
  } catch (error) {
    const missingEnvVar = getMissingEnvVarFromError(error);
    if (!missingEnvVar) {
      throw error;
    }
    missingEnvVars.push(missingEnvVar);
  }

  try {
    partyId = envLoader.getPartyId(sdkNetwork, providerType);
  } catch (error) {
    const missingEnvVar = getMissingEnvVarFromError(error);
    if (!missingEnvVar) {
      throw error;
    }
    missingEnvVars.push(missingEnvVar);
  }

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing required LedgerJsonApiClient environment variables: ${missingEnvVars.join(', ')}`,
    );
  }

  return new LedgerJsonApiClient({
    network: sdkNetwork,
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
 * @param network Network type ('devnet' | 'mainnet' | 'staging')
 * @param providerType Provider type
 * @returns Configured ValidatorApiClient instance
 */
export function createValidatorApiClient(network: ScriptNetwork, providerType: ProviderType): ValidatorApiClient {
  const envLoader = EnvLoader.getInstance();
  const sdkNetwork = toSdkNetwork(network);
  const apiUrl = envLoader.getApiUri('VALIDATOR_API', sdkNetwork, providerType);
  const clientId = envLoader.getApiClientId('VALIDATOR_API', sdkNetwork, providerType);
  const clientSecret = envLoader.getApiClientSecret('VALIDATOR_API', sdkNetwork, providerType);
  const authUrl = envLoader.getAuthUrl(sdkNetwork, providerType);
  const partyId = envLoader.getPartyId(sdkNetwork, providerType);
  const userId = envLoader.getUserId(sdkNetwork, providerType);
  const username = envLoader.getApiUsername('VALIDATOR_API', sdkNetwork, providerType);
  const password = envLoader.getApiPassword('VALIDATOR_API', sdkNetwork, providerType);

  if (!apiUrl || !clientId || (!clientSecret && !(username && password)) || !authUrl) {
    throw new Error('Missing required environment configuration for ValidatorApiClient');
  }

  const clientConfig: ClientConfig = {
    network: sdkNetwork,
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
