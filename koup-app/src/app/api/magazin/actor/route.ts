import { NextRequest, NextResponse } from 'next/server';
import { supabase, MagazinePost } from '@/lib/supabase';
import { transformWpPost } from '@/lib/asyamag-live';

export const revalidate = 300;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name');
    const personId = searchParams.get('id');

    if (!name || name.trim().length < 2) {
      return NextResponse.json({ posts: [], total: 0 });
    }

    const cleanName = name.trim();
    const cleanId = personId ? Number(personId) : null;

    const mergedPosts: MagazinePost[] = [];
    const seenSlugs = new Set<string>();

    // 1. Search local Supabase magazine_posts
    try {
      let q = supabase
        .from('magazine_posts')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(6);

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
    } catch {}

    // 2. Query live AsyaMag WordPress REST API for latest news/gossip
    try {
      const wpUrl = `https://asyamag.com/wp-json/wp/v2/posts?_embed=1&search=${encodeURIComponent(cleanName)}&per_page=6`;
      const resp = await fetch(wpUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (resp.ok) {
        const wpRaw = await resp.json();
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
    } catch {}

    return NextResponse.json({
      posts: mergedPosts.slice(0, 8),
      total: mergedPosts.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, posts: [] }, { status: 500 });
  }
}
