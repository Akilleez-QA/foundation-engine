# L3 `features/`: engine-level features

A folder here is an engine-level feature shared by every game built from this checkout (a debug overlay, a settings screen, a content pack's behaviour). A game's own content lives in its game folder, written with `@engine`. Each folder has exactly one eager manifest, `index.ts`, that exports its module and its rows; everything else loads lazily (ADR 0036). A feature never imports another feature (`feature-isolation`); features meet through services, events and registry ids. The composition root discovers these folders; there is no hand-kept list.
