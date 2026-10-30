// One input action: a button every player can reach (key, pad and a tap on the view).
import {defineInput} from '@engine';

export default defineInput({id: 'turn', label: 'Turn', keys: ['Space'], pad: ['a'], tap: true});
