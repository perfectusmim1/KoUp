import { supabase, supabaseAdmin, MediaItem, PersonItem } from '@/lib/supabase';

export const SLIM_CATALOG_MEDIA_COLUMNS = [
  'id',
  'slug',
  'title',
  'native_title',
  'content_type',
  'country_code',
  'release_year',
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
  'episode_count',
  'episodes_available',
  'status_broadcast',
  'views_total',
].join(', ');

export const SLIM_PEOPLE_COLUMNS = [
  'id',
  'slug',
  'name',
  'native_name',
  'image_url',
  'tmdb_id',
  'person_type',
  'favorites_count',
  'drama_count',
].join(', ');

export async function getInitialCatalogServer(): Promise<{
  items: MediaItem[];
  totalCount: number;
}> {
  const client = typeof window === 'undefined' ? supabaseAdmin : supabase;
  try {
    const [itemsRes, countRes] = await Promise.all([
      client
        .from('media')
        .select(SLIM_CATALOG_MEDIA_COLUMNS)
        .neq('content_type', 'kisa_drama')
        .neq('content_type', 'short')
        .order('views_total', { ascending: false, nullsFirst: false })
        .range(0, 35),
      client
        .from('media')
        .select('id', { count: 'estimated', head: true })
        .neq('content_type', 'kisa_drama')
        .neq('content_type', 'short'),
    ]);

    const items = (itemsRes.data as unknown as MediaItem[]) || [];
    const totalCount =
      typeof countRes.count === 'number' && countRes.count > 0
        ? countRes.count
        : 24746;

    return { items, totalCount };
  } catch {
    return { items: [], totalCount: 24746 };
  }
}

export async function getInitialPeopleServer(): Promise<{
  people: PersonItem[];
  totalCount: number;
}> {
  const client = typeof window === 'undefined' ? supabaseAdmin : supabase;
  try {
    const { data, count } = await client
      .from('people')
      .select(SLIM_PEOPLE_COLUMNS, { count: 'estimated' })
      .order('favorites_count', { ascending: false })
      .order('drama_count', { ascending: false })
      .range(0, 47);

    return {
      people: (data as unknown as PersonItem[]) || [],
      totalCount: typeof count === 'number' ? count : 0,
    };
  } catch {
    return { people: [], totalCount: 0 };
  }
}

export async function getInitialRecentEpisodesServer(): Promise<{
  episodes: any[];
  totalCount: number;
}> {
  const client = typeof window === 'undefined' ? supabaseAdmin : supabase;
  try {
    const [epRes, countRes] = await Promise.all([
      client
        .from('episodes')
        .select(
          `
          id,
          media_id,
          season_number,
          episode_number,
          episode_name,
          published_at,
          status,
          media:media_id (
            id,
            slug,
            title,
            cover_image,
            backdrop_image,
            content_type,
            tmdb_id
          )
        `
        )
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .range(0, 49),
      client
        .from('episodes')
        .select('id', { count: 'estimated', head: true })
        .eq('status', 'published')
        .not('published_at', 'is', null),
    ]);

    const list = ((epRes.data as any[]) || [])
      .map((item) => ({
        ...item,
        media: item.media as MediaItem | null,
      }))
      .filter((item) => item.media);

    return {
      episodes: list,
      totalCount: typeof countRes.count === 'number' ? countRes.count : list.length,
    };
  } catch {
    return { episodes: [], totalCount: 0 };
  }
}
