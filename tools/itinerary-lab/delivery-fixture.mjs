import {createItinerary} from '../../src/kits/itinerary/index.ts';

/** Synthetic custody owner: finite units, no persistence or external publication. */
export function deliveryFixture() {
  const itinerary = createItinerary({maxOrders: 8, maxTextLength: 32, tags: ['collect', 'deliver', 'service']});
  let stock = 4;
  let carried = 0;
  let delivered = 0;
  let services = 0;
  function accept(ticket, observedDestination) {
    if (
      observedDestination.id !== ticket.order.destination.id ||
      observedDestination.generation !== ticket.order.destination.generation ||
      !itinerary.check(ticket)
    )
      return false;
    const {tag, value} = ticket.order;
    if ((tag === 'collect' && value > stock) || (tag === 'deliver' && value > carried)) return false;
    if (!itinerary.finish(ticket)) return false;
    if (tag === 'collect') {
      stock -= value;
      carried += value;
    }
    if (tag === 'deliver') {
      carried -= value;
      delivered += value;
    }
    if (tag === 'service') services++;
    return true;
  }
  return {itinerary, accept, state: () => ({stock, carried, delivered, services})};
}
