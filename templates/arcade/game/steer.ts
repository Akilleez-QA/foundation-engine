// Steering: an axis every player can reach (keys, stick); touch and mouse steer by dragging (see play.ts).
import {defineInput} from '@engine';

export default defineInput({
  id: 'steer',
  label: 'Steer',
  axis: {
    negative: {keys: ['code:ArrowLeft', 'code:KeyA'], pad: ['ls-left', 'dpad-left']},
    positive: {keys: ['code:ArrowRight', 'code:KeyD'], pad: ['ls-right', 'dpad-right']},
  },
});
