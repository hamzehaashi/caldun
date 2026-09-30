declare const Netlify: {
  env: { get(name: string): string | undefined };
};

const SEC_WEB_BASE = 'https://www.sec.gov';
const SEC_DATA_BASE = 'https://data.sec.gov';
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const REQUEST_TIMEOUT_MS = 15_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
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
  let retryAfterSeconds: number | null = null;

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
      retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));

      const undeclaredBot = lastBody.includes('Undeclared Automated Tool');
      const thresholdExceeded = lastBody.includes('Request Rate Threshold Exceeded');
      const transient =
        response.status === 429 ||
        response.status === 403 ||
        response.status >= 500 ||
        thresholdExceeded;

      if (undeclaredBot || !transient || attempt === RETRY_DELAYS_MS.length) {
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

    const baseDelay = retryAfterSeconds
      ? retryAfterSeconds * 1_000
      : RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    await sleep(baseDelay + Math.floor(Math.random() * 300));
  }

  const undeclaredBot = lastBody.includes('Undeclared Automated Tool');
  const thresholdExceeded = lastBody.includes('Request Rate Threshold Exceeded');

  let code = 'SEC_UPSTREAM_ERROR';
  let error = `SEC upstream returned ${lastStatus}.`;
  let status = 502;

  if (undeclaredBot) {
    code = 'SEC_AUTOMATION_BLOCKED';
    error = 'SEC rejected Caldun’s automated-client identity.';
  } else if (lastStatus === 429 || lastStatus === 403 || thresholdExceeded) {
    code = 'SEC_TEMPORARILY_UNAVAILABLE';
    error = 'SEC is temporarily limiting requests from Caldun’s edge network.';
    status = 503;
  }

  return new Response(JSON.stringify({ code, error, upstreamStatus: lastStatus }), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(status === 503 ? { 'retry-after': String(retryAfterSeconds ?? 60) } : {}),
    },
  });
}

export default async (request: Request) => {
  const expectedToken = Netlify.env.get('SEC_BRIDGE_TOKEN');
  const suppliedToken = request.headers.get('x-caldun-bridge-token');

  if (!expectedToken || !suppliedToken || suppliedToken !== expectedToken) {
    return new Response(JSON.stringify({ code: 'NOT_FOUND', error: 'Not found.' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

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
      ...(response.ok
        ? {
            'cache-control': upstream.cacheControl,
            'netlify-cdn-cache-control': `public, durable, ${upstream.cacheControl.replace('public, ', '')}`,
          }
        : {}),
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
