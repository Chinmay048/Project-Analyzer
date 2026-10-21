import { cleanSolveRequest } from '../api';
import type { SolveRequest } from '../types/cpm';

export function testCleanSolveRequest() {
  const req: SolveRequest = {
    title: 'Test Clean',
    mode: 'predecessors',
    activities: [
      { name: 'A', predecessors: '', duration: 5 },
      { name: 'B', predecessors: 'A', duration: 6 },
    ],
    round_te: true,
    variance_policy: 'max',
    target_time: null,
    target_delta: -4,
  };

  const cleaned = cleanSolveRequest(req);
  console.assert(cleaned.round_te === true, 'round_te should be true');
  console.assert(cleaned.target_delta === -4, 'target_delta should be -4');
  console.assert(cleaned.target_time === undefined, 'target_time should be undefined / omitted');
  const preds = cleaned.activities[0]?.predecessors;
  console.assert(Array.isArray(preds) && preds.length === 0, 'empty predecessor string cleaned to empty array');
  console.log('cleanSolveRequest tests passed successfully.');
}
