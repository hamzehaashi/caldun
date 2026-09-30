declare const Netlify: {
  env: { get(name: string): string | undefined };
};

const SEC_WEB_BASE = 'https://www.sec.gov';
const SEC_DATA_BASE = 'https://data.sec.gov';
const RETRY_DELAYS_MS = [750, 1_500, 3_000];
const REQUEST_TIMEOUT_MS = 12_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function secHeaders(): HeadersInit {
  const userAgent = Netlify.env.get('SEC_USER_AGENT')?.trim();
  if (!userAgent) {
    throw new Error('SEC_USER_AGENT is not configured for the Netlify edge runtime.');
  }

  return {
    'User-Agent': userAgent,
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };
}

function upstreamFor(resource: string | null, cik: string | null) {
  if (resource === 'tickers') {
    return {
      url: `${SEC_WEB_BASE}/files/company_tickers.json`,
      cacheControl: 'public, s-maxage=604800, stale-while-revalidate=2592000',
    };
  }

  if (resource === 'companyfacts') {
    if (!cik || !/^\d{10}$/.test(cik)) return null;
    return {
      url: `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`,
      cacheControl: 'public, s-maxage=21600, stale-while-revalidate=86400',
    };
  }

  return null;
}

async function fetchSec(url: string): Promise<Response> {
  let lastStatus = 502;
  let lastBody = '';

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: secHeaders(),
        signal: controller.signal,
      });

      if (response.ok) return response;

      lastStatus = response.status;
      lastBody = await response.text().catch(() => '');

      const undeclaredBot = lastBody.includes('Undeclared Automated Tool');
      const rateLimited =
        response.status === 429 || lastBody.includes('Request Rate Threshold Exceeded');
      const retryable = rateLimited || response.status >= 500;

      // Retrying an identity/policy block only adds traffic and cannot repair it.
      if (undeclaredBot || response.status === 403 || !retryable || attempt === RETRY_DELAYS_MS.length) {
        break;
      }
    } catch (error) {
      if (attempt === RETRY_DELAYS_MS.length) {
        const message = error instanceof Error ? error.message : 'SEC request failed.';
        return new Response(
          JSON.stringify({ code: 'SEC_NETWORK_ERROR', error: `SEC upstream request failed: ${message}` }),
          {
            status: 502,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    const jitter = Math.floor(Math.random() * 250);
    await sleep(RETRY_DELAYS_MS[attempt] + jitter);
  }

  const undeclaredBot = lastBody.includes('Undeclared Automated Tool');
  const rateLimited =
    lastStatus === 429 || lastBody.includes('Request Rate Threshold Exceeded');

  let code = 'SEC_UPSTREAM_ERROR';
  let error = `SEC upstream returned ${lastStatus}.`;
  let status = 502;

  if (undeclaredBot) {
    code = 'SEC_AUTOMATION_BLOCKED';
    error = 'SEC rejected Caldun as an undeclared automated client.';
  } else if (rateLimited) {
    code = 'SEC_RATE_LIMIT';
    error = 'SEC rate-limited Caldun’s edge request.';
    status = 503;
  } else if (lastStatus === 403) {
    code = 'SEC_FORBIDDEN';
    error = 'SEC denied Caldun’s hosting-network request.';
  }

  return new Response(JSON.stringify({ code, error, upstreamStatus: lastStatus }), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(status === 503 ? { 'retry-after': '60' } : {}),
    },
  });
}

export default async (request: Request) => {
  const url = new URL(request.url);
  const upstream = upstreamFor(url.searchParams.get('resource'), url.searchParams.get('cik'));

  if (!upstream) {
    return new Response(JSON.stringify({ code: 'INVALID_REQUEST', error: 'Invalid SEC bridge request.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const response = await fetchSec(upstream.url);
  const body = await response.text();

  return new Response(body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json',
      ...(response.ok ? { 'cache-control': upstream.cacheControl } : {}),
      ...(response.headers.get('retry-after')
        ? { 'retry-after': response.headers.get('retry-after') as string }
        : {}),
    },
  });
};

export const config = {
  path: '/api/sec-bridge',
  method: 'GET',
  cache: 'manual' as const,
};
