/**
 * kits/chalkboard: a chalkboard over a scene's view. Board items (board.ts) are drawn as one SVG in the overlay:
 * strokes draw on (stroke-dash), text is written, items can be revealed, hidden and spotlit, and a caption line shows
 * who is speaking. It is DOM, not WebGL: the board costs no draw calls and uploads nothing while idle; it changes the
 * DOM only when an item's state changes. Text comes in already translated (the caller passes `text(key)`). The board
 * is an image with a title and description for screen readers; captions are a polite live region.
 */
export { BOARD, lengthOf, pathOf, tickLabels, type BoardItem, type Pt } from './board';
export { createBoardView, type BoardItemState, type BoardView, type BoardState } from './view';
