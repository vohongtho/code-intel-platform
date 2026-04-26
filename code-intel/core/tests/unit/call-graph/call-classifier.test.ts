import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCall } from '../../../src/call-graph/call-classifier.js';

describe('Call Classifier', () => {
  it('should classify constructor calls', () => {
    assert.equal(classifyCall('Foo', false, true), 'constructor');
  });

  it('should classify member calls', () => {
    assert.equal(classifyCall('doSomething', true, false), 'member');
  });

  it('should classify free function calls', () => {
    assert.equal(classifyCall('processData', false, false), 'free');
  });

  it('should classify PascalCase as constructor', () => {
    assert.equal(classifyCall('MyClass', false, false), 'constructor');
  });

  it('should classify lowercase as free', () => {
    assert.equal(classifyCall('helper', false, false), 'free');
  });
});
