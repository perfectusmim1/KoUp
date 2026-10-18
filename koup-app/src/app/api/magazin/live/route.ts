import { NextRequest, NextResponse } from 'next/server';
import { fetchLiveAsyaMagPosts } from '@/lib/asyamag-live';
import { fetchLiveKoreZinPosts } from '@/lib/korezin-live';
import { MagazinePost } from '@/lib/supabase';

export const revalidate = 120;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit') || 36), 60);
  const fresh = searchParams.get('fresh') === '1';
  const sourceFilter = (searchParams.get('source') || 'all').toLowerCase();

  // Her iki kaynaktan paralel olarak çek
  const shouldFetchAsya = sourceFilter === 'all' || sourceFilter === 'asyamag';
  const shouldFetchKoreZin = sourceFilter === 'all' || sourceFilter === 'korezin';

  const [asyaResult, kzResult] = await Promise.allSettled([
    shouldFetchAsya ? fetchLiveAsyaMagPosts(limit, fresh) : Promise.resolve({ posts: [] as MagazinePost[], source: 'disabled' }),
    shouldFetchKoreZin ? fetchLiveKoreZinPosts(limit, fresh) : Promise.resolve({ posts: [] as MagazinePost[], source: 'disabled' }),
  ]);

  const asyaPosts: MagazinePost[] =
    asyaResult.status === 'fulfilled' ? asyaResult.value.posts : [];
  const kzPosts: MagazinePost[] =
    kzResult.status === 'fulfilled' ? kzResult.value.posts : [];

  // Mükerrer başlık ve slug kontrolü ile birleştir
  const seenSlugs = new Set<string>();
  const seenTitles = new Set<string>();
  const combined: MagazinePost[] = [];

  for (const post of [...asyaPosts, ...kzPosts]) {
    if (!post?.slug || seenSlugs.has(post.slug)) continue;
    const normTitle = (post.title || '').trim().toLowerCase();
    if (normTitle && seenTitles.has(normTitle)) continue;

    seenSlugs.add(post.slug);
    if (normTitle) seenTitles.add(normTitle);
    combined.push(post);
  }

  // En yeni tarihten eskiye sırala
  combined.sort(
    (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  );

  const finalPosts = combined.slice(0, limit);

  return NextResponse.json(
    {
      source: 'combined_live',
      fetchedAt: new Date().toISOString(),
      counts: {
        total: finalPosts.length,
        asyamag: asyaPosts.length,
        korezin: kzPosts.length,
      },
      posts: finalPosts,
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
