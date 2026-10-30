# JUCE audio and lifetime architecture study

Status: source inspection and proposals only. No dependency, source code, asset or
implementation was imported. Inspected 2026-09-30 against JUCE commit
`be29c81492b6151c8ea8d14c840e1311963b3a83`; Foundation Engine baseline `852f3d7`.
The findings concern reusable browser engine mechanisms, not a particular game.

The pinned [JUCE license file](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/LICENSE.md)
states that framework modules are dual-licensed under AGPLv3 and a commercial JUCE
license. This is a factual provenance note, not permission to incorporate code or
an assessment of compatibility. The recommendations below are architectural
observations and independently implementable proposals.

## Inspected behavior and transferable contracts

### Preparation separated from consumption

`AudioSourcePlayer::setSource` prepares a replacement using the current buffer size
and sample rate before swapping the source under `readLock`, then releases the old
source. The callback consumes the current source; device start/stop invokes explicit
preparation/release. [Source: AudioSourcePlayer.cpp](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_audio_devices/sources/juce_AudioSourcePlayer.cpp#L47).

`BufferingAudioSource::prepareToPlay` allocates its buffer and registers with an
existing `TimeSliceThread`. `getNextAudioBlock` copies available ranges, clears
missing ranges, and does not decode the missing content itself. `releaseResources`
removes the producer before freeing the buffer. Its preparation path can sleep
while waiting for prefill, and its consumer takes locks: this is not evidence that
all JUCE audio paths are allocation-free, wait-free or appropriate for a browser
main thread. [Source: BufferingAudioSource.cpp](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_audio_basics/sources/juce_BufferingAudioSource.cpp#L62).

**Foundation observation:** `src/platform/audio/audio-output.ts` synthesizes an
uncached cue synchronously in `playVoice`, then creates/copies its `AudioBuffer`.
The existing bounded cache helps repeat playback but not the first interaction.

**Proposal:** an owner-scoped prepared-cue contract with explicit pending, ready,
failed and released outcomes. Admit preparation before allocating, deduplicate by
cue/variant/sample rate, and keep the existing audio output as the sole playback
owner. Evaluate existing WorkerHost generation for sufficiently costly preparation;
a worker is not necessary for every tiny cue. Do not add a second scheduler or
silently defer expired interaction feedback until it is no longer relevant.

### Continuous control values

`AudioSourcePlayer::audioDeviceIOCallbackWithContext` uses `applyGainRamp` from the
previous gain to the new target over the output block. This keeps target updates
separate from their sample progression. [Source: AudioSourcePlayer.cpp](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_audio_devices/sources/juce_AudioSourcePlayer.cpp#L154).

**Foundation observation:** master gain updates and `CueVoice.setGain` assign
`AudioParam.value` directly. The optional mixer uses that method for ducking.
Audible discontinuities are plausible but have not been reproduced in this study.

**Proposal:** bounded gain-transition policy using the existing audio context's
sample clock. Define retargeting during an unfinished ramp, immediate mute policy,
pause/resume and disposal behavior explicitly. Simulation time remains owned by
the engine clock; audio sample automation does not become a simulation clock.

### Cancellation versus completed teardown

`TimeSliceThread::removeTimeSliceClient` coordinates with `callbackLock` when the
client is currently executing, ordering list and callback locks carefully. This
provides a stronger teardown boundary than merely removing a queued callback.
[Source: TimeSliceThread.cpp](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_core/threads/juce_TimeSliceThread.cpp#L59).

`AsyncUpdater::cancelPendingUpdate` clears a delivery flag; its header explicitly
states that an already-running callback on another thread is not awaited.
Destruction also checks message-thread coordination when an update is pending.
[Source: AsyncUpdater.h](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_events/broadcasters/juce_AsyncUpdater.h#L80),
[implementation](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_events/broadcasters/juce_AsyncUpdater.cpp#L61).

**Foundation implication:** distinguish cancellation requested, publication prohibited,
and execution/resources drained. Existing worker ownership and dependency admission
should remain the shared mechanism. A cancelled preparation must not release its
reservation while an uninterruptible decoder still owns memory. Browser teardown
needs asynchronous completion/late-result disposal, not native blocking locks.

### Coalesced notifications are not durable commands

`AsyncUpdater::triggerAsyncUpdate` posts only when its atomic pending flag changes;
repeated triggers collapse into one callback. Its header warns that posting to the
system message queue may block a real-time thread even though the API is thread-safe.
[Source: AsyncUpdater.cpp](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_events/broadcasters/juce_AsyncUpdater.cpp#L74),
[threading warning](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_events/broadcasters/juce_AsyncUpdater.h#L72).

**Proposal:** use the existing invalidation owner to collapse latest-state meter or
inspector refreshes. Do not collapse transactions or simulation commands that must
retain every occurrence. Pending UI callbacks must check their owner generation
before applying results. No new per-frame event broadcast is justified.

### Bounded transport has explicit ownership limits

`AbstractFifo` owns index management, not payload storage. It exposes up to two
wrapped spans and supports one producer and one consumer. Maximum usable capacity
is one less than backing capacity; resizing is not thread-safe.
[Source: AbstractFifo.h](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_core/containers/juce_AbstractFifo.h#L39).

**Conditional proposal:** if custom audio processing later requires transport,
separate fixed payload storage, admission and cursor publication. Preserve bounded
capacity and explicit overflow behavior. Ordinary JavaScript properties do not
inherit C++ atomic semantics. A future AudioWorklet/shared-memory design requires
its own browser capability and deployment review; this study does not recommend
introducing one without a concrete need.

### Allocation separated from saturation policy

`Synthesiser::findFreeVoice` optionally delegates saturation to `findVoiceToSteal`.
The default considers compatibility, age, release state and protected pitch
extremes. The transferable boundary is policy injection, not those musical rules.
[Source: Synthesiser.cpp](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_audio_basics/synthesisers/juce_Synthesiser.cpp#L509).

**Foundation observation:** the output rejects at its global voice cap; the optional
mixer sorts queued requests by priority but does not preempt active voices.

**Conditional proposal:** a consumer could request protected, replaceable or expiring
voice policies while the platform retains hard allocation limits. Any preemption
must have defined continuity, ownership and completion semantics. Do not add an
unbounded virtual-voice queue or adopt musical heuristics as generic engine rules.

## Proposed first implementation slice and acceptance

Prepared cue ownership and continuous gain updates are the most concrete candidates.
Neither is implemented by this document. Before coding, record the API decision and
use a minimal diagnostic consumer of the existing audio service.

| Dimension | Required evidence |
|---|---|
| Quality floor | Preserve cue identity, duration, seeded variant and sample fidelity. Required feedback cannot disappear to improve a timing score. Pending/failed playback has an explicit observable outcome and an application-selected fallback. |
| Signal continuity | Offline rendered sample comparisons cover abrupt target changes, overlapping retargets, zero gain, mute/unmute and disposal. Bound discontinuity and final-target error with justified tolerances; do not assume a smooth parameter API guarantees a smooth entire signal. |
| Interaction latency | Compare cold and warm interaction timing on the same diagnostic workload. A prepared playback call performs no cue synthesis; preparation cost and any added lead time are reported separately. |
| Memory and work | Enforce pending-job, active-voice, retained-buffer and byte limits under concurrent requests, repeated cancellation, sample-rate changes and replacement. Reservations persist through actual decoder completion/cleanup. Report temporary copies rather than only cached payload size. |
| Lifecycle | Test owner loss before preparation, during preparation, after readiness and during a gain transition; no late playback, leaked buffer, duplicate completion or stale owner callback. |
| Maintainability | One audio output, one worker host, one existing invalidation path. No caller-managed sample cache or parallel timer loop. API docs distinguish preparation readiness, scheduling and audible completion. |
| Browser validation | Use muted isolated automation and offline signal inspection. Test suspended/unlocked audio contexts and relevant browser fallbacks. No automated test changes the user's system audio. |
| Regression | Existing audio, mixer, scene ownership and template gates remain green with unchanged budgets. Record measurements for the final implementation revision; these source observations are not performance results. |

Native callback locks, operating-system thread scheduling, C++ object destruction
and browser event-loop behavior are different execution models. Adopt the contracts
and verify them in the actual browser runtime; do not translate the native structure
mechanically or embed the framework solely to obtain these patterns.
