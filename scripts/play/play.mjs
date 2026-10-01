#!/usr/bin/env node
// scripts/play/play.mjs (`npm run play`): the dev server with the test API, for playing the game yourself.
import {serve, homeScene} from './lib.mjs';

const {url} = await serve({port: Number(process.env.PORT ?? 5173)});
console.log(`\n  Play: ${url}/#scene/${homeScene()}\n  Sound: press M to mute; test browsers are always muted.\n  Stop: Ctrl+C\n`);
