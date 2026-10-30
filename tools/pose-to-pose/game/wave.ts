// The robot waves (and walks again): a key and a pad button.
import {defineInput} from '@engine';

export default defineInput({id: 'wave', label: 'Wave', keys: ['code:KeyE'], pad: ['y']});
