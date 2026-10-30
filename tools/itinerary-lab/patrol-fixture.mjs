import {createItinerary} from '../../src/kits/itinerary/index.ts';
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
  let searchTicket = null;
  function prepare(ticket) {
    if (!itinerary.check(ticket)) throw new Error('Cannot prepare a retired patrol attempt');
    search?.cancel();
    search = createPathSearch(graph, position, ticket.order.destination.id);
    searchTicket = ticket;
    return search;
  }
  function arrive(ticket, physicalPosition, observedGeneration) {
    if (physicalPosition !== ticket.order.destination.id || observedGeneration !== ticket.order.destination.generation)
      return false;
    if (searchTicket !== ticket || search?.result.status !== 'arrived' || !itinerary.finish(ticket)) return false;
    position = physicalPosition;
    if (ticket.order.tag === 'observe') observations += ticket.order.value;
    search = null;
    searchTicket = null;
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
      searchTicket = null;
      itinerary.cancel();
    },
    dispose: () => {
      search?.cancel();
      search = null;
      searchTicket = null;
      itinerary.dispose();
    },
  };
}
