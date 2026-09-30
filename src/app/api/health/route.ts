import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      commit: process.env.COMMIT_REF || null,
      branch: process.env.BRANCH || null,
      deployId: process.env.DEPLOY_ID || null,
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
