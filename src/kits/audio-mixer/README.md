# Audio mixer

Optional `audioMixer()` kit, `createCueMixer()` scheduler and `createDucking()` gain policy. No systems are installed automatically. The mixer borrows the existing platform `AudioOutput`; it adds no audio context, frame loop or audio element.

`createCueMixer({ output: ctx, maxLogical: 8, maxAudible: 3 })` works directly in a game scene through `ctx.playVoice`; scene exit stops its voice handles. `testScene` records requested cues and stays silent.

`createCueMixer({ output, maxLogical, maxAudible })` admits bounded pending events. Call `request({ cue, priority, expiresAt }, now)` and `pump(now)` from the existing scene update or event boundary; timestamps are monotonic seconds. Null admission means full, expired or disposed. Higher priority starts first; ties are FIFO. Waiting events expire; failed output playback (silent, muted, locked or unknown cue) is dropped. `cancel(id)` removes a pending event or stops its playing voice.

The logical cap bounds pending plus playing records. The audible cap independently bounds voices dispatched **through this mixer**. A real `AudioBufferSourceNode.onended` notification retires a slot, so suspended audio does not falsely free slots based on wall time. Other callers of the shared output are outside this bound. Disposal stops only this mixer's voices and rejects new work; it never closes the borrowed output. The caller owns shared mute, hidden and unlock lifecycle.

Admission remains held while a borrowed output starts a voice. Reentrant pumping
does no additional dispatch; cancellation or disposal during playback retires the
returned voice instead of publishing it. A throwing playback call releases its
request and preserves the error. Disposal attempts every owned voice and duck
cleanup before reporting collected failures as an `AggregateError`.

`mixer.duck(factor, signal?)` returns an idempotent release. The strongest active owner wins. Gain affects both already playing and future mixer voices through their actual gain nodes, multiplied by the user's effects-volume master gain. It does not overwrite user settings or affect unrelated output callers or the music element. Abort releases its owner's request; disposal cleans up all requests. `createDucking(onChange)` exposes the same pure gain policy for other adapters.

Platform `AudioOutput.playVoice(id, { variant?, gain?, onEnded? })` returns a `CueVoice` with `ended`, `setGain()` and `stop()`, or null when skipped. Existing `play()` remains compatible. Natural completion and explicit stop both clean up connected nodes and notify once.

Costs: O(maxLogical log maxLogical) per pump, O(maxLogical) retained records; O(active duck leases) gain recomputation, one gain node per playing cue. No draws or triangles. No spatial attenuation, room occlusion, streaming music, fades or new audio backend is claimed.
