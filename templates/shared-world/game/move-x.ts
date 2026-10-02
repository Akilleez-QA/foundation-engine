// Left and right: keys and the stick or d-pad. A held direction steps one cell every 120 ms (see world.ts).
import { defineInput } from '@engine';

export default defineInput({
  id: 'move-x', label: 'Move left or right',
  axis: {
    negative: { keys: ['code:ArrowLeft', 'code:KeyA'], pad: ['ls-left', 'dpad-left'] },
    positive: { keys: ['code:ArrowRight', 'code:KeyD'], pad: ['ls-right', 'dpad-right'] },
  },
});
