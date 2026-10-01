# Space

`decorativeStars(seed, count)` supplies stable nested directional backgrounds (maximum 4,096). These are decorative, not a scientific catalog. Pass points to `defineEnvironment` and set `scene.view.environment`. Rendering owns one persistent point buffer per view, removes camera translation and retains ordinary geometry parallax. Background colors, illumination and haze are independently specified. Replace `ctx.view.environment` to publish a change; mutating the old object is unsupported.

`environmentTransition` shares one clamped transition parameter across background, light, haze and point colors, blending colors in linear light. Endpoints need identical point directions and compatible haze presence. Directional positions must not interpolate through zero. No texture reflections, cube textures, transparent nebulae, exposure model, atmosphere scattering or surface-to-orbit handoff is implied.

`horizon(radius, distance)` provides a finite geometric limb only outside the body; at/inside returns null for the caller's surface treatment. One authoritative body pose/radius must drive both far representation and physical terrain. This kit does not supply spherical terrain.
