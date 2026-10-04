import {defineGame} from '@engine';
import {animation} from '@kits/animation';
import {character} from '@kits/character';
import {locomotion} from '@kits/locomotion';
export default defineGame({
  id: 'pose-to-pose',
  title: 'Pose-to-pose sample',
  version: '0.1.0',
  firstScene: 'main',
  kits: [animation(), character(), locomotion()],
});
