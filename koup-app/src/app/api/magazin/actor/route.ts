import { NextRequest, NextResponse } from 'next/server';
import { supabase, MagazinePost } from '@/lib/supabase';
import { transformWpPost } from '@/lib/asyamag-live';
import { fetchLiveKoreZinPosts } from '@/lib/korezin-live';

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
    .replace(/[-_]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
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
    const personType = searchParams.get('type');

    // Derived clean slug (e.g. "char-gokuu-son-246" -> "char-gokuu-son")
    const cleanSlug = (slug || '')
      .replace(/-\d+$/, '')
      .toLowerCase()
      .trim();

    // Characters in anime/fiction should NEVER have celebrity gossip/magazin news
    if (personType === 'character' || cleanSlug.startsWith('char-')) {
      return NextResponse.json({ posts: [], total: 0 });
    }

    // Variations for hyphenated/spaced Korean romanized names (e.g. "Kim Soo-hyun", "Kim Soo Hyun", "kim-soo-hyun")
    const spaceName = cleanName.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    const hyphenName = spaceName.replace(/\s+/g, '-');

    const mergedPosts: MagazinePost[] = [];
    const seenSlugs = new Set<string>();

    // 1. Search local Supabase magazine_posts
    try {
      let q = supabase
        .from('magazine_posts')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(8);

      const conditions: string[] = [
        `title.ilike.%${cleanName}%`,
        `title.ilike.%${spaceName}%`,
        `tags.cs.{${cleanName}}`,
        `tags.cs.{${spaceName}}`,
      ];
      if (cleanId) {
        conditions.unshift(`related_person_ids.cs.{${cleanId}}`);
      }
      q = q.or(conditions.join(','));

      const { data: dbPosts } = await q;
      if (Array.isArray(dbPosts)) {
        for (const p of dbPosts) {
          if (!seenSlugs.has(p.slug)) {
            seenSlugs.add(p.slug);
            const isKz =
              (p.source_site || '').toLowerCase().includes('korezin') ||
              p.source_url?.includes('korezin.com') ||
              p.slug?.startsWith('kz-');
            mergedPosts.push({
              ...p,
              source_site: isKz ? 'KoreZin' : (p.source_site || 'AsyaMag'),
            } as MagazinePost);
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
      const tagQueries = Array.from(new Set([cleanName, spaceName, hyphenName, cleanSlug].filter(Boolean)));
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
                  (normTagName.length >= 3 && normName.length >= 3 && (normTagName.includes(normName) || normName.includes(normTagName)))
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

    // 4. Query live KoreZin RSS feed for matching actor news & gossip
    try {
      const { posts: kzPosts } = await fetchLiveKoreZinPosts(40);
      if (Array.isArray(kzPosts)) {
        for (const kp of kzPosts) {
          const normTitle = normalizeTurkish(kp.title || '');
          const normExcerpt = normalizeTurkish(kp.excerpt || '');
          const normContent = normalizeTurkish(kp.content_html || '');
          const hasTagMatch = (kp.tags || []).some((t) => {
            const nt = normalizeTurkish(t);
            if (!nt || nt.length < 2) return false;
            return (
              nt === normName ||
              (nt.length >= 3 && nt.includes(normName)) ||
              (normName.length >= 4 && nt.length >= 4 && normName.includes(nt))
            );
          });

          const isNameMatch =
            normName.length >= 3 &&
            (normTitle.includes(normName) ||
              normExcerpt.includes(normName) ||
              normContent.includes(normName));

          if (hasTagMatch || isNameMatch) {
            if (!seenSlugs.has(kp.slug)) {
              seenSlugs.add(kp.slug);
              mergedPosts.push(kp);
            }
          }
        }
      }
    } catch (err) {
      console.warn('KoreZin live actor search error:', err);
    }

    // Sort all merged posts by published date (newest first)
    mergedPosts.sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );

    return NextResponse.json({
      posts: mergedPosts.slice(0, 8),
      total: mergedPosts.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, posts: [] }, { status: 500 });
  }
}
