import {createDependencyBudget} from '@engine';

/** One application-owned allowance covers the outgoing visit and incoming preflight. */
export const preparationBudget = createDependencyBudget(416);
