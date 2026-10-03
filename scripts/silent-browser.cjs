// scripts/silent-browser.cjs: preload for browser-automation tools started from this repository
// (`node -r ./scripts/silent-browser.cjs <tool>`). Test browsers must never play through the user's speakers: this adds
// `--mute-audio` to AGENT_BROWSER_ARGS. The game's own audio graph stays active (pages also get `?flags=dev.silent`
// from the harness), so audio lifecycle assertions remain meaningful. System and application audio are never changed.
const args = process.env.AGENT_BROWSER_ARGS || '';
process.env.AGENT_BROWSER_ARGS = args.includes('--mute-audio') ? args : [args, '--mute-audio'].filter(Boolean).join(',');
// Browser checks start their own Vite servers and never edit files while they run: no file watcher (vite.config.ts reads
// ENGINE_WATCH), so a check does not use up the machine's inotify watches. Set ENGINE_WATCH=1 to keep watching.
process.env.ENGINE_WATCH ??= '0';
