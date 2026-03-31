import type { ClientConfig, NetworkType, ProviderType } from '@fairmint/canton-node-sdk';
import { EnvLoader, FileLogger, LedgerJsonApiClient, ValidatorApiClient } from '@fairmint/canton-node-sdk';
import type { ContractNetwork } from './types';

type ScriptNetwork = ContractNetwork;

function toSdkNetwork(network: ScriptNetwork): NetworkType {
  if (network === 'staging') {
    // The installed SDK runtime supports staging config, but its published type union has not caught up yet.
    // TODO: Remove the cast below once the published SDK `NetworkType` includes 'staging'.
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
    throw new Error(`Missing required LedgerJsonApiClient environment variables: ${missingEnvVars.join(', ')}`);
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
  const envPrefix = `CANTON_${sdkNetwork.toUpperCase()}_${providerType.toUpperCase()}`;
  const apiUrlEnvVar = `${envPrefix}_VALIDATOR_API_URI`;
  const clientIdEnvVar = `${envPrefix}_VALIDATOR_API_CLIENT_ID`;
  const clientSecretEnvVar = `${envPrefix}_VALIDATOR_API_CLIENT_SECRET`;
  const usernameEnvVar = `${envPrefix}_VALIDATOR_API_USERNAME`;
  const passwordEnvVar = `${envPrefix}_VALIDATOR_API_PASSWORD`;
  const userIdEnvVar = `${envPrefix}_USER_ID`;

  const apiUrl = envLoader.getApiUri('VALIDATOR_API', sdkNetwork, providerType) ?? '';
  const clientId = envLoader.getApiClientId('VALIDATOR_API', sdkNetwork, providerType) ?? '';
  const clientSecret = envLoader.getApiClientSecret('VALIDATOR_API', sdkNetwork, providerType) ?? '';
  const username = envLoader.getApiUsername('VALIDATOR_API', sdkNetwork, providerType) ?? '';
  const password = envLoader.getApiPassword('VALIDATOR_API', sdkNetwork, providerType) ?? '';
  const missingEnvVars: string[] = [];
  let authUrl = '';
  let partyId = '';
  let userId = '';

  if (!apiUrl) {
    missingEnvVars.push(apiUrlEnvVar);
  }
  if (!clientId) {
    missingEnvVars.push(clientIdEnvVar);
  }

  const hasClientCredentials = Boolean(clientSecret);
  const hasPasswordGrant = Boolean(username && password);
  if (!(hasClientCredentials || hasPasswordGrant)) {
    if (!username) {
      missingEnvVars.push(usernameEnvVar);
    }
    if (!password) {
      missingEnvVars.push(passwordEnvVar);
    }
    if (!username && !password && !clientSecret) {
      missingEnvVars.push(clientSecretEnvVar);
    }
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

  userId = envLoader.getUserId(sdkNetwork, providerType) ?? '';
  if (!userId) {
    missingEnvVars.push(userIdEnvVar);
  }

  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required ValidatorApiClient environment variables: ${missingEnvVars.join(', ')}`);
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
