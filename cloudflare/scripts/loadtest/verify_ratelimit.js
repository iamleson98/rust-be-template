import http from 'k6/http';
import { Counter } from 'k6/metrics';

// Verify the exact rejection mechanism under sustained direct-origin
// API load: counts status codes, dumps the first failing response.

const ORIGIN = '169.58.249.26';

const c200 = new Counter('status_200');
const c429 = new Counter('status_429');
const c5xx = new Counter('status_5xx');
const cOther = new Counter('status_other');

let dumped = false;

export const options = {
  hosts: { 'datxevui.com:443': `${ORIGIN}:443` },
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  vus: 100,
  duration: '60s',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export default function () {
  const res = http.get('https://datxevui.com/api/brands?limit=1', {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    tags: { name: 'api /brands' },
  });

  if (res.status === 200) {
    c200.add(1);
  } else if (res.status === 429) {
    c429.add(1);
    if (!dumped) {
      dumped = true;
      console.log(
        `FIRST 429 — headers: ${JSON.stringify(res.headers)} body: ${res.body}`
      );
    }
  } else if (res.status >= 500) {
    c5xx.add(1);
    if (!dumped) {
      dumped = true;
      console.log(
        `FIRST ${res.status} — headers: ${JSON.stringify(res.headers)} body: ${res.body}`
      );
    }
  } else {
    cOther.add(1);
    if (!dumped) {
      dumped = true;
      console.log(
        `FIRST ${res.status} — headers: ${JSON.stringify(res.headers)} body: ${res.body}`
      );
    }
  }
}
