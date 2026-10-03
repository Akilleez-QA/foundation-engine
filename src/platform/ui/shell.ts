import copyCatalog from './strings/shell/en.json';
import {appI18n as copyI18n, h as copyHtml} from '../../core/i18n/app-i18n';
copyI18n.addCatalog('en', copyCatalog);
/**
 * platform/ui/shell.ts: the shell button registry (ADR 0020, STD-RUN-23).
 *
 * The top bar is the shell's. A module that wants a button in it adds a row; nothing else touches the header DOM.
 * The shell owns the two zones and places each row by its `order`, whenever it registers:
 *
 *  - `header`: the right-hand side of the top bar (`.header-right`);
 *  - `menu`: the settings menu, a `<details>` the shell creates as its own header row (`shell.menu`) the first time a
 *    menu row arrives. The menu closes when one of its buttons is pressed, or on a click outside.
 *
 * Suggested orders (gaps leave room for new rows): header 10 map, 20 home, 30 settings menu, 40 quick sound;
 * menu 10 sound, 20 comfort, 40 start over, 50 players and saves, 70 graphics.
 *
 * Rows carry the element their owner builds (with its own text and handler); the shell only places and removes them.
 *
 * Layer rules (STD-LAY-5): platform imports only core and its siblings.
 */

export type ShellZone = 'header' | 'menu';

export interface ShellButtonDef {
  /** '<area>.<name>', unique: 'shell.sound', 'shell.listen', 'shell.menu.graphics'. */
  id: string;
  zone: ShellZone;
  /** Position within the zone, ascending. Equal orders keep registration order. */
  order: number;
  /** The control the owner built. The shell only places it (and removes it with the row). */
  element: HTMLElement;
  /** The reading level of the row's words (a guardian's tool reads 'detailed'). */
  level?: 'standard' | 'detailed';
}

export interface ShellButtonHandle {
  readonly id: string;
  /** Takes the row out of the shell and its element out of the page. */
  remove(): void;
}

interface Mounted {
  def: ShellButtonDef;
  seq: number;
}

const ZONE_SELECTOR: Readonly<Record<ShellZone, string>> = {header: '.header-right', menu: '.shell-menu-content'};

export class Shell {
  private readonly rows = new Map<string, Mounted>();
  private seq = 0;
  private menuListeners = new Set<(menu: HTMLDetailsElement) => void>();

  /** Observe the existing or next settings container; returns a subscription disposer. */
  onMenu(listener: (menu: HTMLDetailsElement) => void): () => void {
    this.menuListeners.add(listener);
    const menu = this.doc.querySelector<HTMLDetailsElement>('details.shell-menu');
    try {
      if (menu) listener(menu);
    } catch (error) {
      this.menuListeners.delete(listener);
      throw error;
    }
    return () => {
      this.menuListeners.delete(listener);
    };
  }

  constructor(private readonly doc: Document) {}

  /** Adds a row and places its element. A second row with the same id is a programming error. */
  add(def: ShellButtonDef): ShellButtonHandle {
    if (this.rows.has(def.id)) throw Error(`Shell button ${def.id} is already registered`);
    const row: Mounted = {def, seq: this.seq++};
    this.rows.set(def.id, row);
    this.place(row);
    return {id: def.id, remove: () => this.remove(def.id)};
  }

  remove(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.delete(id);
    row.def.element.remove();
  }

  /** The rows of a zone in display order. */
  list(zone: ShellZone): readonly ShellButtonDef[] {
    return this.sorted(zone).map(r => r.def);
  }

  private sorted(zone: ShellZone): Mounted[] {
    return [...this.rows.values()]
      .filter(r => r.def.zone === zone)
      .sort((a, b) => a.def.order - b.def.order || a.seq - b.seq);
  }

  /** Inserts the element before the first placed row that sorts after it; otherwise after the zone's other content. */
  private place(row: Mounted): void {
    const container = this.zone(row.def.zone);
    if (!container) return;
    const rows = this.sorted(row.def.zone),
      at = rows.indexOf(row);
    const next = rows
      .slice(at + 1)
      .map(r => r.def.element)
      .find(el => el.parentNode === container);
    if (next) next.before(row.def.element);
    else container.append(row.def.element);
  }

  /** The zone's container; the settings menu is created on first use. Null before the top bar exists. */
  private zone(zone: ShellZone): HTMLElement | null {
    const found = this.doc.querySelector<HTMLElement>(ZONE_SELECTOR[zone]);
    if (found || zone === 'header') return found;
    if (!this.doc.querySelector('.header-right')) return null;
    return this.createMenu();
  }

  /** The settings menu is the shell's own header row. */
  private createMenu(): HTMLElement {
    const doc = this.doc;
    const menu = doc.createElement('details') as HTMLDetailsElement;
    menu.className = 'shell-menu';
    menu.innerHTML = `<summary>${copyHtml('engine.shell.menu')}</summary><div class="shell-menu-content"></div>`;
    menu.addEventListener('click', event => {
      if ((event.target as Element).closest('button')) menu.open = false;
    });
    doc.addEventListener('click', event => {
      if (!menu.contains(event.target as Node)) menu.open = false;
    });
    this.add({id: 'shell.menu', zone: 'header', order: 30, element: menu, level: 'detailed'});
    for (const listener of [...this.menuListeners]) {
      if (this.menuListeners.has(listener)) listener(menu);
    }
    return menu.querySelector<HTMLElement>('.shell-menu-content')!;
  }
}

const shells = new WeakMap<Document, Shell>();
/** The app's one shell (created on first use), one per document so node tests with a fresh fake document get their own. */
export function appShell(doc: Document = document): Shell {
  let shell = shells.get(doc);
  if (!shell) {
    shell = new Shell(doc);
    shells.set(doc, shell);
  }
  return shell;
}
