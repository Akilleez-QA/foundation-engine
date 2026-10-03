import '../../../src/platform/ui/tokens.css';
import '../../../src/platform/ui/shell.css';
import {createApp} from '../../../src/core/app.ts';
import {saveModule} from '../../../src/core/save/module.ts';
import {settingsModule} from '../../../src/core/settings/module.ts';
const app = createApp(
  [saveModule({namespace: 'comfort-diagnostic', build: 'comfort-diagnostic@1'}), settingsModule()],
  {mode: 'test', log() {}},
);
await app.boot();
window.comfortCheck = {
  set: (id, value) => app.services.settings.set(id, value),
  reset: () => app.services.settings.reset('comfort'),
  pending: () => app.services.save.pending(),
};
