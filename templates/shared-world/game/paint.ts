// Paint (or clear) the cell under you: Space, pad A, or a tap or click on the view.
import {defineInput} from '@engine';

export default defineInput({id: 'paint', label: 'Paint', keys: ['Space'], pad: ['a'], tap: true});
