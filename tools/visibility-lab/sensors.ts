import {createVisibility} from '../../src/kits/visibility';

/** Geometry and team selection are creator inputs. No disclosure or rendering is performed. */
export function sensors() {
  const visibility = createVisibility({cellCount: 16, maxSources: 4, maxCellsPerSource: 8, maxDrain: 4});
  return {
    visibility,
    mapState: (cell: number) => {
      const state = visibility.cell(cell);
      return state?.visible ? 'current' : state?.explored ? 'remembered' : 'unknown';
    },
  };
}
