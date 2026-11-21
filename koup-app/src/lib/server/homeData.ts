import {
  supabase,
  supabaseAdmin,
  MediaItem,
  PersonItem,
  MagazinePost,
  isShortDrama,
} from '@/lib/supabase';

export interface HomeDataBundle {
  feats: MediaItem[];
  kds: MediaItem[];
  cds: MediaItem[];
  ans: MediaItem[];
  gls: MediaItem[];
  episodes: any[];
  people: PersonItem[];
  magPosts: MagazinePost[];
  top10Series?: MediaItem[];
  top10Movies?: MediaItem[];
  recentEpsProcessed?: any[];
  recentMedia?: MediaItem[];
  shortDramas?: MediaItem[];
}

export const HOME_MEDIA_COLUMNS = [
  'id',
  'slug',
  'title',
  'native_title',
  'content_type',
  'country_code',
  'release_year',
  'episode_count',
  'episodes_available',
  'duration_minutes',
  'status_broadcast',
  'cover_image',
  'poster_fallback_url',
  'backdrop_image',
  'overview',
  'tmdb_id',
  'categories',
  'tags',
  'site_rating',
  'site_rating_count',
  'mdl_rating',
  'anilist_rating',
  'imdb_rating',
  'views_total',
  'is_featured',
  'featured_order',
].join(', ');

export async function getHomeDataServer(): Promise<HomeDataBundle> {
  const client = typeof window === 'undefined' ? supabaseAdmin : supabase;

  try {
    const [
      featRes,
      kdRes,
      cdRes,
      anRes,
      glRes,
      epRes,
      peopRes,
      magRes,
      top10SeriesRes,
      top10MoviesRes,
      recentMediaRes,
      shortDramasRes,
    ] = await Promise.all([
      client
        .from('media')
        .select(HOME_MEDIA_COLUMNS)
        .eq('is_featured', true)
        .not('backdrop_image', 'is', null)
        .order('featured_order', { ascending: true })
        .limit(10),
      client
        .from('media')
        .select(HOME_MEDIA_COLUMNS)
        .eq('country_code', 'KR')
        .order('mdl_rating', { ascending: false, nullsFirst: false })
        .limit(28),
      client
        .from('media')
        .select(HOME_MEDIA_COLUMNS)
        .eq('country_code', 'CN')
        .order('mdl_rating', { ascending: false, nullsFirst: false })
        .limit(28),
      client
        .from('media')
        .select(HOME_MEDIA_COLUMNS)
        .eq('content_type', 'anime')
        .not('anilist_rating', 'is', null)
        .order('anilist_rating', { ascending: false })
        .limit(28),
      client
        .from('media')
        .select(HOME_MEDIA_COLUMNS)
        .in('country_code', ['US', 'TH', 'TW', 'JP'])
        .neq('content_type', 'anime')
        .order('imdb_rating', { ascending: false, nullsFirst: false })
        .order('mdl_rating', { ascending: false, nullsFirst: false })
        .limit(28),
      client
        .from('episodes')
        .select(
          'id, media_id, season_number, episode_number, episode_name, published_at, status, scheduled_release_at, translation_note, react_fire'
        )
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(180),
      client
        .from('people')
        .select('*')
        .order('favorites_count', { ascending: false })
        .order('drama_count', { ascending: false })
        .limit(12),
      client
        .from('magazine_posts')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(6),
      client.rpc('get_weekly_top10', { p_content_type: 'series' }),
      client.rpc('get_weekly_top10', { p_content_type: 'film' }),
      client
        .from('media')
        .select(HOME_MEDIA_COLUMNS)
        .order('id', { ascending: false })
        .limit(30),
      client
        .from('media')
        .select(HOME_MEDIA_COLUMNS)
        .or('content_type.eq.kisa_drama,content_type.eq.short')
        .order('id', { ascending: false })
        .limit(20),
    ]);

    const isNotShort = (m: MediaItem) => !isShortDrama(m);

    // Deduplicate recent published episodes server-side (1 per media, top 24)
    const rawEpisodes = (epRes?.data as any[]) || [];
    const seenMedia = new Set<number>();
    const uniqueEps: any[] = [];
    for (const ep of rawEpisodes) {
      if (ep?.media_id && ep?.published_at && !seenMedia.has(ep.media_id)) {
        seenMedia.add(ep.media_id);
        uniqueEps.push(ep);
        if (uniqueEps.length >= 24) break;
      }
    }

    let recentEpsProcessed: any[] = [];
    if (uniqueEps.length > 0) {
      const mIds = uniqueEps.map((e: any) => e.media_id);
      const { data: epMediaRows } = await client
        .from('media')
        .select(HOME_MEDIA_COLUMNS)
        .in('id', mIds);
      const epMediaMap = new Map(
        ((epMediaRows as unknown as MediaItem[]) || []).map((m) => [m.id, m])
      );
      recentEpsProcessed = uniqueEps
        .map((e: any) => ({ ...e, media: epMediaMap.get(e.media_id) }))
        .filter((e: any) => e.media);
    }

    // Fallback for top10 series & movies if RPC is empty
    let top10Series = (top10SeriesRes?.data as MediaItem[]) || [];
    if (top10Series.length === 0) {
      const { data: fbSeries } = await client
        .from('media')
        .select(HOME_MEDIA_COLUMNS)
        .neq('content_type', 'film')
        .not('cover_image', 'is', null)
        .not('backdrop_image', 'is', null)
        .order('views_total', { ascending: false, nullsFirst: false })
        .limit(10);
      top10Series = (fbSeries as unknown as MediaItem[]) || [];
    }

    let top10Movies = (top10MoviesRes?.data as MediaItem[]) || [];
    if (top10Movies.length === 0) {
      const { data: fbMovies } = await client
        .from('media')
        .select(HOME_MEDIA_COLUMNS)
        .eq('content_type', 'film')
        .not('cover_image', 'is', null)
        .not('backdrop_image', 'is', null)
        .order('views_total', { ascending: false, nullsFirst: false })
        .limit(10);
      top10Movies = (fbMovies as unknown as MediaItem[]) || [];
    }

    let shortDramas = (shortDramasRes?.data as unknown as MediaItem[]) || [];
    if (shortDramas.length === 0) {
      try {
        const { data: catShorts } = await client
          .from('media')
          .select(HOME_MEDIA_COLUMNS)
          .contains('categories', ['Kısa Drama'])
          .order('id', { ascending: false })
          .limit(20);
        if (catShorts && catShorts.length > 0) {
          shortDramas = catShorts as unknown as MediaItem[];
        }
      } catch {}
    }

    return {
      feats: ((featRes?.data as unknown as MediaItem[]) || []).filter(isNotShort),
      kds: ((kdRes?.data as unknown as MediaItem[]) || []).filter(isNotShort),
      cds: ((cdRes?.data as unknown as MediaItem[]) || []).filter(isNotShort),
      ans: (anRes?.data as unknown as MediaItem[]) || [],
      gls: ((glRes?.data as unknown as MediaItem[]) || []).filter(isNotShort),
      episodes: uniqueEps,
      recentEpsProcessed,
      people: (peopRes?.data as PersonItem[]) || [],
      magPosts: (magRes?.data as MagazinePost[]) || [],
      top10Series: top10Series.filter(isNotShort),
      top10Movies: top10Movies.filter(isNotShort),
      recentMedia: ((recentMediaRes?.data as unknown as MediaItem[]) || []).filter(isNotShort),
      shortDramas,
    };
  } catch (err) {
    console.error('getHomeDataServer error:', err);
    return {
      feats: [],
      kds: [],
      cds: [],
      ans: [],
      gls: [],
      episodes: [],
      recentEpsProcessed: [],
      people: [],
      magPosts: [],
      top10Series: [],
      top10Movies: [],
      recentMedia: [],
      shortDramas: [],
    };
  }
}
