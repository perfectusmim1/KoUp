import { NextRequest, NextResponse } from 'next/server';
import { fetchLiveAsyaMagPostBySlug } from '@/lib/asyamag-live';
import { fetchLiveKoreZinPostBySlug } from '@/lib/korezin-live';

export const revalidate = 120;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const decoded = decodeURIComponent(slug || '');
  if (!decoded) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
  }

  let post = null;

  // KoreZin slug kontrolü
  if (decoded.startsWith('kz-')) {
    post = await fetchLiveKoreZinPostBySlug(decoded);
  }

  // Bulunamazsa veya kz- ön eki yoksa AsyaMag dene
  if (!post) {
    post = await fetchLiveAsyaMagPostBySlug(decoded);
  }

  // Hâlâ bulunamadıysa KoreZin dene (ön eksiz slug eşleşmesi için)
  if (!post) {
    post = await fetchLiveKoreZinPostBySlug(decoded);
  }

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
