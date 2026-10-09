/** Optional, request-owned incremental graph routing; no frame system or renderer. */
import {defineKit, type KitDefinition} from '../../author';
export {
  createNavigationGraph,
  createPathSearch,
  type NavigationGraph,
  type NavigationNode,
  type NavigationEdge,
  type PathSearch,
  type PathResult,
  type PathStep,
} from './search';
export function navigation(): KitDefinition {
  return defineKit({id: 'navigation', requires: [], defs: [], modules: []});
}
export {createRouteQueue, type RouteRequest} from './queue';
export {
  definePortal,
  crossPortal,
  createPortalGraph,
  type NavigationPortal,
  type PortalEndpoint,
  type AgentClearance,
} from './portals';
export {createRouteFollower, type FollowerState, type RoutePoint} from './follower';
export {
  createLifetimeRouteQueue,
  type RouteOwner,
  type RouteOwnerAdmission,
  type LifetimeRouteRequest,
  type LifetimeRouteAdmission,
} from './lifetimes';
export {createRouteDependencies, type RouteScope, type DependencyTicket, type DependencyStatus} from './dependencies';
export {
  createDistanceField,
  type DistanceLabel,
  type NavigationField,
  type FieldResult,
  type FieldPhase,
  type FieldSearch,
} from './field';
