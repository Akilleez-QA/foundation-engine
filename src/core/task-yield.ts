/** One cooperative task boundary, not a frame loop. Never substitute a microtask.
 * The returned cancellation releases an outstanding timer; running code is not preemptible. */
export type TaskScheduler = (resume: () => void) => (() => void);
export const scheduleTask: TaskScheduler = resume => {
 const timer=globalThis.setTimeout(resume,0);
 return ()=>globalThis.clearTimeout(timer);
};
