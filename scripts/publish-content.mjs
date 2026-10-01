#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {publishContent} from './lib/content-bundle.mjs';
const [source,destination]=process.argv.slice(2);
if(!source||!destination){console.error('Usage: npm run content:publish -- description.json output-directory');process.exitCode=1;}
else{try{const file=resolve(source),description=JSON.parse(readFileSync(file,'utf8'));const result=publishContent(resolve(destination),description,{readSource:path=>readFileSync(resolve(dirname(file),path))});console.log(`content: published ${result.id} (${result.artifacts} artifacts, ${result.bytes} bytes)`);}catch(error){console.error(`content: failed: ${error.message}`);process.exitCode=1;}}
