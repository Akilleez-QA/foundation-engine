// The best score: player progress, so it never goes down (merge takes the maximum).
import {defineSaveSection} from '@engine';

export default defineSaveSection({
  id: 'run.best',
  initial: {score: 0, runs: 0},
  merge: (a, b) => ({score: Math.max(a.score, b.score), runs: Math.max(a.runs, b.runs)}),
});
