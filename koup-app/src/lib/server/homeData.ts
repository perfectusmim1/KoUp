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
        .select('*')
        .eq('is_featured', true)
        .not('backdrop_image', 'is', null)
        .order('featured_order', { ascending: true })
        .limit(10),
      client
        .from('media')
        .select('*')
        .eq('country_code', 'KR')
        .order('mdl_rating', { ascending: false, nullsFirst: false })
        .limit(28),
      client
        .from('media')
        .select('*')
        .eq('country_code', 'CN')
        .order('mdl_rating', { ascending: false, nullsFirst: false })
        .limit(28),
      client
        .from('media')
        .select('*')
        .eq('content_type', 'anime')
        .not('anilist_rating', 'is', null)
        .order('anilist_rating', { ascending: false })
        .limit(28),
      client
        .from('media')
        .select('*')
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
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(2000),
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
        .select('*')
        .order('id', { ascending: false })
        .limit(30),
      client
        .from('media')
        .select('*')
        .or('content_type.eq.kisa_drama,content_type.eq.short')
        .order('id', { ascending: false })
        .limit(20),
    ]);

    const isNotShort = (m: MediaItem) => !isShortDrama(m);

    // Fallback for top10 series & movies if RPC is empty
    let top10Series = (top10SeriesRes?.data as MediaItem[]) || [];
    if (top10Series.length === 0) {
      const { data: fbSeries } = await client
        .from('media')
        .select('*')
        .neq('content_type', 'film')
        .not('cover_image', 'is', null)
        .not('backdrop_image', 'is', null)
        .order('views_total', { ascending: false, nullsFirst: false })
        .limit(10);
      top10Series = (fbSeries as MediaItem[]) || [];
    }

    let top10Movies = (top10MoviesRes?.data as MediaItem[]) || [];
    if (top10Movies.length === 0) {
      const { data: fbMovies } = await client
        .from('media')
        .select('*')
        .eq('content_type', 'film')
        .not('cover_image', 'is', null)
        .not('backdrop_image', 'is', null)
        .order('views_total', { ascending: false, nullsFirst: false })
        .limit(10);
      top10Movies = (fbMovies as MediaItem[]) || [];
    }

    let shortDramas = (shortDramasRes?.data as MediaItem[]) || [];
    if (shortDramas.length === 0) {
      try {
        const { data: catShorts } = await client
          .from('media')
          .select('*')
          .contains('categories', ['Kısa Drama'])
          .order('id', { ascending: false })
          .limit(20);
        if (catShorts && catShorts.length > 0) {
          shortDramas = catShorts as MediaItem[];
        }
      } catch {}
    }

    return {
      feats: ((featRes?.data as MediaItem[]) || []).filter(isNotShort),
      kds: ((kdRes?.data as MediaItem[]) || []).filter(isNotShort),
      cds: ((cdRes?.data as MediaItem[]) || []).filter(isNotShort),
      ans: (anRes?.data as MediaItem[]) || [],
      gls: ((glRes?.data as MediaItem[]) || []).filter(isNotShort),
      episodes: (epRes?.data as any[]) || [],
      people: (peopRes?.data as PersonItem[]) || [],
      magPosts: (magRes?.data as MagazinePost[]) || [],
      top10Series: top10Series.filter(isNotShort),
      top10Movies: top10Movies.filter(isNotShort),
      recentMedia: ((recentMediaRes?.data as MediaItem[]) || []).filter(isNotShort),
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
      people: [],
      magPosts: [],
      top10Series: [],
      top10Movies: [],
      recentMedia: [],
      shortDramas: [],
    };
  }
}
