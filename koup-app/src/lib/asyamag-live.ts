import { supabase, MagazinePost } from './supabase';

const CAT_MAP: Record<number, string> = {
  2419: 'Dedikodu',
  9: 'Kore',
  20: 'Dizi',
  10: 'Çin',
  6: 'BL GL',
  2249: 'Japonya',
  2224: 'Tayland',
  19: 'K-Pop',
  11: 'Film',
  1: 'Genel',
};

function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function transformWpPost(p: any): MagazinePost {
  const wpId = Number(p.id || 0);
  const slug = String(p.slug || `post-${wpId}`);
  const title = decodeHtmlEntities(p?.title?.rendered || '');
  const excerpt = decodeHtmlEntities(p?.excerpt?.rendered || '');
  const contentHtml = String(p?.content?.rendered || '');

  const rawCats: number[] = Array.isArray(p?.categories) ? p.categories : [];
  const categories = Array.from(
    new Set(rawCats.map((cid) => CAT_MAP[cid] || 'Magazin'))
  );
  if (categories.length === 0) categories.push('Magazin');

  const isGossip =
    categories.includes('Dedikodu') ||
    title.toLowerCase().includes('dedikodu') ||
    title.toLowerCase().includes('skandal') ||
    title.toLowerCase().includes('sevgili');

  let featuredImage: string | null = null;
  const emb = p?._embedded || {};
  if (
    Array.isArray(emb['wp:featuredmedia']) &&
    emb['wp:featuredmedia'][0]?.source_url
  ) {
    featuredImage = emb['wp:featuredmedia'][0].source_url;
  }

  let authorName = 'AsyaMag Editör';
  if (Array.isArray(emb.author) && emb.author[0]?.name) {
    authorName = emb.author[0].name;
  }

  const publishedAt = p?.date_gmt
    ? `${p.date_gmt}Z`
    : p?.date
      ? `${p.date}Z`
      : new Date().toISOString();

  return {
    id: wpId,
    wp_post_id: wpId,
    slug,
    title,
    excerpt,
    content_html: contentHtml,
    featured_image: featuredImage,
    author_name: authorName,
    categories,
    tags: [],
    is_gossip: isGossip,
    source_url: p?.link || `https://asyamag.com/${slug}/`,
    published_at: publishedAt,
    views_count: 0,
    likes_count: 0,
    comments_count: 0,
    related_media_ids: [],
    related_person_ids: [],
  };
}

/**
 * AsyaMag Resmi WordPress REST API'den canlı haber/dedikodu listesini çeker,
 * hata durumunda veya ek zenginleştirme için Supabase magazine_posts ile birleştirir.
 */
export async function fetchLiveAsyaMagPosts(
  perPage = 20,
  forceFresh = false
): Promise<{ posts: MagazinePost[]; source: 'live_api' | 'supabase_cache' }> {
  try {
    const res = await fetch(
      `https://asyamag.com/wp-json/wp/v2/posts?_embed=true&per_page=${perPage}&page=1`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        ...(forceFresh
          ? { cache: 'no-store' as const }
          : { next: { revalidate: 180 } }),
      }
    );

    if (res.ok) {
      const wpPosts = await res.json();
      if (Array.isArray(wpPosts) && wpPosts.length > 0) {
        const livePosts = wpPosts.map(transformWpPost);

        // Mevcut veritabanı eşleşmelerini (related_media_ids / related_person_ids) koru
        const slugs = livePosts.map((lp) => lp.slug);
        const { data: dbRows } = await supabase
          .from('magazine_posts')
          .select('id, slug, related_media_ids, related_person_ids, views_count')
          .in('slug', slugs);

        const dbMap = new Map((dbRows || []).map((r) => [r.slug, r]));
        const merged = livePosts.map((lp) => {
          const existing = dbMap.get(lp.slug);
          if (existing) {
            return {
              ...lp,
              id: existing.id,
              related_media_ids: existing.related_media_ids || [],
              related_person_ids: existing.related_person_ids || [],
              views_count: existing.views_count || lp.views_count,
            };
          }
          return lp;
        });

        return { posts: merged, source: 'live_api' };
      }
    }
  } catch {
    // Live API geçici olarak yanıt vermezse Supabase önbelleğine düş
  }

  const { data: fallback } = await supabase
    .from('magazine_posts')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(perPage);

  return {
    posts: (fallback || []) as MagazinePost[],
    source: 'supabase_cache',
  };
}

/**
 * Tekil bir makaleyi slug üzerinden önce canlı AsyaMag API veya Supabase'den getirir.
 */
export async function fetchLiveAsyaMagPostBySlug(
  slug: string
): Promise<MagazinePost | null> {
  const { data: dbPost } = await supabase
    .from('magazine_posts')
    .select('*')
    .eq('slug', slug)
    .single();

  if (dbPost && dbPost.content_html) {
    return dbPost as MagazinePost;
  }

  try {
    const res = await fetch(
      `https://asyamag.com/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_embed=true`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        next: { revalidate: 180 },
      }
    );
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length > 0) {
        return transformWpPost(arr[0]);
      }
    }
  } catch {
    // ignore
  }

  return (dbPost as MagazinePost) || null;
}
