import type { ProviderType } from '@fairmint/canton-node-sdk';

/** DAR upload: both participants so either path can exercise contracts vetted there. */
export const LEDGER_SCRIPT_PROVIDERS = ['intellect', '5n'] as const satisfies readonly ProviderType[];

/** OCP factory `system_operator` must be the Intellect participant (Catalyst); never 5n. */
export const OCP_FACTORY_LEDGER_PROVIDERS = ['intellect'] as const satisfies readonly ProviderType[];
