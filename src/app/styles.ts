// app/styles.ts: the eager stylesheets, in cascade order (tokens first: it declares the layer order). A scene's own
// CSS is imported by its lazy body, never here.
import '../platform/ui/tokens.css';
import '../platform/ui/shell.css';
import '../platform/ui/scene-chrome.css';
