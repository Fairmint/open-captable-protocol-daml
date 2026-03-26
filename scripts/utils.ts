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

  return new LedgerJsonApiClient({
    network: sdkNetwork,
    provider: providerType,
    authUrl: envLoader.getAuthUrl(sdkNetwork, providerType),
    apis: {
      LEDGER_JSON_API: {
        apiUrl: envLoader.getApiUri('LEDGER_JSON_API', sdkNetwork, providerType) ?? '',
        auth: {
          clientId: envLoader.getApiClientId('LEDGER_JSON_API', sdkNetwork, providerType) ?? '',
          clientSecret: envLoader.getApiClientSecret('LEDGER_JSON_API', sdkNetwork, providerType) ?? '',
          grantType: 'client_credentials',
        },
        partyId: envLoader.getPartyId(sdkNetwork, providerType),
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
