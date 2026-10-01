import { defineSaveSection } from '@engine';
import { createCheckpointInventory } from '@kits/inventory';
import { createMarket } from '@kits/market';
export const bagOptions = { capacities: { bag: 1 }, maxOperations: 8, maxMaterials: 1 };
export const initialMarket = () => createMarket({ balances: { player: 3, kiosk: 0 }, offers: [{ id: 'probe', revision: 1, seller: 'kiosk', item: 'probe', quantity: 1, unitPrice: 1, expires: 1e9 }], receipts: [] });
export const initialSave = () => ({ bag: createCheckpointInventory(bagOptions).snapshot(), market: initialMarket().snapshot() });
export const labSave = defineSaveSection({ id: 'mechanics.delivery', initial: initialSave(), parse(raw: unknown) {
  const data = raw as ReturnType<typeof initialSave>;
  const bag = createCheckpointInventory(bagOptions, data.bag), market = createMarket(data.market);
  return { bag: bag.snapshot(), market: market.snapshot() };
} });
export default labSave;
