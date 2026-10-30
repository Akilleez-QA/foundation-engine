# L2 `domain/`: pure rules

Pure maths and fixed-step simulation hosts, and any game's own pure systems. No DOM and no rendering library (STD-LAY-4); may import `core/` and the worker job vocabulary (`platform/workers/`). `domain/math/` imports nothing at all, so it runs in workers and tests.
