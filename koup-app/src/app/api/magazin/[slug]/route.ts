import { NextRequest, NextResponse } from 'next/server';
import { fetchLiveAsyaMagPostBySlug } from '@/lib/asyamag-live';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const decoded = decodeURIComponent(slug || '');
  if (!decoded) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
  }

  const post = await fetchLiveAsyaMagPostBySlug(decoded);
  if (!post) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(
    { post },
    {
      headers: {
        'Cache-Control': 'public, max-age=120, stale-while-revalidate=300',
      },
    }
  );
}
