export interface NetworkTrafficPricing {
  observedAt: string;
  extraTrafficPriceUsdPerMegabyte: number;
  cantonCoinPriceUsd: number;
}

export type ReplayTrafficMeasurementStatus = 'complete' | 'partial' | 'unavailable';

export interface ReplayTrafficReport {
  measurementStatus: ReplayTrafficMeasurementStatus;
  measurementScope: 'participant-extra-traffic' | 'unavailable';
  totalExtraTrafficBytes?: number;
  totalExtraTrafficMegabytes?: number;
  systemOperatorExtraTrafficBeforeBytes?: number;
  systemOperatorExtraTrafficAfterBytes?: number;
  systemOperatorExtraTrafficBytes?: number;
  issuerExtraTrafficBeforeBytes?: number;
  issuerExtraTrafficAfterBytes?: number;
  issuerExtraTrafficBytes?: number;
  pricingAtStart?: NetworkTrafficPricing;
  pricingAtEnd?: NetworkTrafficPricing;
  pricingChangedDuringReplay: boolean;
  equivalentExtraTrafficCostUsd?: number;
  equivalentExtraTrafficCostCantonCoin?: number;
}

export interface BuildReplayTrafficReportParams {
  systemOperatorExtraTrafficBeforeBytes?: number;
  systemOperatorExtraTrafficAfterBytes?: number;
  issuerExtraTrafficBeforeBytes?: number;
  issuerExtraTrafficAfterBytes?: number;
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

export function getParticipantExtraTrafficConsumedBytes(response: unknown): number | undefined {
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
  const roundsValue = root?.['open_mining_rounds'];
  const rounds = Array.isArray(roundsValue)
    ? roundsValue
    : asRecord(roundsValue)
      ? Object.values(roundsValue)
      : undefined;
  if (!rounds) return undefined;

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
  const systemOperatorExtraTrafficBytes = trafficDelta(
    params.systemOperatorExtraTrafficBeforeBytes,
    params.systemOperatorExtraTrafficAfterBytes
  );
  const issuerExtraTrafficBytes = trafficDelta(
    params.issuerExtraTrafficBeforeBytes,
    params.issuerExtraTrafficAfterBytes
  );
  const measuredParticipantCount = [systemOperatorExtraTrafficBytes, issuerExtraTrafficBytes].filter(
    (value) => value !== undefined
  ).length;
  const measurementStatus =
    measuredParticipantCount === 2 ? 'complete' : measuredParticipantCount === 1 ? 'partial' : 'unavailable';
  const measurementScope = measuredParticipantCount > 0 ? 'participant-extra-traffic' : 'unavailable';
  const totalExtraTrafficBytes =
    measurementStatus === 'complete'
      ? (systemOperatorExtraTrafficBytes ?? 0) + (issuerExtraTrafficBytes ?? 0)
      : undefined;
  const pricingChangedDuringReplay =
    params.pricingAtStart !== undefined &&
    params.pricingAtEnd !== undefined &&
    !pricingMatches(params.pricingAtStart, params.pricingAtEnd);
  const stablePricing =
    params.pricingAtStart !== undefined && params.pricingAtEnd !== undefined && !pricingChangedDuringReplay
      ? params.pricingAtEnd
      : undefined;
  const equivalentExtraTrafficCostUsd =
    totalExtraTrafficBytes !== undefined && stablePricing
      ? (totalExtraTrafficBytes / 1_000_000) * stablePricing.extraTrafficPriceUsdPerMegabyte
      : undefined;
  const equivalentExtraTrafficCostCantonCoin =
    equivalentExtraTrafficCostUsd !== undefined && stablePricing
      ? equivalentExtraTrafficCostUsd / stablePricing.cantonCoinPriceUsd
      : undefined;

  return {
    measurementStatus,
    measurementScope,
    ...(totalExtraTrafficBytes !== undefined
      ? { totalExtraTrafficBytes, totalExtraTrafficMegabytes: totalExtraTrafficBytes / 1_000_000 }
      : {}),
    ...(params.systemOperatorExtraTrafficBeforeBytes !== undefined
      ? { systemOperatorExtraTrafficBeforeBytes: params.systemOperatorExtraTrafficBeforeBytes }
      : {}),
    ...(params.systemOperatorExtraTrafficAfterBytes !== undefined
      ? { systemOperatorExtraTrafficAfterBytes: params.systemOperatorExtraTrafficAfterBytes }
      : {}),
    ...(systemOperatorExtraTrafficBytes !== undefined ? { systemOperatorExtraTrafficBytes } : {}),
    ...(params.issuerExtraTrafficBeforeBytes !== undefined
      ? { issuerExtraTrafficBeforeBytes: params.issuerExtraTrafficBeforeBytes }
      : {}),
    ...(params.issuerExtraTrafficAfterBytes !== undefined
      ? { issuerExtraTrafficAfterBytes: params.issuerExtraTrafficAfterBytes }
      : {}),
    ...(issuerExtraTrafficBytes !== undefined ? { issuerExtraTrafficBytes } : {}),
    ...(params.pricingAtStart ? { pricingAtStart: params.pricingAtStart } : {}),
    ...(params.pricingAtEnd ? { pricingAtEnd: params.pricingAtEnd } : {}),
    pricingChangedDuringReplay,
    ...(equivalentExtraTrafficCostUsd !== undefined ? { equivalentExtraTrafficCostUsd } : {}),
    ...(equivalentExtraTrafficCostCantonCoin !== undefined ? { equivalentExtraTrafficCostCantonCoin } : {}),
  };
}

function trafficDelta(before: number | undefined, after: number | undefined): number | undefined {
  return before !== undefined && after !== undefined && after >= before ? after - before : undefined;
}

function formatTraffic(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(3)} MB (${bytes.toLocaleString('en-US')} bytes)`;
}

export function renderReplayTrafficMarkdown(traffic: ReplayTrafficReport): string[] {
  const lines = ['', '## Canton traffic and cost', ''];
  if (traffic.totalExtraTrafficBytes !== undefined) {
    lines.push(`- Total extra traffic consumed during replay: **${formatTraffic(traffic.totalExtraTrafficBytes)}**`);
  } else {
    lines.push('- Total extra traffic: **unavailable because both participant counters were not captured**');
  }

  if (traffic.systemOperatorExtraTrafficBytes !== undefined)
    lines.push(`- Fairmint operator participant: **${formatTraffic(traffic.systemOperatorExtraTrafficBytes)}**`);
  if (traffic.issuerExtraTrafficBytes !== undefined)
    lines.push(`- Transfer-agent participant: **${formatTraffic(traffic.issuerExtraTrafficBytes)}**`);

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
  } else if (traffic.totalExtraTrafficBytes === undefined) {
    lines.push('- CC equivalent: unavailable because the complete extra-traffic measurement is unavailable.');
  } else if (!traffic.pricingAtStart || !traffic.pricingAtEnd) {
    lines.push('- CC equivalent: unavailable because both start and end network prices could not be captured.');
  } else {
    lines.push('- CC equivalent: unavailable because the observed network prices could not be converted.');
  }

  lines.push(
    '',
    'These counters measure purchased extra traffic consumed after each participant exhausts its free base allowance. ' +
      'The CC figure is the replacement cost at the observed on-ledger prices; traffic is pre-purchased, so it is not a direct per-transaction CC debit.',
    ''
  );
  return lines;
}
