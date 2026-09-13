import { readFile, writeFile } from 'node:fs/promises';
import { buildInventory } from './lib/inventory.mjs';
import { assembleTranscript, planBatch } from './lib/transcript.mjs';
import { compileSalesKnowledge, retrieveSalesFacts } from './lib/knowledge.mjs';
import { evaluateReply } from './lib/dialogue-policy.mjs';
import { buildClientContext } from './lib/client-context.mjs';
import { planTranscriptions } from './plan-transcriptions.mjs';

try {
  const [command, input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 5) throw new Error('usage');
  const data = JSON.parse(await readFile(input, 'utf8'));
  let result;
  switch (command) {
    case 'inventory': {
      const inventory = buildInventory(data);
      result = { inventory, plan: planTranscriptions(inventory) }; break;
    }
    case 'assemble': result = assembleTranscript(data); break;
    case 'batch': result = planBatch(data.plan, data.ledger, data.limits); break;
    case 'compile': result = compileSalesKnowledge(data.corpus, data.now); break;
    case 'retrieve': result = retrieveSalesFacts(data.packet, data.request); break;
    case 'policy': result = evaluateReply(data); break;
    case 'context': result = buildClientContext(data.context, data.now); break;
    default: throw new Error('unsupported_command');
  }
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const blocked = result.plan?.status === 'blocked' || result.allowed === false || result.rejected?.length > 0;
  console.log(JSON.stringify({ command, output_created: true, requires_review: Boolean(blocked) }));
  if (blocked) process.exitCode = 2;
} catch {
  // Never print raw input, transcript fragments, URLs, identifiers, or filesystem paths.
  console.error('Offline operation failed. Check the documented contract and use a new output file.');
  process.exitCode = 1;
}
