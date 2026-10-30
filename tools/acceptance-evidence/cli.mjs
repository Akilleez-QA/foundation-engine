import {open} from 'node:fs/promises';
import {assessEvidence} from './report.mjs';

// Read at most one byte beyond the cap, including when a file grows after it is opened.
async function readJson(path) {
  const limit = 1 << 20;
  const file = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < bytes.length) {
      const {bytesRead} = await file.read(bytes, used, bytes.length - used, null);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    if (used > limit) throw Error('evidence JSON exceeds 1 MiB');
    return JSON.parse(bytes.subarray(0, used).toString('utf8'));
  } finally {
    await file.close();
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 2) throw Error('usage: node tools/acceptance-evidence/cli.mjs <contract.json> <report.json>');
  const result = assessEvidence(await readJson(args[0]), await readJson(args[1]));
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'passed' ? 0 : result.status === 'invalid' ? 2 : 1;
} catch (error) {
  console.error(JSON.stringify({status: 'invalid', reason: String(error.message)}));
  process.exitCode = 2;
}
