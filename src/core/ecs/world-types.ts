/** core/ecs/world-types.ts: the shared types of the world and its optional tracking (kept apart to avoid a cycle). */
export interface ComponentType<T extends object> {
  readonly id: string;
  /** A fresh default value. */
  initial(): T;
  /** An initialiser for `spawn`/`add`: the defaults with `partial` over them. */
  (partial?: Partial<T>): ComponentInit<T>;
}
export interface ComponentInit<T extends object> {
  readonly type: ComponentType<T>;
  readonly value: T;
}
export type Entity = number;
