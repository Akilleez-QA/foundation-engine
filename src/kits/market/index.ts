import { defineKit } from '../../author';
export function market() { return defineKit({ id: 'market' }); }
export interface Offer { id:string; revision:number; seller:string; item:string; quantity:number; unitPrice:number; expires:number }
export interface Purchase { id:string; offer:string; revision:number; buyer:string; quantity:number }
export interface Claim { id:string; buyer:string; item:string; quantity:number; collected:boolean }
export interface MarketSnapshot { balances:Record<string,number>; offers:Offer[]; receipts:{request:Purchase;claim:Claim}[] }
const integer = (n:number) => Number.isSafeInteger(n) && n >= 0;
/** Single-authority in-memory settlement. Persist the complete snapshot, not individual ledgers. */
export function createMarket(initial:MarketSnapshot,limits={offers:1024,receipts:4096}) {
  limits={...limits};
  const validId=(id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=256;
  const request=(r:Purchase):Purchase=>{if(!r||!validId(r.id)||!validId(r.offer)||!validId(r.buyer)||!integer(r.revision)||!integer(r.quantity)||r.quantity<1)throw Error('market: invalid request');return {id:r.id,offer:r.offer,revision:r.revision,buyer:r.buyer,quantity:r.quantity};};
  const copy=structuredClone(initial),balances=new Map(Object.entries(copy.balances)),offers=new Map<string,Offer>(),receipts=new Map<string,{request:Purchase;claim:Claim}>();
  if(!integer(limits.offers)||!integer(limits.receipts)||limits.offers<1||limits.receipts<1||balances.size>4096||[...balances].some(([id,n])=>!id||!integer(n)))throw Error('market: invalid configuration');
  const validateOffer=(o:Offer)=>{if(!validId(o.id)||!validId(o.item)||!balances.has(o.seller)||!integer(o.revision)||!integer(o.quantity)||!integer(o.unitPrice)||!Number.isFinite(o.expires))throw Error('market: invalid offer');};
  for(const o of copy.offers){validateOffer(o);if(offers.has(o.id)||offers.size>=limits.offers)throw Error('market: duplicate/full offers');offers.set(o.id,o);}
  for(const r of copy.receipts){r.request=request(r.request);if(!r.request.id||r.claim.id!==r.request.id||r.claim.buyer!==r.request.buyer||!balances.has(r.claim.buyer)||!validId(r.claim.item)||!integer(r.claim.quantity)||r.claim.quantity<1||r.claim.quantity!==r.request.quantity||typeof r.claim.collected!=='boolean'||receipts.has(r.request.id)||receipts.size>=limits.receipts)throw Error('market: invalid receipt');receipts.set(r.request.id,r);}
  // Deadline ordering is rebuilt only when stock definitions change, never scanned by every tick.
  let deadlines=[...offers.values()].sort((a,b)=>a.expires-b.expires||a.id.localeCompare(b.id)),cursor=0;
  return {
    quote(id:string):Offer|undefined {const o=offers.get(id);return o?structuredClone(o):undefined;},
    purchase(raw:Purchase,now:number):{ok:true;claim:Claim;duplicate:boolean}|{ok:false;reason:string}{
      const r=request(raw);
      if(!r.id||!r.offer||!balances.has(r.buyer)||!integer(r.revision)||!integer(r.quantity)||r.quantity<1||!Number.isFinite(now))throw Error('market: invalid request');
      const old=receipts.get(r.id);if(old)return JSON.stringify(old.request)===JSON.stringify(r)?{ok:true,claim:structuredClone(old.claim),duplicate:true}:{ok:false,reason:'conflict'};
      if(receipts.size>=limits.receipts)return {ok:false,reason:'receipts-full'};
      const o=offers.get(r.offer);if(!o||o.revision!==r.revision||o.expires<=now)return {ok:false,reason:'stale'};
      if(o.quantity<r.quantity)return {ok:false,reason:'stock'};
      const price=o.unitPrice*r.quantity,buyer=balances.get(r.buyer)!,seller=balances.get(o.seller)!;
      if(!integer(price)||buyer<price)return {ok:false,reason:'funds'};
      if(o.seller!==r.buyer&&!integer(seller+price))return {ok:false,reason:'credit-cap'};
      const claim:Claim={id:r.id,buyer:r.buyer,item:o.item,quantity:r.quantity,collected:false};
      // All rejection paths precede this synchronous commit. Persist the claim with the whole snapshot.
      if(o.seller!==r.buyer){balances.set(r.buyer,buyer-price);balances.set(o.seller,seller+price);}
      o.quantity-=r.quantity;receipts.set(r.id,{request:r,claim});
      return {ok:true,claim:structuredClone(claim),duplicate:false};
    },
    /** Caller must atomically store the returned market snapshot with its destination state. */
    collect(id:string,buyer:string,freeUnits:number):Claim|null {
      if(!integer(freeUnits))throw Error('market: invalid capacity');const r=receipts.get(id);
      if(!r||r.claim.buyer!==buyer||r.claim.collected||r.claim.quantity>freeUnits)return null;
      r.claim.collected=true;return structuredClone(r.claim);
    },
    expire(now:number,maxWork:number){
      if(!Number.isFinite(now)||!integer(maxWork))throw Error('market: invalid expiry budget');let work=0;
      while(work<maxWork&&cursor<deadlines.length&&deadlines[cursor].expires<=now){const o=deadlines[cursor++];offers.delete(o.id);work++;}return work;
    },
    balance:(id:string)=>balances.get(id),
    snapshot:():MarketSnapshot=>({balances:Object.fromEntries(balances),offers:[...offers.values()].map(o=>structuredClone(o)),receipts:[...receipts.values()].map(r=>structuredClone(r))}),
  };
}
