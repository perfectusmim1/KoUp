import { NextRequest, NextResponse } from 'next/server';
import { supabase, MagazinePost } from '@/lib/supabase';
import { transformWpPost } from '@/lib/asyamag-live';

export const revalidate = 300;

function normalizeTurkish(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name');
    const personId = searchParams.get('id');
    const slug = searchParams.get('slug');

    if (!name || name.trim().length < 2) {
      return NextResponse.json({ posts: [], total: 0 });
    }

    const cleanName = name.trim();
    const cleanId = personId ? Number(personId) : null;
    const normName = normalizeTurkish(cleanName);

    // Slug derived tag guess (e.g. "yoo-in-na-89" -> "yoo-in-na")
    const cleanSlug = (slug || '')
      .replace(/-\d+$/, '')
      .toLowerCase()
      .trim();

    const mergedPosts: MagazinePost[] = [];
    const seenSlugs = new Set<string>();

    // 1. Search local Supabase magazine_posts
    try {
      let q = supabase
        .from('magazine_posts')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(8);

      if (cleanId) {
        q = q.or(`related_person_ids.cs.{${cleanId}},title.ilike.%${cleanName}%,tags.cs.{${cleanName}}`);
      } else {
        q = q.or(`title.ilike.%${cleanName}%,tags.cs.{${cleanName}}`);
      }

      const { data: dbPosts } = await q;
      if (Array.isArray(dbPosts)) {
        for (const p of dbPosts) {
          if (!seenSlugs.has(p.slug)) {
            seenSlugs.add(p.slug);
            mergedPosts.push(p as MagazinePost);
          }
        }
      }
    } catch (err) {
      console.warn('Local magazine DB error:', err);
    }

    // 2. Query live AsyaMag by Exact Actor TAG (e.g. tag/yoo-in-na, tag/song-hye-kyo)
    try {
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };

      // Search matching tags on AsyaMag
      const tagQueries = Array.from(new Set([cleanName, cleanSlug].filter(Boolean)));
      const matchingTagIds = new Set<number>();

      for (const tq of tagQueries) {
        try {
          const tagUrl = `https://asyamag.com/wp-json/wp/v2/tags?search=${encodeURIComponent(tq)}&per_page=5`;
          const tagRes = await fetch(tagUrl, { headers, signal: AbortSignal.timeout(4000) });
          if (tagRes.ok) {
            const tags = await tagRes.json();
            if (Array.isArray(tags)) {
              for (const t of tags) {
                const normTagName = normalizeTurkish(t.name);
                const normTagSlug = (t.slug || '').toLowerCase();
                // Match if tag name or slug equals or contains the actor name
                if (
                  normTagName === normName ||
                  normTagSlug === cleanSlug ||
                  normTagName.includes(normName) ||
                  normName.includes(normTagName)
                ) {
                  matchingTagIds.add(t.id);
                }
              }
            }
          }
        } catch {}
      }

      // Fetch posts associated with matching tags
      if (matchingTagIds.size > 0) {
        const tagParam = Array.from(matchingTagIds).join(',');
        const tagPostsUrl = `https://asyamag.com/wp-json/wp/v2/posts?_embed=1&tags=${tagParam}&per_page=6`;
        const tagPostsRes = await fetch(tagPostsUrl, { headers, signal: AbortSignal.timeout(5000) });
        if (tagPostsRes.ok) {
          const wpRaw = await tagPostsRes.json();
          if (Array.isArray(wpRaw)) {
            for (const raw of wpRaw) {
              const transformed = transformWpPost(raw);
              if (!seenSlugs.has(transformed.slug)) {
                seenSlugs.add(transformed.slug);
                mergedPosts.push(transformed);
              }
            }
          }
        }
      }

      // 3. Fallback: Query search endpoint ONLY if no tag posts found, AND STRICTLY verify the actor's name appears in post title or content
      if (mergedPosts.length === 0) {
        const searchUrl = `https://asyamag.com/wp-json/wp/v2/posts?_embed=1&search=${encodeURIComponent(cleanName)}&per_page=8`;
        const searchRes = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(5000) });
        if (searchRes.ok) {
          const wpRaw = await searchRes.json();
          if (Array.isArray(wpRaw)) {
            for (const raw of wpRaw) {
              const rawTitle = raw?.title?.rendered || '';
              const rawContent = raw?.content?.rendered || '';
              const normTitle = normalizeTurkish(rawTitle);
              const normContent = normalizeTurkish(rawContent);

              // STRICT verification: actor name must actually appear in the article title or content!
              if (normTitle.includes(normName) || normContent.includes(normName)) {
                const transformed = transformWpPost(raw);
                if (!seenSlugs.has(transformed.slug)) {
                  seenSlugs.add(transformed.slug);
                  mergedPosts.push(transformed);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('AsyaMag live fetch error:', err);
    }

    return NextResponse.json({
      posts: mergedPosts.slice(0, 8),
      total: mergedPosts.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, posts: [] }, { status: 500 });
  }
}
