// Actual app bus and public dev API; no authored gameplay, scheduler or renderer required.
import {createApp} from '../../../src/core/app.ts';
import {createTestApi} from '../../../src/dev/test-api.ts';
const app = createApp([], {mode: 'test', log() {}});
const booted = app.boot();
window.engine = createTestApi(app, booted);
window.traceCheck = async () => {
  await window.engine.ready();
  const capture = window.engine.eventTrace({capacity: 16});
  const off = app.events.on('app.started', () =>
    app.events.emit('app.module-failed', {
      id: 'diagnostic-child',
      phase: 'start',
      error: 'scalar capture excludes this payload',
    }),
  );
  try {
    app.events.emit('app.started', {ms: 0});
    capture.dispose();
    return {snapshot: capture.snapshot(), exported: capture.exportTrace()};
  } finally {
    capture.dispose();
    off();
    app.dispose();
  }
};
