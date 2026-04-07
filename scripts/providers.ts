import type { ProviderType } from '@fairmint/canton-node-sdk';

/** Ledger DAR upload and factory scripts: try in order (Intellect first, then 5n). */
export const LEDGER_SCRIPT_PROVIDERS = ['intellect', '5n'] as const satisfies readonly ProviderType[];
