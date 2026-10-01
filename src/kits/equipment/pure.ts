export interface ItemInstance { id:string; definition:string; slots:readonly string[]; functional:boolean }
export interface EquipmentSnapshot { revision:number; items:ItemInstance[]; equipped:string[] }
const validRevision = (n: number) => Number.isSafeInteger(n) && n >= 0;
const name = (s: string) => typeof s === 'string' && s.length > 0 && s.length <= 256;
function captureArray<T>(input: readonly T[], max: number): T[] {
  if (!Array.isArray(input)) throw Error('equipment: expected array');
  const length = input.length;
  if (!Number.isSafeInteger(length) || length > max) throw Error('equipment: record limit');
  const result: T[] = [];
  for (let i = 0; i < length; i++) result.push(input[i]);
  return result;
}
function captureItem(input: ItemInstance, slots: readonly string[]): ItemInstance {
  if (!input || typeof input !== 'object') throw Error('equipment: invalid item');
  const {id, definition, functional, slots: arrangement} = input;
  const captured = captureArray(arrangement, 64);
  if (!name(id) || !name(definition) || typeof functional !== 'boolean' || !captured.length
    || new Set(captured).size !== captured.length || captured.some(s => !slots.includes(s))) throw Error('equipment: invalid item');
  return {id, definition, functional, slots: captured};
}
const copyItem = (item: ItemInstance): ItemInstance => ({...item, slots: [...item.slots]});
/** Local unique custody. Mutations validate complete candidates before publication; no external side effects. */
export function createEquipment(inputSlots:readonly string[],bagCapacity:number,initial:EquipmentSnapshot) {
  const slots = captureArray(inputSlots, 64);
  if(!Number.isSafeInteger(bagCapacity)||bagCapacity<0||new Set(slots).size!==slots.length||slots.some(s=>!name(s)))throw Error('equipment: invalid capacity or slots');
  if (!initial || typeof initial !== 'object') throw Error('equipment: invalid state');
  const {revision: initialRevision, items: initialItems, equipped: initialEquipped} = initial;
  const captured = captureArray(initialItems, 4096).map(item => captureItem(item, slots));
  const items = new Map(captured.map(item => [item.id, item]));
  if (items.size !== captured.length || !validRevision(initialRevision)) throw Error('equipment: invalid state');
  const selected = captureArray(initialEquipped, 64);
  let equipped = new Set(selected), revision = initialRevision, busy = false;
  const validate=(set:Set<string>)=>{
    const used=new Set<string>();
    for(const id of set){const item=items.get(id);if(!item)throw Error('equipment: missing item');for(const slot of item.slots){if(used.has(slot))throw Error('equipment: overlapping slots');used.add(slot);}}
    if(items.size-set.size>bagCapacity)throw Error('equipment: bag overflow');
  };
  if(equipped.size!==selected.length)throw Error('equipment: duplicate item');validate(equipped);
  const guarded = <T>(work: () => T): T => {
    if (busy) throw Error('equipment: reentrant mutation');
    busy = true; try { return work(); } finally { busy = false; }
  };
  const stale = (expected: number) => {
    if (!validRevision(expected)) throw Error('equipment: invalid revision');
    return expected !== revision;
  };
  const advance = () => { if(revision===Number.MAX_SAFE_INTEGER)throw Error('equipment: revision exhausted'); };
  const plan=(id:string,wear:boolean)=>{
    if(typeof wear!=='boolean')throw Error('equipment: invalid operation');
    const item=items.get(id);if(!item)throw Error('equipment: unknown instance');
    const next=new Set(equipped),displaced:string[]=[];
    if(wear){for(const current of equipped)if(current!==id&&items.get(current)!.slots.some(s=>item.slots.includes(s))){next.delete(current);displaced.push(current);}next.add(id);}
    else next.delete(id);
    return {next,displaced,room:items.size-next.size<=bagCapacity};
  };
  return {
    preview(id:string,wear=true){const p=plan(id,wear);return {revision,displaced:[...p.displaced],fits:p.room};},
    commit(id:string,expectedRevision:number,wear=true):'applied'|'unchanged'|'stale'|'capacity'{
      return guarded(() => {
        if(stale(expectedRevision))return 'stale';const p=plan(id,wear);if(!p.room)return 'capacity';
        if(p.next.size===equipped.size&&[...p.next].every(x=>equipped.has(x)))return 'unchanged';
        advance();validate(p.next);equipped=p.next;revision++;return 'applied';
      });
    },
    /** Admits to unequipped custody only; duplicate identities never replace existing facts. */
    acquire(input: ItemInstance, expectedRevision: number): 'applied'|'stale'|'duplicate'|'capacity'|'limit' {
      return guarded(() => {
        if (stale(expectedRevision)) return 'stale';
        const item = captureItem(input, slots);
        if (items.has(item.id)) return 'duplicate';
        if (items.size >= 4096) return 'limit';
        if (items.size - equipped.size >= bagCapacity) return 'capacity';
        advance(); items.set(item.id, item); revision++; return 'applied';
      });
    },
    /** Equipped items must first be explicitly unequipped, or changed in an application-owned draft. */
    release(id: string, expectedRevision: number): 'applied'|'stale'|'missing'|'equipped' {
      return guarded(() => {
        if (stale(expectedRevision)) return 'stale';
        if (!name(id)) throw Error('equipment: invalid identity');
        if (!items.has(id)) return 'missing';
        if (equipped.has(id)) return 'equipped';
        advance(); items.delete(id); revision++; return 'applied';
      });
    },
    equipped: (): ItemInstance[] => [...equipped].map(id => copyItem(items.get(id)!)),
    active:()=>[...equipped].map(id=>copyItem(items.get(id)!)).filter(i=>i.functional),
    snapshot:():EquipmentSnapshot=>({revision,items:[...items.values()].map(copyItem),equipped:[...equipped]}),
  };
}
