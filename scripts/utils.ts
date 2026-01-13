import type { ClientConfig, NetworkType, ProviderType } from '@fairmint/canton-node-sdk';
import { EnvLoader, FileLogger, LedgerJsonApiClient, ValidatorApiClient } from '@fairmint/canton-node-sdk';

/**
 * Create a LedgerJsonApiClient instance using EnvLoader for scripts
 *
 * @param network Network type ('devnet' | 'testnet' | 'mainnet' | 'localnet')
 * @param providerType Provider type
 * @returns Configured LedgerJsonApiClient instance
 */
export function createLedgerJsonApiClient(network: NetworkType, providerType: ProviderType): LedgerJsonApiClient {
  const envLoader = EnvLoader.getInstance();

  return new LedgerJsonApiClient({
    network,
    provider: providerType,
    authUrl: envLoader.getAuthUrl(network, providerType),
    apis: {
      LEDGER_JSON_API: {
        apiUrl: envLoader.getApiUri('LEDGER_JSON_API', network, providerType) ?? '',
        auth: {
          clientId: envLoader.getApiClientId('LEDGER_JSON_API', network, providerType) ?? '',
          clientSecret: envLoader.getApiClientSecret('LEDGER_JSON_API', network, providerType) ?? '',
          grantType: 'client_credentials',
        },
        partyId: envLoader.getPartyId(network, providerType),
      },
    },
    logger: new FileLogger(),
  });
}

/**
 * Create a ValidatorApiClient instance using EnvLoader for scripts
 *
 * @param network Network type ('devnet' | 'testnet' | 'mainnet' | 'localnet')
 * @param providerType Provider type
 * @returns Configured ValidatorApiClient instance
 */
export function createValidatorApiClient(network: NetworkType, providerType: ProviderType): ValidatorApiClient {
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
