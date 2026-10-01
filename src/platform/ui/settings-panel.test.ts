import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../testing/fake-dom';
import { coreSettings, createSettings, type SettingDef, type StoredSettings } from '../../core/settings/settings';
import { addSettingsBlock, renderSettingsPanel } from './settings-panel';

function memorySettings(defs: readonly SettingDef[] = coreSettings, data: StoredSettings = {}) {
  const subs = new Set<(v: StoredSettings) => void>();
  let writes = 0;
  const store = { get: () => data, update(fn: (d: StoredSettings) => StoredSettings | void) { const d = { ...data }; data = fn(d) ?? d; writes++; subs.forEach(f => f(data)); return 'saved' as const; }, subscribe(fn: (v: StoredSettings) => void) { subs.add(fn); return () => { subs.delete(fn); }; } };
  return { settings: createSettings(defs, store, { prefersReducedMotion: false, coarsePointer: false }), writes: () => writes, external(next: StoredSettings) { data = next; subs.forEach(f => f(data)); } };
}
const strings = {
  'settings.comfort.large-type': 'Bigger words', 'settings.comfort.calm': 'Calm scenes · stop decorative spinning', 'settings.comfort.calm.help': 'Calm help.',
  'settings.sound.muted': 'Mute', 'settings.sound.music': 'Music volume', 'settings.sound.effects': 'Effects volume', 'settings.sound.voice': 'Voice volume',
  'settings.sound.gentle': 'Gentle mix', 'settings.sound.captions': 'Captions',
};

test('the Comfort panel is generated from the comfort definitions, in order, with the ids the page always had', () => {
  const fake = installFakeDom(), doc = fake.document as unknown as Document;
  try {
    const { settings } = memorySettings();
    const host = doc.createElement('dialog'); doc.body.append(host);
    const off = addSettingsBlock('comfort', d => { const h = d.createElement('h3'); h.textContent = 'Keyboard co-player'; return [h]; });
    const controls = renderSettingsPanel(host, { settings, section: 'comfort', strings, ids: { 'comfort.large-type': 'large-type', 'comfort.calm': 'still-scenes' } }) as HTMLInputElement[];
    off();
    assert.deepEqual(controls.map(c => c.id), ['large-type', 'still-scenes'], 'order 1 then 2');
    assert.deepEqual(controls.map(c => c.type), ['checkbox', 'checkbox']);
    const children = Array.from(host.children);
    assert.deepEqual(children.map(k => k.tagName.toLowerCase()), ['label', 'label', 'p', 'h3'], 'controls, the help under Calm, then the block');
    assert.equal(children[0].textContent, ' Bigger words');
    assert.equal(children[1].textContent, ' Calm scenes · stop decorative spinning');
    assert.equal(children[2].textContent, 'Calm help.');
  } finally { fake.restore(); }
});

test('a toggle writes on change and follows other writers (another tab, an import, a reset)', () => {
  const fake = installFakeDom(), doc = fake.document as unknown as Document;
  try {
    const m = memorySettings();
    const host = doc.createElement('div'); doc.body.append(host);
    const [large, calm] = renderSettingsPanel(host, { settings: m.settings, section: 'comfort', strings }) as HTMLInputElement[];
    assert.equal(calm.id, 'comfort-calm', 'default id: the setting id with dashes');
    calm.checked = true; calm.dispatchEvent(new Event('change'));
    assert.equal(m.settings.get('comfort.calm'), true);
    m.external({ 'comfort.large-type': true });
    assert.equal(large.checked, true, 'another writer shows at once'); assert.equal(calm.checked, false);
  } finally { fake.restore(); }
});

test('a generated slider saves once, on release, never on input; hidden settings get no control', () => {
  const fake = installFakeDom(), doc = fake.document as unknown as Document;
  try {
    const m = memorySettings();
    const host = doc.createElement('div'); doc.body.append(host);
    const controls = renderSettingsPanel(host, { settings: m.settings, section: 'sound', strings }) as HTMLInputElement[];
    const music = controls.find(c => c.id === 'sound-music')!;
    assert.equal(music.type, 'range'); assert.equal(music.value, '0.24');
    for (const v of ['0.3', '0.4', '0.5']) { music.value = v; music.dispatchEvent(new Event('input')); }
    assert.equal(m.writes(), 0, 'dragging writes nothing');
    music.dispatchEvent(new Event('change'));
    assert.equal(m.writes(), 1, 'the release writes once'); assert.equal(m.settings.get('sound.music'), 0.5);
    assert.equal(renderSettingsPanel(doc.createElement('div'), { settings: m.settings, section: 'gallery', strings }).length, 0, 'gallery.style is hidden');
  } finally { fake.restore(); }
});
