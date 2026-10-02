// Forward and back: keys and the stick or d-pad.
import { defineInput } from '@engine';

export default defineInput({
  id: 'move-z', label: 'Move forward or back',
  axis: {
    negative: { keys: ['code:ArrowUp', 'code:KeyW'], pad: ['ls-up', 'dpad-up'] },
    positive: { keys: ['code:ArrowDown', 'code:KeyS'], pad: ['ls-down', 'dpad-down'] },
  },
});
