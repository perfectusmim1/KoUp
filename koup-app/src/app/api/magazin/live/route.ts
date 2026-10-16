import { NextRequest, NextResponse } from 'next/server';
import { fetchLiveAsyaMagPosts } from '@/lib/asyamag-live';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit') || 28), 50);
  const fresh = searchParams.get('fresh') === '1';

  const { posts, source } = await fetchLiveAsyaMagPosts(limit, fresh);

  return NextResponse.json(
    {
      source,
      fetchedAt: new Date().toISOString(),
      total: posts.length,
      posts,
    },
    {
      headers: {
        'Cache-Control': fresh
          ? 'no-store'
          : 'public, max-age=120, stale-while-revalidate=300',
      },
    }
  );
}
