/** Worker script for the host's generic workers. Binds the runtime to the worker global scope. */
import {jobLoaders} from './job-rows.ts';
import {createWorkerRuntime, type WorkerPort} from './worker-runtime.ts';

createWorkerRuntime(self as WorkerPort, jobLoaders);
