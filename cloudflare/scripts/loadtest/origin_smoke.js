import http from 'k6/http';
import { check } from 'k6';

// Smoke test: verify the origin-direct lane works with k6 `hosts`
// override (DNS → origin IP, SNI/Host preserved → cert validates).

const ORIGIN = '169.58.249.26';

export const options = {
  hosts: { 'datxevui.com:443': `${ORIGIN}:443` },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const headers = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip, deflate, br',
};

export default function () {
  const res = http.get('https://datxevui.com/health', { headers, tags: { name: 'origin /health' } });
  check(res, {
    'status 200': (r) => r.status === 200,
    'cert OK (no TLS error)': (r) => r.error === null || r.error === undefined,
  });
}
