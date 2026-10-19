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

  // Enrich with cached atomic likes_count & comments_count from Supabase
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data: dbPost } = await supabase
      .from('magazine_posts')
      .select('likes_count, comments_count')
      .eq('id', post.id)
      .maybeSingle();

    if (dbPost) {
      post.likes_count = dbPost.likes_count ?? post.likes_count ?? 0;
      post.comments_count = dbPost.comments_count ?? post.comments_count ?? 0;
    } else {
      const { count } = await supabase
        .from('magazine_likes')
        .select('*', { count: 'exact', head: true })
        .eq('post_id', post.id);

      post.likes_count = count ?? post.likes_count ?? 0;

      // Auto-seed to magazine_posts so database trigger maintains likes_count atomically
      void supabase
        .from('magazine_posts')
        .upsert(
          {
            id: post.id,
            slug: post.slug,
            title: post.title,
            excerpt: post.excerpt,
            content_html: post.content_html,
            featured_image: post.featured_image,
            categories: post.categories,
            tags: post.tags,
            source_url: post.source_url,
            likes_count: post.likes_count,
            comments_count: post.comments_count || 0,
            published_at: post.published_at,
          },
          { onConflict: 'id' }
        )
        .then(() => {});
    }
  } catch {
    // Non-blocking error handling
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
