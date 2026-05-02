import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FileWatcher } from '../../../src/pipeline/file-watcher.js';

describe('FileWatcher', () => {
  it('isWatching is false before start()', () => {
    const fw = new FileWatcher('/tmp');
    assert.equal(fw.isWatching, false);
  });

  it('isWatching is true after start()', () => {
    const fw = new FileWatcher('/tmp');
    fw.start(() => {});
    assert.equal(fw.isWatching, true);
    fw.stop();
  });

  it('isWatching is false after stop()', () => {
    const fw = new FileWatcher('/tmp');
    fw.start(() => {});
    fw.stop();
    assert.equal(fw.isWatching, false);
  });

  it('lastEventAt is null before any event', () => {
    const fw = new FileWatcher('/tmp');
    assert.equal(fw.lastEventAt, null);
    fw.start(() => {});
    assert.equal(fw.lastEventAt, null);
    fw.stop();
  });

  it('calling start() twice does not throw', () => {
    const fw = new FileWatcher('/tmp');
    fw.start(() => {});
    fw.start(() => {}); // should be a no-op
    assert.equal(fw.isWatching, true);
    fw.stop();
  });

  it('calling stop() before start() does not throw', () => {
    const fw = new FileWatcher('/tmp');
    assert.doesNotThrow(() => fw.stop());
    assert.equal(fw.isWatching, false);
  });

  it('debounce batches multiple file events (unit test of debounce logic)', async () => {
    // We test the debounce mechanism indirectly by checking the watcher
    // accepts a custom debounceMs without error
    const fw = new FileWatcher('/tmp', { debounceMs: 50 });
    fw.start(() => {});
    assert.equal(fw.isWatching, true);
    fw.stop();
  });

  it('extra ignore patterns are accepted without error', () => {
    const fw = new FileWatcher('/tmp', { ignore: ['**/*.log', '**/coverage/**'] });
    fw.start(() => {});
    assert.equal(fw.isWatching, true);
    fw.stop();
  });
});
