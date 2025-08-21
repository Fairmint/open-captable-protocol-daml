import { LedgerJsonApiClient, EnvLoader, FileLogger, ValidatorApiClient, ClientConfig } from '@fairmint/canton-node-sdk';

/**
 * Create a LedgerJsonApiClient instance using EnvLoader for scripts
 * @param network Network type (any string)
 * @param providerType Provider type (any string)
 * @returns Configured LedgerJsonApiClient instance
 */
export function createLedgerJsonApiClient(
  network: string,
  providerType: string
): LedgerJsonApiClient {
  const envLoader = EnvLoader.getInstance();

  return new LedgerJsonApiClient({
    network: network as any,
    provider: providerType as any,
    authUrl: envLoader.getAuthUrl(network as any, providerType as any),
    apis: {
      LEDGER_JSON_API: {
        apiUrl:
          envLoader.getApiUri(
            'LEDGER_JSON_API',
            network as any,
            providerType as any
          ) || '',
        auth: {
          clientId:
            envLoader.getApiClientId(
              'LEDGER_JSON_API',
              network as any,
              providerType as any
            ) || '',
          clientSecret:
            envLoader.getApiClientSecret(
              'LEDGER_JSON_API',
              network as any,
              providerType as any
            ) || '',
          grantType: 'client_credentials',
        },
        partyId: envLoader.getPartyId(network as any, providerType as any),
      },
    },
    logger: new FileLogger(),
  });
}

/**
 * Create a ValidatorApiClient instance using EnvLoader for scripts
 * @param network Network type (any string)
 * @param providerType Provider type (any string)
 * @returns Configured ValidatorApiClient instance
 */
export function createValidatorApiClient(
  network: string,
  providerType: string
): ValidatorApiClient {
  const envLoader = EnvLoader.getInstance();
  const apiUrl = envLoader.getApiUri('VALIDATOR_API', network as any, providerType as any);
  const clientId = envLoader.getApiClientId(
    'VALIDATOR_API',
    network as any,
    providerType as any
  );
  const clientSecret = envLoader.getApiClientSecret(
    'VALIDATOR_API',
    network as any,
    providerType as any
  );
  const authUrl = envLoader.getAuthUrl(network as any, providerType as any);
  const partyId = envLoader.getPartyId(network as any, providerType as any);
  const userId = envLoader.getUserId(network as any, providerType as any);
  const username = envLoader.getApiUsername(
    'VALIDATOR_API',
    network as any,
    providerType as any
  );
  const password = envLoader.getApiPassword(
    'VALIDATOR_API',
    network as any,
    providerType as any
  );

  if (
    !apiUrl ||
    !clientId ||
    (!clientSecret && !(username && password)) ||
    !authUrl
  ) {
    throw new Error(
      'Missing required environment configuration for ValidatorApiClient'
    );
  }

  const clientConfig: ClientConfig = {
    network: network as any,
    provider: providerType as any,
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