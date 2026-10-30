import {defineModule} from '../module';
import type {Registry} from '../registry';
import {appFeatures, bindAppFeatures, coreFeatures} from './app-features';
import {featureOverridesSection, featureProblems, type FeatureDef, type Features} from './features';
import type {} from '../save/module';

declare module '../registry' {
  interface Registries {
    features: Registry<FeatureDef>;
  }
}
declare module '../services' {
  interface Services {
    readonly features: Features;
  }
}
declare module '../probe' {
  interface EngineProbes {
    features: ReturnType<Features['explain']>;
  }
}

export default defineModule({
  id: 'core.features',
  version: '1.0.0',
  requires: ['core.save'],
  serviceKeys: ['features'],
  defines: {
    features: {
      validate: d => [
        ...(!['dev', 'beta', 'stable'].includes(d.stage) ? ['invalid stage'] : []),
        ...(typeof d.default !== 'boolean' ? ['default must be boolean'] : []),
        ...(typeof d.description !== 'string' || !d.description ? ['description required'] : []),
      ],
      problems: featureProblems,
    },
  },
  register(r) {
    for (const d of coreFeatures) r.features.add(d, 'core.features');
    r.saveSections.add(featureOverridesSection, 'core.features');
  },
  install(s) {
    bindAppFeatures(() => s.registries.features.all());
    s.provide('features', appFeatures());
    s.probes.register('features', () => s.features.explain(), s.signal);
    return {dispose: () => bindAppFeatures(null)};
  },
});
