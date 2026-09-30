import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      commit: process.env.CALDUN_BUILD_COMMIT || null,
      branch: process.env.CALDUN_BUILD_BRANCH || null,
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
