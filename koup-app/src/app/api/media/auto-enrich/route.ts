import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '4c092d2cfd6d9c0e3aa3dab12c7d4756';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const slug = searchParams.get('slug');

    if (!id && !slug) {
      return NextResponse.json({ error: 'id veya slug belirtilmelidir' }, { status: 400 });
    }

    let q = supabase.from('media').select('*');
    if (id) q = q.eq('id', Number(id));
    else if (slug) q = q.eq('slug', slug);

    const { data: media, error } = await q.single();
    if (error || !media) {
      return NextResponse.json({ error: 'Yapım bulunamadı' }, { status: 404 });
    }

    if (media.cover_image && media.backdrop_image) {
      return NextResponse.json({
        alreadyEnriched: true,
        cover_image: media.cover_image,
        backdrop_image: media.backdrop_image,
      });
    }

    // Candidate titles to search TMDB
    const searchQueries: string[] = [media.title];
    if (media.title_en && !searchQueries.includes(media.title_en)) searchQueries.push(media.title_en);
    if (Array.isArray(media.aka_titles)) {
      for (const aka of media.aka_titles) {
        if (aka && !searchQueries.includes(aka)) searchQueries.push(aka);
      }
    }
    if (media.native_title && !searchQueries.includes(media.native_title)) searchQueries.push(media.native_title);

    let matched: any = null;
    const endpoints = media.content_type === 'film' ? ['search/movie', 'search/tv'] : ['search/tv', 'search/movie'];

    for (const titleQuery of searchQueries) {
      for (const ep of endpoints) {
        try {
          const tmdbUrl = `https://api.themoviedb.org/3/${ep}?query=${encodeURIComponent(titleQuery)}&api_key=${TMDB_API_KEY}&language=tr-TR`;
          const resp = await fetch(tmdbUrl, { signal: AbortSignal.timeout(6000) });
          if (resp.ok) {
            const data = await resp.json();
            for (const r of data.results || []) {
              if (r.poster_path || r.backdrop_path) {
                matched = r;
                break;
              }
            }
          }
        } catch {}
        if (matched) break;
      }
      if (matched) break;
    }

    if (!matched) {
      return NextResponse.json({ success: false, message: 'TMDB eşleşmesi bulunamadı' });
    }

    const posterUrl = matched.poster_path
      ? `https://image.tmdb.org/t/p/w780${matched.poster_path}`
      : matched.backdrop_path
      ? `https://image.tmdb.org/t/p/w780${matched.backdrop_path}`
      : null;

    const backdropUrl = matched.backdrop_path
      ? `https://image.tmdb.org/t/p/original${matched.backdrop_path}`
      : posterUrl;

    if (!posterUrl) {
      return NextResponse.json({ success: false, message: 'Görsel bulunamadı' });
    }

    // Call patch_media_images RPC to update DB
    await supabase.rpc('patch_media_images', {
      p_media_id: media.id,
      p_cover_image: posterUrl,
      p_backdrop_image: backdropUrl,
      p_tmdb_id: matched.id || null,
    });

    return NextResponse.json({
      success: true,
      updatedMedia: {
        cover_image: posterUrl,
        backdrop_image: backdropUrl,
        poster_fallback_url: posterUrl,
        tmdb_id: matched.id || null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
