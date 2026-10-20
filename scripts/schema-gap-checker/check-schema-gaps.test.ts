import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkDateTypes,
  checkExtensionSamples,
  localizeSchemaUrls,
  parseDataBody,
  pascalCase,
  resolveSchemaUrl,
  scanDamlSource,
} from './check-schema-gaps';

const OCF = 'https://raw.githubusercontent.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/6d8c932/schema';

void test('resolves OCF and extension schema URLs to their roots', () => {
  assert.deepEqual(resolveSchemaUrl(`${OCF}/types/Date.schema.json`), {
    root: 'ocf',
    relativePath: 'types/Date.schema.json',
  });
  assert.deepEqual(
    resolveSchemaUrl(
      'https://raw.githubusercontent.com/Fairmint/open-captable-protocol-daml/main/ocf-extension/schema/enums/HoldType.schema.json'
    ),
    { root: 'extension', relativePath: 'enums/HoldType.schema.json' }
  );
  assert.equal(resolveSchemaUrl('https://example.com/x.json'), null);
});

void test('names enum constructors by the OCF value in PascalCase', () => {
  assert.equal(pascalCase('REGISTER_SETTLEMENT'), 'RegisterSettlement');
  assert.equal(pascalCase('NOT APPLICABLE'), 'NotApplicable');
  assert.equal(pascalCase('TX_STOCK_HOLD'), 'TxStockHold');
});

void test('parses records, enums and positional variants', () => {
  const record = parseDataBody('data X = X\n  with\n    id : Text\n    date : Optional Date\n');
  assert.deepEqual(
    [...record.fields.entries()],
    [
      ['id', 'Text'],
      ['date', 'Optional Date'],
    ]
  );
  assert.deepEqual(record.constructors, [{ name: 'X', kind: 'record' }]);

  const enumType = parseDataBody('data OcfHoldType\n  = OcfHoldTypeRegisterSettlement\n  | OcfHoldTypeStopTransfer\n');
  assert.deepEqual(
    enumType.constructors.map((c) => c.kind),
    ['nullary', 'nullary']
  );

  const variant = parseDataBody('data M\n  = MA A\n  | MB B\n');
  assert.deepEqual(
    variant.constructors.map((c) => c.kind),
    ['positional', 'positional']
  );
});

void test('attaches only the annotations directly above a data declaration', () => {
  const source = [
    `-- OCF TX_STOCK_HOLD record: a header, not an annotation`,
    'module M where',
    '',
    `-- OCF: ${OCF}/types/Ratio.schema.json`,
    '',
    'data Lost = Lost with x : Int',
    '',
    '-- Fairmint OCF extension: enums/HoldType.schema.json',
    'data OcfHoldType = OcfHoldTypeRegisterSettlement | OcfHoldTypeStopTransfer',
    '  deriving (Eq, Show)',
  ].join('\n');
  const { types } = scanDamlSource(source, 'M.daml');
  assert.deepEqual(
    types.map((t) => [t.typeName, t.annotations.map((a) => a.kind)]),
    [
      ['Lost', []],
      ['OcfHoldType', ['extension']],
    ]
  );
  assert.deepEqual(
    types[1].constructors.map((c) => c.name),
    ['OcfHoldTypeRegisterSettlement', 'OcfHoldTypeStopTransfer']
  );
});

void test('forbids Time and nested optional dates outside comments and module names', () => {
  assert.deepEqual(checkDateTypes('import DA.Time (time)\n-- a Time in a comment\nx = "Time"\n'), []);
  assert.equal(checkDateTypes('    date : Time\n').length, 1);
  assert.equal(checkDateTypes('    vested : Optional Time -- no\n').length, 1);
  assert.equal(checkDateTypes('    expiry : Optional (Optional Date)\n').length, 1);
});

void test('a hold record validates only once its Object primitive takes the amended ObjectType enum', () => {
  const ext = 'https://raw.githubusercontent.com/Fairmint/open-captable-protocol-daml/main/ocf-extension/schema';
  const enumSchema = (id: string, values: string[]) => ({ $id: id, type: 'string', enum: values });
  const objectSchema = (id: string, enumUrl: string) => ({
    $id: id,
    type: 'object',
    properties: { object_type: { $ref: enumUrl } },
    required: ['object_type'],
  });
  const holdSchema = (objectUrl: string) => ({
    $id: `${ext}/objects/Hold.schema.json`,
    allOf: [{ $ref: objectUrl }],
    properties: { object_type: { const: 'TX_STOCK_HOLD' } },
  });
  const shared = [
    enumSchema(`${OCF}/enums/ObjectType.schema.json`, ['ISSUER']),
    enumSchema(`${ext}/enums/ObjectType.schema.json`, ['ISSUER', 'TX_STOCK_HOLD']),
    objectSchema(`${OCF}/primitives/objects/Object.schema.json`, `${OCF}/enums/ObjectType.schema.json`),
    objectSchema(`${ext}/primitives/objects/Object.schema.json`, `${ext}/enums/ObjectType.schema.json`),
  ];
  const samples = [
    { schema: 'objects/Hold.schema.json', label: 'a hold', valid: true, record: { object_type: 'TX_STOCK_HOLD' } },
  ];
  const withObject = (objectUrl: string) => [...shared, holdSchema(objectUrl)].map(localizeSchemaUrls);

  assert.match(
    checkExtensionSamples(withObject(`${OCF}/primitives/objects/Object.schema.json`), samples).join('\n'),
    /a hold is rejected/
  );
  assert.deepEqual(checkExtensionSamples(withObject(`${ext}/primitives/objects/Object.schema.json`), samples), []);
});
