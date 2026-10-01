// core/app-events.ts: the app-wide typed event bus (ADR 0004). The kernel boots on it (app/main.ts passes
// it to createApp), so it is the kernel's `events` service; code that has no `Services` yet emits on it
// directly until it moves to `s.events`, with no change for listeners.
import { createEventBus, type EventBus, type EventBusDebug } from './events';

const bus = createEventBus();
export const appEvents: EventBus = bus;
/** Dev tools and tests only: listener counts for leak checks. Features never import it. */
export const appEventsDebug: EventBusDebug = bus;
/** The composition root only (app/main.ts): the bus the kernel boots on. */
export const appBus: EventBus & EventBusDebug = bus;

