import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertValidFactoryId,
  defaultFactoryId,
  factoryCreateArguments,
  findActiveFactory,
  isFactoryIdentity,
  withFactoryIdentity,
  type FactoryIdentity,
} from './create-ocp-factory';

const templateId = 'package-id:Fairmint.OpenCapTable.OcpFactory:OcpFactory';
const operator = 'operator::party';
const factoryId = 'OpenCapTable-v35-devnet';

function activeFactory(
  contractId: string,
  template = templateId,
  systemOperator = operator,
  id: string = factoryId
): unknown {
  return {
    contractEntry: {
      JsActiveContract: {
        createdEvent: {
          contractId,
          templateId: template,
          createArgument: { system_operator: systemOperator, factory_id: id, next_cap_table_number: '3' },
        },
      },
    },
  };
}

function identity(network: string, id = `OpenCapTable-v35-${network}`): FactoryIdentity {
  return { templateId, system_operator: operator, factory_id: id, packageName: 'OpenCapTable-v35' };
}

void test('recovers the active factory for the exact template, operator and factory ID', () => {
  const recovered = findActiveFactory(
    [
      activeFactory('wrong-package', 'other-package:Fairmint.OpenCapTable.OcpFactory:OcpFactory'),
      activeFactory('wrong-operator', templateId, 'other::party'),
      activeFactory('wrong-factory-id', templateId, operator, 'another-factory'),
      activeFactory('expected-contract'),
    ],
    templateId,
    operator,
    factoryId
  );

  assert.deepEqual(recovered, { contractId: 'expected-contract', templateId });
});

void test('returns null when no matching active factory exists', () => {
  assert.equal(findActiveFactory([{ contractEntry: { JsEmpty: {} } }], templateId, operator, factoryId), null);
  assert.equal(
    findActiveFactory([activeFactory('other', templateId, operator, 'x')], templateId, operator, factoryId),
    null
  );
  assert.equal(findActiveFactory({ not: 'an array' }, templateId, operator, factoryId), null);
});

void test('fails closed when multiple matching active factories exist', () => {
  assert.throws(
    () => findActiveFactory([activeFactory('one'), activeFactory('two')], templateId, operator, factoryId),
    /Found 2 active OcpFactory contracts/
  );
});

void test('another factory ID of the same operator does not block recovery', () => {
  const recovered = findActiveFactory(
    [activeFactory('one'), activeFactory('two', templateId, operator, 'OpenCapTable-v35-devnet-b')],
    templateId,
    operator,
    factoryId
  );
  assert.deepEqual(recovered, { contractId: 'one', templateId });
});

void test('create arguments start the counter at 1 and follow the factory_id rules', () => {
  assert.deepEqual(factoryCreateArguments(operator, factoryId), {
    system_operator: operator,
    factory_id: factoryId,
    next_cap_table_number: '1',
  });
  assert.equal(defaultFactoryId('OpenCapTable-v35', 'devnet'), 'OpenCapTable-v35-devnet');
  assert.throws(() => assertValidFactoryId(''), /Invalid factory_id/);
  assert.throws(() => factoryCreateArguments(operator, 'a:b'), /Invalid factory_id/);
});

void test('records an identity without a contract ID and drops entries in the old v34 shape', () => {
  const v34Mainnet = { ocpFactoryContractId: '00ab', templateId: 'v34:Fairmint.OpenCapTable.OcpFactory:OcpFactory' };
  assert.equal(isFactoryIdentity(v34Mainnet), false);

  const data = withFactoryIdentity({ mainnet: v34Mainnet }, 'devnet', identity('devnet'));
  assert.deepEqual(data, { devnet: identity('devnet') });
  assert.equal(Object.keys(data.devnet).includes('ocpFactoryContractId'), false);

  const both = withFactoryIdentity(
    { mainnet: identity('mainnet'), devnet: identity('devnet', 'old') },
    'devnet',
    identity('devnet')
  );
  assert.deepEqual(both, { devnet: identity('devnet'), mainnet: identity('mainnet') });
});
