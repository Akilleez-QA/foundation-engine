import {createItinerary} from './itinerary.ts';
import {createNavigationGraph, createPathSearch} from '../../src/kits/navigation/search.ts';

export function patrolFixture() {
  const itinerary = createItinerary({maxOrders: 8, maxTextLength: 32, tags: ['visit', 'observe']});
  const graph = createNavigationGraph([
    {id: 'gate', edges: [{to: 'tower', cost: 1}]},
    {id: 'tower', edges: [{to: 'gate', cost: 1}]},
  ]);
  let position = 'gate';
  let observations = 0;
  let search = null;
  function prepare(ticket) {
    search?.cancel();
    search = createPathSearch(graph, position, ticket.order.destination.id);
    return search;
  }
  function arrive(ticket, physicalPosition, observedGeneration) {
    if (physicalPosition !== ticket.order.destination.id || observedGeneration !== ticket.order.destination.generation)
      return false;
    if (search?.result.status !== 'arrived' || !itinerary.finish(ticket)) return false;
    position = physicalPosition;
    if (ticket.order.tag === 'observe') observations += ticket.order.value;
    search = null;
    return true;
  }
  return {
    itinerary,
    prepare,
    arrive,
    state: () => ({position, observations}),
    cancel: () => {
      search?.cancel();
      search = null;
      itinerary.cancel();
    },
    dispose: () => {
      search?.cancel();
      search = null;
      itinerary.dispose();
    },
  };
}

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
