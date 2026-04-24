/**
 * Public Catalyst / Transfer Agent topology for scripts (URLs, OAuth client ids, party ids). Keep aligned with
 * `canton/src/config/cantonPublic.ts`. Secrets stay in env only.
 */
import type { ContractNetwork } from '../types';

export const CANTON_SCRIPT_NETWORKS = ['mainnet', 'devnet'] as const satisfies readonly ContractNetwork[];
export const CANTON_SCRIPT_PROVIDERS = ['intellect', '5n'] as const;

export type CantonScriptNetwork = (typeof CANTON_SCRIPT_NETWORKS)[number];
export type CantonScriptProvider = (typeof CANTON_SCRIPT_PROVIDERS)[number];

interface CantonPublicApiConfig {
  apiUrl: string;
  clientId: string;
}

interface CantonProviderPublicConfig {
  authUrl: string;
  partyId: string;
  managedParties: string[];
  ledgerJsonApi: CantonPublicApiConfig;
  validatorApi: CantonPublicApiConfig;
}

type CantonPublicConfig = Record<
  CantonScriptNetwork,
  Partial<Record<CantonScriptProvider, CantonProviderPublicConfig>>
>;

const CANTON_PUBLIC_CONFIG: CantonPublicConfig = {
  mainnet: {
    '5n': {
      authUrl: 'https://auth.transfer-agent.xyz/application/o/token',
      partyId: 'TransferAgent-mainnet-1::12204a039322c01e9f714b56259c3e68b69058bf5dfe1debbe956c698f905ceba9d7',
      managedParties: [
        'SubscriptionProcessor::12204a039322c01e9f714b56259c3e68b69058bf5dfe1debbe956c698f905ceba9d7',
        'ShareholdersAirdropVault::12204a039322c01e9f714b56259c3e68b69058bf5dfe1debbe956c698f905ceba9d7',
      ],
      ledgerJsonApi: {
        apiUrl: 'https://ledger-api.validator.transfer-agent.xyz',
        clientId: 'validator-mainnet-m2m',
      },
      validatorApi: {
        apiUrl: 'https://wallet.validator.transfer-agent.xyz',
        clientId: 'validator-mainnet-m2m',
      },
    },
    intellect: {
      authUrl:
        'https://keycloak.catalyst.fairmint.com/auth/realms/fairmint-catalyst-mainnet/protocol/openid-connect/token',
      partyId: 'Fairmint-validator-1::122047f456985651be8ea317881a9af4f04521417ce1a449b75543541acf33aac4d2',
      managedParties: [],
      ledgerJsonApi: {
        apiUrl: 'https://participant-fairmint-mainnet.canton.catalyst.fairmint.com',
        clientId: 'fairmint-mainnet',
      },
      validatorApi: {
        apiUrl: 'https://wallet-fairmint-mainnet.canton.catalyst.fairmint.com',
        clientId: 'fairmint-mainnet-wallet-ui',
      },
    },
  },
  devnet: {
    '5n': {
      authUrl: 'https://auth.transfer-agent.xyz/application/o/token',
      partyId: 'TransferAgent-devnet-1::1220ea70ea2cbfe6be431f34c7323e249c624a02fb2209d2b73fabd7eea1fe84df34',
      managedParties: [
        'test-subscription-processor::1220ea70ea2cbfe6be431f34c7323e249c624a02fb2209d2b73fabd7eea1fe84df34',
        'test-vault::1220cddaf354fb12d4cbdee3d314430aa6fd26d6060b9f35c34a022885e3c681ec63',
      ],
      ledgerJsonApi: {
        apiUrl: 'https://ledger-api.validator.devnet.transfer-agent.xyz',
        clientId: 'validator-devnet-m2m',
      },
      validatorApi: {
        apiUrl: 'https://wallet.validator.devnet.transfer-agent.xyz',
        clientId: 'validator-devnet-m2m',
      },
    },
    intellect: {
      authUrl:
        'https://keycloak.catalyst.fairmint.com/auth/realms/fairmint-catalyst-mainnet/protocol/openid-connect/token',
      partyId: 'fairmint-validator-1::122057e7e79847b89123b4f156b9da123b1633487dd008b04f29078b6cd539a42249',
      managedParties: [],
      ledgerJsonApi: {
        apiUrl: 'https://participant-fairmint-devnet.canton.catalyst.fairmint.com',
        clientId: 'fairmint-devnet',
      },
      validatorApi: {
        apiUrl: 'https://wallet-validator-fairmint-dev.canton.dev.catalyst.fairmint.com',
        clientId: 'validator-fairmint-dev-wallet-ui',
      },
    },
  },
};

export function getConfiguredCantonProviderEntries(): Array<{
  network: CantonScriptNetwork;
  provider: CantonScriptProvider;
  config: CantonProviderPublicConfig;
}> {
  return CANTON_SCRIPT_NETWORKS.flatMap((network) =>
    CANTON_SCRIPT_PROVIDERS.flatMap((provider) => {
      const config = CANTON_PUBLIC_CONFIG[network][provider];
      return config ? [{ network, provider, config }] : [];
    })
  );
}
