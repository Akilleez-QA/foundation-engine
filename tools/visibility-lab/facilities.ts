import {createVisibility} from '../../src/kits/visibility';

/** The creator supplies provider footprints; historical coverage never admits current service. */
export function facilities() {
  const coverage = createVisibility({cellCount: 16, maxSources: 4, maxCellsPerSource: 8, maxDrain: 4});
  return {coverage, canServe: (cell: number) => coverage.cell(cell)?.visible === true};
}
