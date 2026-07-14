export interface NetworkTrafficPricing {
  observedAt: string;
  extraTrafficPriceUsdPerMegabyte: number;
  cantonCoinPriceUsd: number;
}

export type ReplayTrafficMeasurementStatus = 'complete' | 'partial' | 'unavailable';

export interface ReplayTrafficReport {
  measurementStatus: ReplayTrafficMeasurementStatus;
  measurementScope: 'participant-replay-window' | 'confirmation-requests' | 'unavailable';
  totalTrafficBytes?: number;
  totalTrafficMegabytes?: number;
  participantTrafficBeforeBytes?: number;
  participantTrafficAfterBytes?: number;
  participantTrafficConsumedBytes?: number;
  confirmationRequestMeasurementComplete: boolean;
  confirmationRequestTrafficBytes: number;
  pricingAtStart?: NetworkTrafficPricing;
  pricingAtEnd?: NetworkTrafficPricing;
  pricingChangedDuringReplay: boolean;
  equivalentExtraTrafficCostUsd?: number;
  equivalentExtraTrafficCostCantonCoin?: number;
}

export interface BuildReplayTrafficReportParams {
  participantTrafficBeforeBytes?: number;
  participantTrafficAfterBytes?: number;
  committedTransactionCount: number;
  measuredTransactionCount: number;
  confirmationRequestTrafficBytes: number;
  pricingAtStart?: NetworkTrafficPricing;
  pricingAtEnd?: NetworkTrafficPricing;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
}

function parseNonNegativeSafeInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function parsePositiveDecimal(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getTuple(value: unknown): [unknown, unknown] | undefined {
  if (Array.isArray(value) && value.length >= 2) return [value[0], value[1]];
  const record = asRecord(value);
  return record && '_1' in record && '_2' in record ? [record['_1'], record['_2']] : undefined;
}

export function getPaidTrafficCostBytes(transaction: unknown): number | undefined {
  const record = asRecord(transaction);
  return parseNonNegativeSafeInteger(record?.['paidTrafficCost']);
}

export function getParticipantTrafficConsumedBytes(response: unknown): number | undefined {
  const root = asRecord(response);
  const trafficStatus = asRecord(root?.['traffic_status']);
  const actual = asRecord(trafficStatus?.['actual']);
  return parseNonNegativeSafeInteger(actual?.['total_consumed']);
}

export function getExtraTrafficPriceUsdPerMegabyte(amuletRulesResponse: unknown, observedAt: Date): number | undefined {
  const root = asRecord(amuletRulesResponse);
  const amuletRules = asRecord(root?.['amulet_rules']);
  const contract = asRecord(amuletRules?.['contract']);
  const payload = asRecord(contract?.['payload']);
  const schedule = asRecord(payload?.['configSchedule'] ?? payload?.['config_schedule']);
  let selectedConfig = asRecord(schedule?.['initialValue'] ?? schedule?.['initial_value']);
  if (!selectedConfig) return undefined;

  const observedAtMs = observedAt.getTime();
  const futureValues = schedule?.['futureValues'] ?? schedule?.['future_values'];
  const eligible = (Array.isArray(futureValues) ? futureValues : [])
    .flatMap((value) => {
      const tuple = getTuple(value);
      if (!tuple) return [];
      const effectiveAtMs = parseTimestamp(tuple[0]);
      const config = asRecord(tuple[1]);
      return effectiveAtMs === undefined || !config ? [] : [{ effectiveAtMs, config }];
    })
    .filter((entry) => entry.effectiveAtMs <= observedAtMs)
    .sort((left, right) => left.effectiveAtMs - right.effectiveAtMs);
  if (eligible.length > 0) selectedConfig = eligible[eligible.length - 1].config;

  const synchronizer = asRecord(
    selectedConfig['decentralizedSynchronizer'] ?? selectedConfig['decentralized_synchronizer']
  );
  const fees = asRecord(synchronizer?.['fees']);
  return parsePositiveDecimal(fees?.['extraTrafficPrice'] ?? fees?.['extra_traffic_price']);
}

export function getLatestOpenRoundCantonCoinPriceUsd(
  miningRoundsResponse: unknown,
  observedAt: Date
): number | undefined {
  const root = asRecord(miningRoundsResponse);
  const rounds = root?.['open_mining_rounds'];
  if (!Array.isArray(rounds)) return undefined;

  const observedAtMs = observedAt.getTime();
  const openedRounds = rounds.flatMap((round) => {
    const wrapper = asRecord(round);
    const contract = asRecord(wrapper?.['contract']);
    const payload = asRecord(contract?.['payload']);
    if (!payload) return [];
    const opensAtMs = parseTimestamp(payload['opensAt'] ?? payload['opens_at']);
    if (opensAtMs === undefined || opensAtMs > observedAtMs) return [];
    const roundRecord = asRecord(payload['round']);
    const roundNumber = parseNonNegativeSafeInteger(payload['round_number'] ?? roundRecord?.['number']);
    const cantonCoinPriceUsd = parsePositiveDecimal(payload['amuletPrice'] ?? payload['amulet_price']);
    return roundNumber === undefined || cantonCoinPriceUsd === undefined ? [] : [{ roundNumber, cantonCoinPriceUsd }];
  });
  if (openedRounds.length === 0) return undefined;
  return openedRounds.reduce((latest, current) => (current.roundNumber > latest.roundNumber ? current : latest))
    .cantonCoinPriceUsd;
}

export function buildNetworkTrafficPricing(
  amuletRulesResponse: unknown,
  miningRoundsResponse: unknown,
  observedAt: Date
): NetworkTrafficPricing | undefined {
  const extraTrafficPriceUsdPerMegabyte = getExtraTrafficPriceUsdPerMegabyte(amuletRulesResponse, observedAt);
  const cantonCoinPriceUsd = getLatestOpenRoundCantonCoinPriceUsd(miningRoundsResponse, observedAt);
  if (extraTrafficPriceUsdPerMegabyte === undefined || cantonCoinPriceUsd === undefined) return undefined;
  return {
    observedAt: observedAt.toISOString(),
    extraTrafficPriceUsdPerMegabyte,
    cantonCoinPriceUsd,
  };
}

function pricingMatches(left: NetworkTrafficPricing, right: NetworkTrafficPricing): boolean {
  return (
    left.extraTrafficPriceUsdPerMegabyte === right.extraTrafficPriceUsdPerMegabyte &&
    left.cantonCoinPriceUsd === right.cantonCoinPriceUsd
  );
}

export function buildReplayTrafficReport(params: BuildReplayTrafficReportParams): ReplayTrafficReport {
  const before = params.participantTrafficBeforeBytes;
  const after = params.participantTrafficAfterBytes;
  const participantTrafficConsumedBytes =
    before !== undefined && after !== undefined && after >= before ? after - before : undefined;
  const transactionMeasurementComplete =
    params.committedTransactionCount > 0 && params.measuredTransactionCount === params.committedTransactionCount;
  const totalTrafficBytes =
    participantTrafficConsumedBytes ??
    (transactionMeasurementComplete ? params.confirmationRequestTrafficBytes : undefined);
  const measurementScope =
    participantTrafficConsumedBytes !== undefined
      ? 'participant-replay-window'
      : transactionMeasurementComplete
        ? 'confirmation-requests'
        : 'unavailable';
  const measurementStatus =
    participantTrafficConsumedBytes !== undefined && transactionMeasurementComplete
      ? 'complete'
      : totalTrafficBytes !== undefined || params.measuredTransactionCount > 0
        ? 'partial'
        : 'unavailable';
  const pricingChangedDuringReplay =
    params.pricingAtStart !== undefined &&
    params.pricingAtEnd !== undefined &&
    !pricingMatches(params.pricingAtStart, params.pricingAtEnd);
  const stablePricing =
    params.pricingAtStart !== undefined && params.pricingAtEnd !== undefined && !pricingChangedDuringReplay
      ? params.pricingAtEnd
      : undefined;
  const equivalentExtraTrafficCostUsd =
    totalTrafficBytes !== undefined && stablePricing
      ? (totalTrafficBytes / 1_000_000) * stablePricing.extraTrafficPriceUsdPerMegabyte
      : undefined;
  const equivalentExtraTrafficCostCantonCoin =
    equivalentExtraTrafficCostUsd !== undefined && stablePricing
      ? equivalentExtraTrafficCostUsd / stablePricing.cantonCoinPriceUsd
      : undefined;

  return {
    measurementStatus,
    measurementScope,
    ...(totalTrafficBytes !== undefined
      ? { totalTrafficBytes, totalTrafficMegabytes: totalTrafficBytes / 1_000_000 }
      : {}),
    ...(before !== undefined ? { participantTrafficBeforeBytes: before } : {}),
    ...(after !== undefined ? { participantTrafficAfterBytes: after } : {}),
    ...(participantTrafficConsumedBytes !== undefined ? { participantTrafficConsumedBytes } : {}),
    confirmationRequestMeasurementComplete: transactionMeasurementComplete,
    confirmationRequestTrafficBytes: params.confirmationRequestTrafficBytes,
    ...(params.pricingAtStart ? { pricingAtStart: params.pricingAtStart } : {}),
    ...(params.pricingAtEnd ? { pricingAtEnd: params.pricingAtEnd } : {}),
    pricingChangedDuringReplay,
    ...(equivalentExtraTrafficCostUsd !== undefined ? { equivalentExtraTrafficCostUsd } : {}),
    ...(equivalentExtraTrafficCostCantonCoin !== undefined ? { equivalentExtraTrafficCostCantonCoin } : {}),
  };
}

function formatTraffic(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(3)} MB (${bytes.toLocaleString('en-US')} bytes)`;
}

export function renderReplayTrafficMarkdown(traffic: ReplayTrafficReport): string[] {
  const lines = ['', '## Canton traffic and cost', ''];
  if (traffic.totalTrafficBytes !== undefined) {
    const scope =
      traffic.measurementScope === 'participant-replay-window'
        ? 'Total participant traffic consumed during the replay window'
        : 'Measured OCP confirmation-request traffic';
    lines.push(`- ${scope}: **${formatTraffic(traffic.totalTrafficBytes)}**`);
  } else {
    lines.push('- Total traffic: **unavailable from this LocalNet version**');
  }

  lines.push(
    `- OCP confirmation-request traffic: **${formatTraffic(traffic.confirmationRequestTrafficBytes)}** ` +
      `(${traffic.confirmationRequestMeasurementComplete ? 'complete' : 'partial'} committed-transaction coverage)`
  );

  if (
    traffic.participantTrafficConsumedBytes !== undefined &&
    traffic.participantTrafficConsumedBytes >= traffic.confirmationRequestTrafficBytes
  ) {
    const otherTraffic = traffic.participantTrafficConsumedBytes - traffic.confirmationRequestTrafficBytes;
    lines.push(`- Other participant traffic during the replay window: **${formatTraffic(otherTraffic)}**`);
  }

  if (
    traffic.equivalentExtraTrafficCostUsd !== undefined &&
    traffic.equivalentExtraTrafficCostCantonCoin !== undefined &&
    traffic.pricingAtEnd
  ) {
    lines.push(
      `- Equivalent extra-traffic replacement cost: **${traffic.equivalentExtraTrafficCostCantonCoin.toFixed(6)} CC** ` +
        `(**$${traffic.equivalentExtraTrafficCostUsd.toFixed(6)}**)`,
      `- Network prices observed: **$${traffic.pricingAtEnd.extraTrafficPriceUsdPerMegabyte}/MB** and ` +
        `**$${traffic.pricingAtEnd.cantonCoinPriceUsd}/CC**`
    );
  } else if (traffic.pricingChangedDuringReplay) {
    lines.push('- CC equivalent: omitted because network pricing changed between the start and end snapshots.');
  } else {
    lines.push('- CC equivalent: unavailable because LocalNet did not expose both network price parameters.');
  }

  lines.push(
    '',
    'The CC figure is the replacement cost of equivalent extra traffic at the observed on-ledger prices. ' +
      'Traffic is pre-purchased and base traffic may be free, so this is not a claim that the replay directly burned that amount of CC.',
    ''
  );
  return lines;
}
