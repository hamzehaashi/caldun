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

      const retryable = response.status === 403 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === RETRY_DELAYS_MS.length) break;
    } catch (error) {
      if (attempt === RETRY_DELAYS_MS.length) {
        const message = error instanceof Error ? error.message : 'SEC request failed.';
        return new Response(JSON.stringify({ error: `SEC upstream request failed: ${message}` }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
    } finally {
      clearTimeout(timeout);
    }

    const jitter = Math.floor(Math.random() * 250);
    await sleep(RETRY_DELAYS_MS[attempt] + jitter);
  }

  const rateLimited =
    lastStatus === 403 ||
    lastStatus === 429 ||
    lastBody.includes('Request Rate Threshold Exceeded') ||
    lastBody.includes('Undeclared Automated Tool');

  return new Response(
    JSON.stringify({
      error: rateLimited
        ? 'SEC temporarily rejected the edge request.'
        : `SEC upstream returned ${lastStatus}.`,
    }),
    {
      status: rateLimited ? 503 : 502,
      headers: {
        'content-type': 'application/json',
        ...(rateLimited ? { 'retry-after': '60' } : {}),
      },
    },
  );
}

export default async (request: Request) => {
  const url = new URL(request.url);
  const upstream = upstreamFor(url.searchParams.get('resource'), url.searchParams.get('cik'));

  if (!upstream) {
    return new Response(JSON.stringify({ error: 'Invalid SEC bridge request.' }), {
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
