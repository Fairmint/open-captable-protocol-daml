/**
 * Keeps the shared v35 test vectors honest.
 *
 * `test-vectors/v35.json` is shared with the SDK and apiv2. This script recomputes every vector in it independently of
 * the Daml code (Node's sha256 and exact BigInt arithmetic) and checks that `Test/daml/OpenCapTable/TestVectors.daml`,
 * which asserts the same values on the ledger, is exactly what the JSON renders to.
 *
 * Usage: tsx scripts/test-vectors/test-vectors.ts [--write] --write regenerate TestVectors.daml from the JSON instead
 * of checking it
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface DerivedIdVector {
  cap_table_id: string;
  security_id: string;
  seq: number;
  role: string;
  index: number;
  encoding: string;
  id: string;
}

interface ClaimHashVector {
  namespace: string;
  id: string;
  encoding: string;
  hash: string;
  shard_prefix_8: string;
}

interface FloorVector {
  x: string;
  a: string;
  b: string;
  result: string;
}

interface Vectors {
  derived_ids: DerivedIdVector[];
  claim_hashes: ClaimHashVector[];
  floor_mul_div: FloorVector[];
}

const ROOT = path.resolve(__dirname, '..', '..');
const VECTORS_PATH = path.join(ROOT, 'test-vectors', 'v35.json');
const DAML_PATH = path.join(ROOT, 'Test', 'daml', 'OpenCapTable', 'TestVectors.daml');
const SCALE = 10n ** 10n;

/** Role tag → Daml constructor and namespace, as in `Fairmint.OpenCapTable.Ids`. */
const ROLES: Record<string, { constructor: string; namespace: 'object' | 'security' }> = {
  event: { constructor: 'DerivedRoleEvent', namespace: 'object' },
  hold: { constructor: 'DerivedRoleHold', namespace: 'object' },
  hold_cancellation: { constructor: 'DerivedRoleHoldCancellation', namespace: 'object' },
  resulting_issuance: { constructor: 'DerivedRoleResultingIssuance', namespace: 'object' },
  resulting_security: { constructor: 'DerivedRoleResultingSecurity', namespace: 'security' },
  balance_issuance: { constructor: 'DerivedRoleBalanceIssuance', namespace: 'object' },
  balance_security: { constructor: 'DerivedRoleBalanceSecurity', namespace: 'security' },
};

const NAMESPACES: Record<string, string> = { object: 'IdNamespaceObject', security: 'IdNamespaceSecurity' };

/** Per field: its UTF-8 byte length in decimal, ":", then the field. */
export function encodeFields(fields: string[]): string {
  return fields.map((f) => `${Buffer.byteLength(f, 'utf8')}:${f}`).join('');
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashBits(hash: string): string {
  return [...hash].map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('');
}

/** A non-negative decimal string at scale 10 → integer units of 10^-10. */
export function toUnits(decimal: string): bigint {
  const [whole, fraction = ''] = decimal.split('.');
  if (fraction.length > 10) throw new Error(`${decimal} has more than 10 decimal places`);
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(10, '0'));
}

/** Integer units → the text Daml's `show` gives a Decimal: at least one fractional digit. */
export function showDecimal(units: bigint): string {
  const whole = units / SCALE;
  const fraction = (units % SCALE).toString().padStart(10, '0').replace(/0+$/, '');
  return `${whole}.${fraction === '' ? '0' : fraction}`;
}

/** Floor(x × a / b) at scale 10, exactly. */
export function floorMulDiv(x: string, a: string, b: string): string {
  return showDecimal((toUnits(x) * toUnits(a)) / toUnits(b));
}

function check(vectors: Vectors): string[] {
  const errors: string[] = [];
  for (const v of vectors.derived_ids) {
    if (!(v.role in ROLES)) {
      errors.push(`derived ID: unknown role ${v.role}`);
      continue;
    }
    const role = ROLES[v.role];
    const encoding = encodeFields([role.namespace, v.cap_table_id, v.security_id, `${v.seq}`, v.role, `${v.index}`]);
    if (encoding !== v.encoding) errors.push(`derived ID ${v.id}: encoding ${encoding} != ${v.encoding}`);
    const id = `${v.cap_table_id}:${sha256(encoding)}`;
    if (id !== v.id) errors.push(`derived ID: ${id} != ${v.id}`);
  }
  for (const v of vectors.claim_hashes) {
    if (!NAMESPACES[v.namespace]) errors.push(`claim hash ${v.id}: unknown namespace ${v.namespace}`);
    const encoding = encodeFields([v.namespace, v.id]);
    if (encoding !== v.encoding) errors.push(`claim hash ${v.id}: encoding ${encoding} != ${v.encoding}`);
    const hash = sha256(encoding);
    if (hash !== v.hash) errors.push(`claim hash ${v.id}: ${hash} != ${v.hash}`);
    const prefix = hashBits(hash).slice(0, 8);
    if (prefix !== v.shard_prefix_8) errors.push(`claim hash ${v.id}: prefix ${prefix} != ${v.shard_prefix_8}`);
  }
  for (const v of vectors.floor_mul_div) {
    const result = floorMulDiv(v.x, v.a, v.b);
    if (result !== v.result) errors.push(`floorMulDiv(${v.x}, ${v.a}, ${v.b}): ${result} != ${v.result}`);
  }
  return errors;
}

function damlText(text: string): string {
  return JSON.stringify(text);
}

function damlDecimal(decimal: string): string {
  return showDecimal(toUnits(decimal));
}

export function renderDaml(vectors: Vectors): string {
  const derived = vectors.derived_ids.flatMap((v) => {
    const role = ROLES[v.role].constructor;
    return [
      `  encodeFields [namespaceTag (roleNamespace ${role}), ${damlText(v.cap_table_id)}, ${damlText(v.security_id)}, show (${v.seq} : Int), roleTag ${role}, show (${v.index} : Int)] === ${damlText(v.encoding)}`,
      `  deriveId (contextFor i s t ${damlText(v.cap_table_id)}) ${damlText(v.security_id)} ${v.seq} ${role} ${v.index} === ${damlText(v.id)}`,
    ];
  });
  const first = vectors.derived_ids[0];
  const claims = vectors.claim_hashes.flatMap((v) => [
    `  claimHash ${NAMESPACES[v.namespace]} ${damlText(v.id)} === ${damlText(v.hash)}`,
    `  T.take 8 (hashBits (claimHash ${NAMESPACES[v.namespace]} ${damlText(v.id)})) === ${damlText(v.shard_prefix_8)}`,
  ]);
  const floors = vectors.floor_mul_div.map(
    (v) => `  floorMulDiv ${damlDecimal(v.x)} ${damlDecimal(v.a)} ${damlDecimal(v.b)} === ${damlDecimal(v.result)}`
  );
  return [
    '-- Shared test vectors (test-vectors/v35.json): the derived-ID encoding, claim hashes and the shared floor function, as the SDK and apiv2 must reproduce them.',
    '-- Generated by scripts/test-vectors/test-vectors.ts --write; do not edit by hand.',
    'module OpenCapTable.TestVectors where',
    '',
    'import DA.Assert ((===))',
    'import qualified DA.Text as T',
    'import Daml.Script',
    '',
    'import Fairmint.OpenCapTable.Ids',
    'import Fairmint.OpenCapTable.Numeric (floorMulDiv)',
    'import Fairmint.OpenCapTable.Types.Core (Context(..))',
    '',
    'contextFor : Party -> Party -> Party -> Text -> Context',
    'contextFor i s t c = Context with cap_table_id = c; issuer = i; system_operator = s; transfer_agent = t',
    '',
    'test_vectors_derived_ids : Script ()',
    'test_vectors_derived_ids = do',
    '  i <- allocateParty "I"',
    '  s <- allocateParty "S"',
    '  t <- allocateParty "T"',
    ...derived,
    `  isDerivedForm (contextFor i s t ${damlText(first.cap_table_id)}) ${damlText(first.id)} === True`,
    `  isDerivedForm (contextFor i s t ${damlText(first.cap_table_id)}) ${damlText(`${first.cap_table_id}0:abc`)} === False`,
    '',
    'test_vectors_claim_hashes : Script ()',
    'test_vectors_claim_hashes = do',
    ...claims,
    '  T.length (hashBits (claimHash IdNamespaceObject "x")) === 256',
    '',
    'test_vectors_floor : Script ()',
    'test_vectors_floor = do',
    ...floors,
    '  pure ()',
    '',
  ].join('\n');
}

function main(): void {
  const vectors = JSON.parse(fs.readFileSync(VECTORS_PATH, 'utf8')) as Vectors;
  const errors = check(vectors);
  if (errors.length > 0) {
    for (const e of errors) console.error(`✗ ${e}`);
    throw new Error(`${errors.length} vector(s) in test-vectors/v35.json do not recompute`);
  }
  const rendered = renderDaml(vectors);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(DAML_PATH, rendered);
    console.log(`Wrote ${path.relative(ROOT, DAML_PATH)}`);
    return;
  }
  if (fs.readFileSync(DAML_PATH, 'utf8') !== rendered) {
    throw new Error(
      `${path.relative(ROOT, DAML_PATH)} is out of step with test-vectors/v35.json; run npm run generate:test-vectors`
    );
  }
  console.log(
    `✓ ${vectors.derived_ids.length} derived IDs, ${vectors.claim_hashes.length} claim hashes and ` +
      `${vectors.floor_mul_div.length} floor cases recompute, and TestVectors.daml matches the JSON`
  );
}

if (require.main === module) {
  main();
}
