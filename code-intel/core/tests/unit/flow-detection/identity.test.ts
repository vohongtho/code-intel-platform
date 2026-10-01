import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOW_IDENTITY_VERSION,
  buildFlowIdentity,
} from '../../../src/flow-detection/identity.js';

describe('buildFlowIdentity', () => {
  it('returns byte-identical identity for identical canonical flow input', () => {
    const input = {
      entryPointCanonicalId: 'symbol:v2:src/app.ts:main',
      stepCanonicalIds: [
        'symbol:v2:src/app.ts:main',
        'symbol:v2:src/service.ts:load',
        'symbol:v2:src/store.ts:read',
      ],
      callSiteIds: ['callsite:v1:main-load', 'callsite:v1:load-read'],
    };

    assert.deepEqual(buildFlowIdentity(input), buildFlowIdentity(input));
  });

  it('changes the fingerprint when parallel call sites distinguish the same step path', () => {
    const common = {
      entryPointCanonicalId: 'symbol:v2:src/app.ts:main',
      stepCanonicalIds: ['symbol:v2:src/app.ts:main', 'symbol:v2:src/service.ts:load'],
    };

    const first = buildFlowIdentity({ ...common, callSiteIds: ['callsite:v1:first'] });
    const second = buildFlowIdentity({ ...common, callSiteIds: ['callsite:v1:second'] });

    assert.notEqual(first.flowFingerprint, second.flowFingerprint);
    assert.notEqual(first.flowId, second.flowId);
    assert.equal(first.algorithmVersion, FLOW_IDENTITY_VERSION);
  });
});
