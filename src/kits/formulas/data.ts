/**
 * kits/formulas/data.ts: creator tables and formula sheets from spreadsheet data. A creator keeps stat curves, type
 * charts and formula steps in a spreadsheet (or recovers them from an original game's data); this module parses the
 * exported CSV/TSV, validates it into the kit's own forms and gives the result back as plain JSON to commit, with the
 * line (and column) of every refusal. `npm run formulas:import` is the command-line front end.
 *
 * Three shapes:
 *   - sheet:  rows `kind,id,value` with kind input | constant | step → a `FormulaSheetInput` (checked by
 *             `defineFormulaSheet`)
 *   - table:  a header row, then one row per key: numeric columns by name (a level curve, an item list)
 *   - matrix: a header row of column keys, then one row per row key: one number per cell (a type chart)
 * Tables and matrices are frozen lookups (`defineFormulaTable`, `tableRow`, `tableValue`) whose rows can be passed to
 * `evaluateSheet` as inputs. Pure; no I/O.
 */
import {captureArray, FormulaError, isFormulaName} from './expression';
import {defineFormulaSheet, type FormulaSheetInput} from './sheet';

export interface DelimitedLimits {
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCellLength: number;
}
export const DEFAULT_DATA_LIMITS: DelimitedLimits = Object.freeze({
  maxRows: 4096,
  maxColumns: 256,
  maxCellLength: 4096,
});
const CEILINGS: DelimitedLimits = Object.freeze({maxRows: 65536, maxColumns: 4096, maxCellLength: 65536});

function captureLimits(limits: Partial<DelimitedLimits> | undefined): DelimitedLimits {
  const out = {} as Record<keyof DelimitedLimits, number>;
  for (const k of Object.keys(DEFAULT_DATA_LIMITS) as (keyof DelimitedLimits)[]) {
    const v = limits?.[k] === undefined ? DEFAULT_DATA_LIMITS[k] : limits[k];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > CEILINGS[k])
      throw new FormulaError(`data: ${k} must be an integer in 1..${CEILINGS[k]}`);
    out[k] = v;
  }
  return out;
}

/** Where data came from, kept with it so a recovered table stays attributable. Only these keys, all text. */
export interface FormulaDataMeta {
  readonly source?: string;
  readonly sourceSha256?: string;
  readonly author?: string;
  readonly licence?: string;
  readonly note?: string;
}
const META_KEYS = ['source', 'sourceSha256', 'author', 'licence', 'note'] as const;
/** A validated, frozen copy of `meta` (unknown keys refused; each value read once). */
export function captureMeta(meta: unknown): FormulaDataMeta {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new FormulaError('data: meta must be an object');
  const out: Record<string, string> = {};
  for (const k of Reflect.ownKeys(meta)) {
    if (typeof k !== 'string' || !(META_KEYS as readonly string[]).includes(k))
      throw new FormulaError(`data: meta.${String(k)} is not a known field`);
    const d = Object.getOwnPropertyDescriptor(meta, k)!;
    if (!('value' in d) || typeof d.value !== 'string' || d.value.length > 1024)
      throw new FormulaError(`data: meta.${k} must be text of at most 1,024 characters`);
    if (k === 'sourceSha256' && !/^[0-9a-f]{64}$/.test(d.value))
      throw new FormulaError('data: meta.sourceSha256 must be 64 lowercase hex digits');
    out[k] = d.value;
  }
  return Object.freeze(out);
}

/**
 * RFC 4180 delimited text to rows of cells: quoted cells may hold the delimiter, quotes ("" escapes) and line breaks;
 * CRLF, LF or CR rows; a UTF-8 byte-order mark is ignored. Unquoted cells and the space around quoted cells are
 * trimmed. Rows whose cells are all empty (blank lines, or `,,` rows that spreadsheets export) are skipped. When
 * `lines` is given, it receives each returned row's first line number, so callers can name lines in refusals.
 */
export function parseDelimited(
  text: string,
  delimiter = ',',
  limits?: Partial<DelimitedLimits>,
  lines?: number[],
): string[][] {
  const l = captureLimits(limits);
  if (typeof text !== 'string') throw new FormulaError('data: text must be a string');
  if (
    typeof delimiter !== 'string' ||
    delimiter.length !== 1 ||
    delimiter === '"' ||
    delimiter === '\n' ||
    delimiter === '\r'
  )
    throw new FormulaError('data: the delimiter must be one character other than a quote or line break');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    wasQuoted = false,
    line = 1,
    rowLine = 1;
  const grow = (s: string) => {
    cell += s;
    if (cell.length > l.maxCellLength)
      throw new FormulaError(`data line ${line}: a cell is longer than ${l.maxCellLength} characters`);
  };
  const pushCell = () => {
    row.push(wasQuoted ? cell : cell.trim());
    if (row.length > l.maxColumns) throw new FormulaError(`data line ${line}: more than ${l.maxColumns} columns`);
    cell = '';
    wasQuoted = false;
  };
  const pushRow = () => {
    pushCell();
    if (row.some(c => c !== '')) {
      rows.push(row);
      lines?.push(rowLine);
      if (rows.length > l.maxRows) throw new FormulaError(`data: more than ${l.maxRows} rows`);
    }
    row = [];
  };
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          grow('"');
          i++;
        } else quoted = false;
      } else {
        if (c === '\n') line++;
        grow(c);
      }
    } else if (c === '"') {
      if (cell.trim() !== '' || wasQuoted) throw new FormulaError(`data line ${line}: a quote inside an unquoted cell`);
      cell = '';
      quoted = true;
      wasQuoted = true;
    } else if (c === delimiter) pushCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      line++;
      rowLine = line;
    } else if (wasQuoted) {
      // Space after a closing quote is layout, not part of the value; anything else is refused.
      if (c.trim() !== '') throw new FormulaError(`data line ${line}: text after a closing quote`);
    } else grow(c);
  }
  if (quoted) throw new FormulaError('data: a quoted cell is not closed');
  if (cell !== '' || row.length) pushRow();
  return rows;
}

const number = (cell: string, where: string): number => {
  // Plain decimal or exponent notation only: no hex, no thousands separators, no locale commas.
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cell))
    throw new FormulaError(`${where}: "${cell}" is not a number`);
  const v = Number(cell);
  if (!Number.isFinite(v)) throw new FormulaError(`${where}: ${cell} is not finite`);
  if (v === 0 && /[1-9]/.test(cell.split(/[eE]/)[0]!)) throw new FormulaError(`${where}: ${cell} underflows to zero`);
  return v === 0 ? 0 : v;
};
/** A row key (or matrix column key): 1..64 characters of text, no leading/trailing space, not a prototype name. */
const isKey = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 64 &&
  v.trim() === v &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
const key = (cell: string, where: string): string => {
  if (!isKey(cell)) throw new FormulaError(`${where}: "${cell}" is not a usable key (1..64 characters)`);
  return cell;
};
const name = (cell: string, where: string): string => {
  if (!isFormulaName(cell))
    throw new FormulaError(`${where}: "${cell}" is not a usable name (letters, digits, _ and dots)`);
  return cell;
};
/** Rows as dense arrays of strings, with the line (or record number) used in messages. */
function captureRows(
  rows: unknown,
  lines: readonly number[] | undefined,
): {cells: string[][]; where: (i: number) => string} {
  const list = captureArray(rows, CEILINGS.maxRows, 'rows');
  const cells = list.map((r, i) => {
    const row = captureArray(r, CEILINGS.maxColumns, `row ${i + 1}`);
    if (row.some(c => typeof c !== 'string')) throw new FormulaError(`row ${i + 1}: cells must be text`);
    return row as string[];
  });
  return {cells, where: i => (lines?.[i] !== undefined ? `line ${lines[i]}` : `row ${i + 1}`)};
}

/** Options shared by the importers. `lines` are the line numbers `parseDelimited` reported, for messages. */
export interface ImportOptions {
  readonly meta?: FormulaDataMeta;
  readonly lines?: readonly number[];
}

/**
 * Rows `kind,id,value` (an optional header row whose first cell is `kind` is skipped) to a validated sheet input.
 * `input` rows name an input (value empty); `constant` rows give a number; `step` rows give formula text.
 */
export function importFormulaSheet(
  rows: readonly (readonly string[])[],
  options: ImportOptions = {},
): FormulaSheetInput & {meta?: FormulaDataMeta} {
  const meta = options.meta === undefined ? undefined : captureMeta(options.meta);
  const {cells, where} = captureRows(rows, options.lines);
  const inputs: string[] = [],
    constants: Record<string, number> = {},
    steps: {id: string; expr: {text: string}}[] = [];
  const whereOf = new Map<string, string>();
  cells.forEach((r, i) => {
    const at = where(i);
    if (i === 0 && r[0]?.toLowerCase() === 'kind') return;
    const [kind, id = '', value = '', ...rest] = r;
    if (rest.some(c => c !== '')) throw new FormulaError(`${at}: expected kind,id,value (extra cells)`);
    name(id, `${at} id`);
    if (whereOf.has(id)) throw new FormulaError(`${at}: ${id} is already defined on ${whereOf.get(id)}`);
    whereOf.set(id, at);
    if (kind === 'input') {
      if (value !== '') throw new FormulaError(`${at}: an input has no value`);
      inputs.push(id);
    } else if (kind === 'constant') constants[id] = number(value, `${at} value`);
    else if (kind === 'step') {
      if (value === '') throw new FormulaError(`${at}: a step needs formula text`);
      steps.push({id, expr: {text: value}});
    } else throw new FormulaError(`${at}: kind must be input, constant or step (got "${kind ?? ''}")`);
  });
  if (steps.length === 0) throw new FormulaError('data: a sheet needs at least one step row');
  // A sheet needs at least one step, so "inputs and constants alone" is checked with one placeholder step whose
  // name is unused.
  let placeholder = 'import_check';
  while (whereOf.has(placeholder)) placeholder += '_';
  const fails = (k: number): string | null => {
    try {
      defineFormulaSheet({inputs, constants, steps: k === 0 ? [{id: placeholder, expr: 0}] : steps.slice(0, k)});
      return null;
    } catch (error) {
      return (error as Error).message.replace(/^formulas: /, '');
    }
  };
  if (fails(steps.length) !== null) {
    // Inputs and constants alone: a failure there names no step.
    const base = fails(0);
    if (base !== null) throw new FormulaError(`inputs and constants: ${base}`);
    // Adding steps only adds ways to fail, so the first failing prefix is found by binary search.
    let lo = 0,
      hi = steps.length; // prefix lo is valid, prefix hi fails
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fails(mid) === null) lo = mid;
      else hi = mid;
    }
    const culprit = steps[hi - 1]!.id;
    throw new FormulaError(`${whereOf.get(culprit)} (${culprit}): ${fails(hi)}`);
  }
  return {inputs, constants, steps, ...(meta ? {meta: {...meta}} : {})};
}

/** A frozen lookup: numeric cells by row key and column name. */
export interface FormulaTable {
  readonly kind: 'table' | 'matrix';
  readonly columns: readonly string[];
  readonly rows: readonly string[];
  /** Row-major values, rows.length × columns.length. */
  readonly values: readonly number[];
  readonly meta?: FormulaDataMeta;
}
/** The JSON form a creator commits (what `importFormulaTable` returns and `defineFormulaTable` accepts). */
export interface FormulaTableInput {
  readonly kind: 'table' | 'matrix';
  readonly columns: readonly string[];
  readonly rows: readonly string[];
  readonly values: readonly (readonly number[])[];
  readonly meta?: FormulaDataMeta;
}

/**
 * Header row then data rows to a table input. `table`: the first header cell names the key column (any text), the
 * others are column names. `matrix`: the first header cell is ignored (often blank), the others are column keys.
 * Row keys are any short text ("12", "Fire"); table column names must be formula names, so a row can feed
 * `evaluateSheet` directly; matrix column keys are any short text.
 */
export function importFormulaTable(
  rows: readonly (readonly string[])[],
  kind: 'table' | 'matrix',
  options: ImportOptions = {},
): FormulaTableInput {
  if (kind !== 'table' && kind !== 'matrix') throw new FormulaError(`data: kind must be table or matrix`);
  const meta = options.meta === undefined ? undefined : captureMeta(options.meta);
  const {cells, where} = captureRows(rows, options.lines);
  if (cells.length < 2) throw new FormulaError('data: a table needs a header row and at least one data row');
  const header = cells[0]!;
  if (header.length < 2) throw new FormulaError(`${where(0)}: a table needs at least one value column`);
  const columns = header.slice(1).map((c, j) => (kind === 'table' ? name : key)(c, `${where(0)} column ${j + 2}`));
  const keys: string[] = [],
    values: number[][] = [];
  for (let i = 1; i < cells.length; i++) {
    const r = cells[i]!;
    if (r.length !== header.length)
      throw new FormulaError(`${where(i)}: ${r.length} cells, the header has ${header.length}`);
    keys.push(key(r[0]!, `${where(i)} key`));
    values.push(r.slice(1).map((c, j) => number(c, `${where(i)} column ${columns[j]}`)));
  }
  const input: FormulaTableInput = {kind, columns, rows: keys, values, ...(meta ? {meta: {...meta}} : {})};
  defineFormulaTable(input); // the same checks a game runs when it loads the JSON
  return input;
}

/** Validate committed table JSON into a frozen lookup. Throws FormulaError naming the first problem. */
export function defineFormulaTable(input: FormulaTableInput, limits?: Partial<DelimitedLimits>): FormulaTable {
  const l = captureLimits(limits);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FormulaError('table: expected an object');
  const field = (k: string): unknown => {
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (d && !('value' in d)) throw new FormulaError(`table: ${k} must be data, not an accessor`);
    return d?.value;
  };
  const kind = field('kind');
  if (kind !== 'table' && kind !== 'matrix') throw new FormulaError('table: kind must be table or matrix');
  // Every array is read once into a plain copy, so what is checked is what is stored.
  const columns = captureArray(field('columns'), l.maxColumns, 'table: columns');
  const rows = captureArray(field('rows'), l.maxRows, 'table: rows');
  const valueRows = captureArray(field('values'), l.maxRows, 'table: values');
  if (columns.length < 1) throw new FormulaError(`table: 1..${l.maxColumns} columns`);
  if (rows.length < 1) throw new FormulaError(`table: 1..${l.maxRows} rows`);
  const unique = (list: unknown[], what: string, asName: boolean) => {
    const seen = new Set<string>();
    list.forEach((v, i) => {
      if (asName ? !isFormulaName(v) : !isKey(v))
        throw new FormulaError(`table: ${what} ${i + 1} "${String(v)}" is not a usable ${asName ? 'name' : 'key'}`);
      if (seen.has(v as string)) throw new FormulaError(`table: ${what} "${String(v)}" appears twice`);
      seen.add(v as string);
    });
  };
  unique(columns, 'column', kind === 'table'); // table columns become sheet input names
  unique(rows, 'row', false);
  if (valueRows.length !== rows.length)
    throw new FormulaError(`table: ${valueRows.length} value rows for ${rows.length} keys`);
  const flat: number[] = [];
  valueRows.forEach((r, i) => {
    const row = captureArray(r, l.maxColumns, `table: row ${String(rows[i])}`);
    if (row.length !== columns.length)
      throw new FormulaError(`table: row ${String(rows[i])} has ${row.length} values for ${columns.length} columns`);
    for (const v of row) {
      if (typeof v !== 'number' || !Number.isFinite(v))
        throw new FormulaError(`table: row ${String(rows[i])} holds a value that is not a finite number`);
      flat.push(v === 0 ? 0 : v);
    }
  });
  const metaValue = field('meta');
  const m = metaValue === undefined ? undefined : captureMeta(metaValue);
  const names = columns as string[],
    keys = rows as string[];
  const table: FormulaTable = Object.freeze({
    kind,
    columns: Object.freeze([...names]),
    rows: Object.freeze([...keys]),
    values: Object.freeze(flat),
    ...(m ? {meta: m} : {}),
  });
  INDEX.set(table, {index: new Map(keys.map((r, i) => [r, i])), colIndex: new Map(names.map((c, j) => [c, j]))});
  return table;
}
const INDEX = new WeakMap<FormulaTable, {index: Map<string, number>; colIndex: Map<string, number>}>();
const indexOf = (table: FormulaTable) => {
  const i = INDEX.get(table);
  if (!i) throw new FormulaError('table: use a table returned by defineFormulaTable');
  return i;
};
const textKey = (v: unknown, what: string): string => {
  if (typeof v !== 'string')
    throw new FormulaError(`table: the ${what} must be text (got ${typeof v}); keys such as "12" are strings`);
  return v;
};

/** One cell. Throws FormulaError for an unknown row or column (a missing type in a chart is a data bug). */
export function tableValue(table: FormulaTable, row: string, column: string): number {
  const {index, colIndex} = indexOf(table);
  const r = index.get(textKey(row, 'row key')),
    c = colIndex.get(textKey(column, 'column'));
  if (r === undefined) throw new FormulaError(`table: no row ${row}`);
  if (c === undefined) throw new FormulaError(`table: no column ${column}`);
  return table.values[r * table.columns.length + c]!;
}

/**
 * One row as an object of column → value, for `evaluateSheet` inputs. `prefix` namespaces the names
 * (`tableRow(levels, '12', 'level')` → `{'level.hp': …, 'level.attack': …}`). `columns` picks some columns, since
 * `evaluateSheet` takes exactly the sheet's inputs.
 */
export function tableRow(
  table: FormulaTable,
  row: string,
  prefix?: string,
  columns?: readonly string[],
): Record<string, number> {
  const {index, colIndex} = indexOf(table);
  if (table.kind !== 'table') throw new FormulaError('table: tableRow reads a table; read a matrix with tableValue');
  const r = index.get(textKey(row, 'row key'));
  if (r === undefined) throw new FormulaError(`table: no row ${row}`);
  if (prefix !== undefined && !isFormulaName(prefix))
    throw new FormulaError(`table: prefix "${prefix}" is not a usable name`);
  const out: Record<string, number> = {};
  const picked = columns === undefined ? table.columns : captureArray(columns, table.columns.length, 'columns');
  for (const c of picked) {
    const j = colIndex.get(textKey(c, 'column'));
    if (j === undefined) throw new FormulaError(`table: no column ${String(c)}`);
    const nameOut = prefix ? `${prefix}.${String(c)}` : String(c);
    if (!isFormulaName(nameOut)) throw new FormulaError(`table: "${nameOut}" is longer than a sheet input name may be`);
    out[nameOut] = table.values[r * table.columns.length + j]!;
  }
  return out;
}
