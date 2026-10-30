// Which embers are taken: player progress, kept across scene changes and reloads (a taken ember stays taken).
import {defineSaveSection} from '@engine';

export default defineSaveSection({
  id: 'showcase.embers',
  initial: {taken: [] as string[]},
  merge: (a, b) => ({taken: [...new Set([...a.taken, ...b.taken])].sort()}),
});
