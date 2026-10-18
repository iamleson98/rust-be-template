import http from 'k6/http';
import { Counter } from 'k6/metrics';

// Identify the failure mode through Cloudflare at high concurrency:
// 429 (origin governor keyed on CF edge IP) vs 403/503 (CF challenge).

const c200 = new Counter('status_200');
const c429 = new Counter('status_429');
const c403 = new Counter('status_403');
const c5xx = new Counter('status_5xx');
const cOther = new Counter('status_other');

let dumped = false;

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  vus: 400,
  duration: '40s',
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
  });

  if (res.status === 200) c200.add(1);
  else if (res.status === 429) c429.add(1);
  else if (res.status === 403) c403.add(1);
  else if (res.status >= 500) c5xx.add(1);
  else cOther.add(1);

  if (res.status !== 200 && !dumped) {
    dumped = true;
    console.log(
      `FAILING STATUS ${res.status} — server:${JSON.stringify(res.headers['Server'])} body:${(res.body || '').slice(0, 120)}`
    );
  }
}
