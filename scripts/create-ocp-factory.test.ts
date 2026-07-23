import assert from 'node:assert/strict';
import test from 'node:test';
import { findActiveFactory } from './create-ocp-factory';

const templateId = 'package-id:Fairmint.OpenCapTable.OcpFactory:OcpFactory';
const operator = 'operator::party';

function activeFactory(contractId: string, template = templateId, systemOperator = operator): unknown {
  return {
    contractEntry: {
      JsActiveContract: {
        createdEvent: {
          contractId,
          templateId: template,
          createArgument: { system_operator: systemOperator },
        },
      },
    },
  };
}

void test('recovers the active factory for the exact template and operator', () => {
  const recovered = findActiveFactory(
    [
      activeFactory('wrong-package', 'other-package:Fairmint.OpenCapTable.OcpFactory:OcpFactory'),
      activeFactory('wrong-operator', templateId, 'other::party'),
      activeFactory('expected-contract'),
    ],
    templateId,
    operator
  );

  assert.deepEqual(recovered, { contractId: 'expected-contract', templateId });
});

void test('returns null when no matching active factory exists', () => {
  assert.equal(findActiveFactory([{ contractEntry: { JsEmpty: {} } }], templateId, operator), null);
});

void test('fails closed when multiple matching active factories exist', () => {
  assert.throws(
    () => findActiveFactory([activeFactory('one'), activeFactory('two')], templateId, operator),
    /Found 2 active OcpFactory contracts/
  );
});
