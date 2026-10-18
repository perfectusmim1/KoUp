import { supabase, MagazinePost } from './supabase';

interface InMemoryCache {
  posts: MagazinePost[];
  timestamp: number;
}

let koreZinCache: InMemoryCache | null = null;
const CACHE_TTL_MS = 180_000; // 3 dakika

function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
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
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function stripHtml(str: string): string {
  if (!str) return '';
  return decodeHtmlEntities(str)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanArticleHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  return rawHtml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    // WordPress RSS boilerplate
    .replace(/<p>The post\s+<a[^>]*>.*?<\/a>\s+appeared first on\s+<a[^>]*>KoreZin<\/a>\.?<\/p>/gi, '')
    .replace(/The post\s+\[.*?\]\s+appeared first on\s+\[KoreZin\].*?\./gi, '')
    // Ads and analytics scripts
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<ins[\s\S]*?<\/ins>/gi, '')
    .replace(/\(adsbygoogle\s*=\s*window\.adsbygoogle\s*\|\|\s*\[\]\)\.push\(\{.*?\}\);?/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

function mapKoreZinCategories(rawCats: string[]): string[] {
  const cats = new Set<string>();

  for (const rc of rawCats) {
    const lower = rc.toLowerCase();
    if (lower.includes('k-pop') || lower.includes('konser') || lower.includes('mv')) {
      cats.add('K-Pop');
      cats.add('Müzik');
    }
    if (lower.includes('k-drama') || lower.includes('dizi') || lower.includes('reyting')) {
      cats.add('Dizi');
      cats.add('Kore');
    }
    if (lower.includes('film') || lower.includes('movie') || lower.includes('kmovie')) {
      cats.add('Film');
      cats.add('Kore');
    }
    if (lower.includes('dedikodu') || lower.includes('netizen') || lower.includes('söz sende')) {
      cats.add('Dedikodu');
    }
    if (lower.includes('magazin') || lower.includes('ana haber')) {
      cats.add('Magazin');
      cats.add('Kore');
    }
  }

  if (cats.size === 0) {
    cats.add('K-Pop');
    cats.add('Magazin');
    cats.add('Kore');
  }

  return Array.from(cats);
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function parseItemTag(xml: string, tag: string): string {
  const match = xml.match(
    new RegExp(`<${tag}[^>]*>(?:<\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, 'i')
  );
  if (!match) return '';
  return (match[1] !== undefined ? match[1] : match[2] || '').trim();
}

function parseAllItemTags(xml: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(
    `<${tag}[^>]*>(?:<\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`,
    'gi'
  );
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const val = (match[1] !== undefined ? match[1] : match[2] || '').trim();
    if (val) results.push(val);
  }
  return results;
}

function extractImageFromXmlItem(itemXml: string): string | null {
  // 1. media:content
  const mediaMatch = itemXml.match(/<media:content[^>]+url=["']([^"']+)["']/i);
  if (mediaMatch?.[1]) return mediaMatch[1];

  // 2. media:thumbnail
  const thumbMatch = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (thumbMatch?.[1]) return thumbMatch[1];

  // 3. enclosure
  const encMatch = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
  if (encMatch?.[1]) return encMatch[1];

  // 4. img src from content:encoded or description
  const imgMatch = itemXml.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) return imgMatch[1];

  // 5. wp-content/uploads direct URL in XML
  const wpUploadMatch = itemXml.match(/https?:\/\/[^"'\s<>]+\/wp-content\/uploads\/[^"'\s<>]+/i);
  if (wpUploadMatch?.[0]) return wpUploadMatch[0];

  return null;
}

export function transformKoreZinItem(itemXml: string): MagazinePost {
  const rawTitle = parseItemTag(itemXml, 'title');
  const title = decodeHtmlEntities(rawTitle);

  const link = parseItemTag(itemXml, 'link');
  const guid = parseItemTag(itemXml, 'guid');
  const pubDate = parseItemTag(itemXml, 'pubDate');
  const creator = parseItemTag(itemXml, 'dc:creator');
  const rawCats = parseAllItemTags(itemXml, 'category');
  const rawContent = parseItemTag(itemXml, 'content:encoded') || parseItemTag(itemXml, 'description');
  const rawDescription = parseItemTag(itemXml, 'description');

  // Slug extraction from link
  let cleanSlug = '';
  try {
    const urlObj = new URL(link);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    cleanSlug = segments[segments.length - 1] || '';
  } catch {
    cleanSlug = link.replace(/\/+$/, '').split('/').pop() || '';
  }

  if (!cleanSlug) {
    cleanSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9ğüşıöç]+/g, '-')
      .replace(/^-+|-+$/g, '') || `post-${Date.now()}`;
  }

  const slug = `kz-${cleanSlug}`;

  // ID extraction
  let wpId = 0;
  const wpIdMatch = guid.match(/[?&]p=(\d+)/);
  if (wpIdMatch?.[1]) {
    wpId = parseInt(wpIdMatch[1], 10);
  } else {
    wpId = hashString(cleanSlug) % 1_000_000;
  }
  const postId = 800_000_000 + wpId;

  const categories = mapKoreZinCategories(rawCats);

  const isGossip =
    categories.includes('Dedikodu') ||
    rawCats.some((c) => /dedikodu|netizen|skandal/i.test(c)) ||
    title.toLowerCase().includes('dedikodu') ||
    title.toLowerCase().includes('skandal') ||
    title.toLowerCase().includes('sevgili') ||
    title.toLowerCase().includes('dava') ||
    title.toLowerCase().includes('itiraf');

  const featuredImage = extractImageFromXmlItem(itemXml);
  const contentHtml = cleanArticleHtml(rawContent);
  const excerpt = stripHtml(rawDescription || rawContent).slice(0, 220) + '...';

  let publishedAt = new Date().toISOString();
  if (pubDate) {
    const parsed = new Date(pubDate);
    if (!isNaN(parsed.getTime())) {
      publishedAt = parsed.toISOString();
    }
  }

  return {
    id: postId,
    wp_post_id: wpId,
    slug,
    title,
    excerpt,
    content_html: contentHtml,
    featured_image: featuredImage,
    author_name: creator ? `KoreZin / ${creator}` : 'KoreZin Editör',
    source_site: 'KoreZin',
    categories,
    tags: rawCats,
    is_gossip: isGossip,
    source_url: link || `https://www.korezin.com/?p=${wpId}`,
    published_at: publishedAt,
    views_count: 0,
    likes_count: 0,
    comments_count: 0,
    related_media_ids: [],
    related_person_ids: [],
  };
}

/**
 * KoreZin Resmi WordPress RSS 2.0 Akışından Canlı Haberleri Çeker.
 */
export async function fetchLiveKoreZinPosts(
  perPage = 20,
  forceFresh = false
): Promise<{ posts: MagazinePost[]; source: 'live_rss' | 'cache' }> {
  const now = Date.now();
  if (!forceFresh && koreZinCache && now - koreZinCache.timestamp < CACHE_TTL_MS) {
    return {
      posts: koreZinCache.posts.slice(0, perPage),
      source: 'cache',
    };
  }

  try {
    const res = await fetch('https://www.korezin.com/feed/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      ...(forceFresh
        ? { cache: 'no-store' as const }
        : { next: { revalidate: 180 } }),
    });

    if (res.ok) {
      const xml = await res.text();
      const rawItems = xml.split('<item>');
      const items = rawItems.slice(1).map((chunk) => {
        const itemEnd = chunk.indexOf('</item>');
        return itemEnd !== -1 ? chunk.substring(0, itemEnd) : chunk;
      });

      if (items.length > 0) {
        const livePosts = items.map(transformKoreZinItem);

        // Supabase ile birleştir (özel etiketlemeler ve izlenme sayıları)
        const slugs = livePosts.map((p) => p.slug);
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
              id: existing.id || lp.id,
              related_media_ids: existing.related_media_ids || [],
              related_person_ids: existing.related_person_ids || [],
              views_count: existing.views_count || lp.views_count,
            };
          }
          return lp;
        });

        koreZinCache = {
          posts: merged,
          timestamp: now,
        };

        return {
          posts: merged.slice(0, perPage),
          source: 'live_rss',
        };
      }
    }
  } catch (err) {
    console.error('KoreZin feed fetch error:', err);
  }

  if (koreZinCache?.posts?.length) {
    return {
      posts: koreZinCache.posts.slice(0, perPage),
      source: 'cache',
    };
  }

  return {
    posts: [],
    source: 'cache',
  };
}

/**
 * Tekil KoreZin makalesini slug üzerinden canlı feed veya doğrudan web sayfasından çeker.
 */
export async function fetchLiveKoreZinPostBySlug(slug: string): Promise<MagazinePost | null> {
  const normalizedSlug = slug.trim();
  const rawSlug = normalizedSlug.replace(/^kz-/, '');

  // 1. Önce aktif önbellekte var mı bak
  if (koreZinCache?.posts?.length) {
    const found = koreZinCache.posts.find(
      (p) => p.slug === normalizedSlug || p.slug === `kz-${rawSlug}`
    );
    if (found && found.content_html) return found;
  }

  // 2. Feed'i kontrol et
  const { posts } = await fetchLiveKoreZinPosts(35);
  const matched = posts.find(
    (p) => p.slug === normalizedSlug || p.slug === `kz-${rawSlug}`
  );
  if (matched && matched.content_html) return matched;

  // 3. Feed'de yoksa (eski haber), doğrudan WordPress ?name= web sayfasından çek
  try {
    const articleUrl = `https://www.korezin.com/?name=${encodeURIComponent(rawSlug)}`;
    const res = await fetch(articleUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      next: { revalidate: 300 },
    });

    if (res.ok) {
      const html = await res.text();

      // OpenGraph ve Meta verilerini ayıkla
      const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i)?.[1];
      const ogDesc = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i)?.[1];
      const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i)?.[1];
      const ogPublished = html.match(/<meta\s+property=["']article:published_time["']\s+content=["'](.*?)["']/i)?.[1];
      const ogAuthor = html.match(/<meta\s+name=["']author["']\s+content=["'](.*?)["']/i)?.[1];

      // Article HTML extraction (.entry-content)
      const contentMatch =
        html.match(/<div[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
        html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);

      let contentHtml = contentMatch?.[1] ? cleanArticleHtml(contentMatch[1]) : '';
      if (!contentHtml && ogDesc) {
        contentHtml = `<p class="text-base leading-relaxed text-white/90">${decodeHtmlEntities(ogDesc)}</p>`;
      }

      const title = decodeHtmlEntities(
        ogTitle ? ogTitle.replace(/\s*-\s*KoreZin$/i, '') : rawSlug.replace(/-/g, ' ')
      );

      const postId = 800_000_000 + (hashString(rawSlug) % 1_000_000);

      const post: MagazinePost = {
        id: postId,
        slug: `kz-${rawSlug}`,
        title,
        excerpt: decodeHtmlEntities(ogDesc || '').slice(0, 220),
        content_html: contentHtml,
        featured_image: ogImage || null,
        author_name: ogAuthor ? `KoreZin / ${ogAuthor}` : 'KoreZin Editör',
        source_site: 'KoreZin',
        categories: ['K-Pop', 'Magazin', 'Kore'],
        tags: [],
        is_gossip: title.toLowerCase().includes('dedikodu') || title.toLowerCase().includes('skandal'),
        source_url: `https://www.korezin.com/?name=${rawSlug}`,
        published_at: ogPublished ? new Date(ogPublished).toISOString() : new Date().toISOString(),
        views_count: 0,
        likes_count: 0,
        comments_count: 0,
        related_media_ids: [],
        related_person_ids: [],
      };

      return post;
    }
  } catch (err) {
    console.error('KoreZin single article fetch error:', err);
  }

  return null;
}
