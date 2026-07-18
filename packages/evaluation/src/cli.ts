import { runEvaluation } from './index.js';

const results = await runEvaluation();
console.log(JSON.stringify(results, null, 2));

