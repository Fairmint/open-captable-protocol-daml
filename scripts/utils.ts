import { LedgerJsonApiClient, EnvLoader, FileLogger } from '@fairmint/canton-node-sdk';

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