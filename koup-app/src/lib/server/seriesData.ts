import fs from 'fs';
import path from 'path';
import {
  supabase,
  supabaseAdmin,
  MediaItem,
  EpisodeData,
  CastMember,
  cleanScrapedSlug,
} from '@/lib/supabase';

export interface FranchiseItem {
  id: number;
  slug: string;
  title: string;
  release_year: number;
  content_type: string;
  episode_count: number;
  cover_image: string;
  category: 'main' | 'side';
  role_label: string;
  format: string;
  watch_order: number;
}

export interface FranchiseData {
  franchise_id: string;
  title: string;
  items: FranchiseItem[];
}

export interface ServerSeriesData {
  media: MediaItem | null;
  episodes: EpisodeData[];
  cast: CastMember[];
  franchise: FranchiseData | null;
}

interface FranchiseGraphPayload {
  media_to_franchise: Record<string, string>;
  franchises: Record<string, FranchiseData>;
}

let cachedFranchiseGraph: FranchiseGraphPayload | null = null;
let cachedGraphMtime = 0;

export function getFranchiseForMedia(mediaId: number): FranchiseData | null {
  if (!mediaId || Number.isNaN(Number(mediaId))) return null;

  try {
    const candidates = [
      path.resolve(process.cwd(), 'src', 'data', 'franchise_graph.json'),
      path.resolve(process.cwd(), 'koup-app', 'src', 'data', 'franchise_graph.json'),
      path.resolve(process.cwd(), '..', 'r2_bundles', 'franchise_graph.json'),
      path.resolve(process.cwd(), 'r2_bundles', 'franchise_graph.json'),
    ];

    for (const fPath of candidates) {
      if (fs.existsSync(fPath)) {
        const stat = fs.statSync(fPath);
        if (!cachedFranchiseGraph || stat.mtimeMs !== cachedGraphMtime) {
          const raw = fs.readFileSync(fPath, 'utf-8');
          cachedFranchiseGraph = JSON.parse(raw) as FranchiseGraphPayload;
          cachedGraphMtime = stat.mtimeMs;
        }
        break;
      }
    }

    if (!cachedFranchiseGraph) return null;
    const fid = cachedFranchiseGraph.media_to_franchise?.[String(mediaId)];
    if (!fid) return null;
    const fr = cachedFranchiseGraph.franchises?.[fid];
    if (!fr || !Array.isArray(fr.items) || fr.items.length < 2) return null;
    return fr;
  } catch (err) {
    console.error(`Error reading franchise graph for #${mediaId}:`, err);
    return null;
  }
}

/**
 * Fast server-side fetcher for Series Detail Page (SSR & ISR).
 * Reads local disk bundles (0.2ms latency) for episode data whenever available.
 */
export async function getSeriesDataServer(rawSlug: string): Promise<ServerSeriesData> {
  const decodedSlug = decodeURIComponent(rawSlug || '').trim();
  if (!decodedSlug) {
    return { media: null, episodes: [], cast: [], franchise: null };
  }

  const client = typeof window === 'undefined' ? supabaseAdmin : supabase;

  // 1. Fetch media record
  let mediaRow: MediaItem | null = null;

  // Exact slug match
  const { data: exactMatch } = await client
    .from('media')
    .select('*')
    .eq('slug', decodedSlug)
    .maybeSingle();

  if (exactMatch) {
    mediaRow = exactMatch as MediaItem;
  }

  // Fallback 1: Cleaned scraped slug
  if (!mediaRow) {
    const cleaned = cleanScrapedSlug(decodedSlug);
    if (cleaned && cleaned !== decodedSlug) {
      const { data: cleanMatch } = await client
        .from('media')
        .select('*')
        .eq('slug', cleaned)
        .maybeSingle();
      if (cleanMatch) {
        mediaRow = cleanMatch as MediaItem;
      }
    }
  }

  // Fallback 2: aka_titles
  if (!mediaRow) {
    const { data: akaRows } = await client
      .from('media')
      .select('*')
      .contains('aka_titles', [decodedSlug])
      .limit(1);
    if (akaRows && akaRows[0]) {
      mediaRow = akaRows[0] as MediaItem;
    }
  }

  // Fallback 3: Prefix or suffix match
  if (!mediaRow) {
    const { data: fallbackRows } = await client
      .from('media')
      .select('*')
      .or(`slug.eq.${decodedSlug}-izle,slug.ilike.${decodedSlug}%`)
      .limit(1);
    if (fallbackRows && fallbackRows[0]) {
      mediaRow = fallbackRows[0] as MediaItem;
    }
  }

  // Fallback 4: Numeric ID lookup
  if (!mediaRow && !Number.isNaN(Number(decodedSlug))) {
    const { data: byId } = await client
      .from('media')
      .select('*')
      .eq('id', Number(decodedSlug))
      .maybeSingle();
    if (byId) {
      mediaRow = byId as MediaItem;
    }
  }

  if (!mediaRow) {
    return { media: null, episodes: [], cast: [], franchise: null };
  }

  const mediaId = mediaRow.id;

  // 2. Fetch cast in parallel with episodes
  const castPromise = (async () => {
    try {
      const { data: castRows } = await client
        .from('media_cast')
        .select('*, people(*)')
        .eq('media_id', mediaId)
        .order('billing_order', { ascending: true })
        .limit(24);

      const rawCast = (castRows as CastMember[]) || [];
      return rawCast.sort((a, b) => {
        const aLead = a.role_type === 'lead' ? 0 : 1;
        const bLead = b.role_type === 'lead' ? 0 : 1;
        if (aLead !== bLead) return aLead - bLead;
        return (a.billing_order || 999) - (b.billing_order || 999);
      });
    } catch {
      return [] as CastMember[];
    }
  })();

  // 3. Fast Episode Retrieval (Tier 0: Local disk bundle -> 0.2ms latency)
  const episodesPromise = (async (): Promise<EpisodeData[]> => {
    try {
      const candidates = [
        path.resolve(process.cwd(), '..', 'r2_bundles', 'sources', `${mediaId}.json`),
        path.resolve(process.cwd(), 'r2_bundles', 'sources', `${mediaId}.json`),
      ];

      for (const bPath of candidates) {
        if (fs.existsSync(bPath)) {
          const raw = fs.readFileSync(bPath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.episodes) && parsed.episodes.length > 0) {
            return parsed.episodes as EpisodeData[];
          }
        }
      }

      // Fallback: Supabase episodes table
      const { data: epRows } = await client
        .from('episodes')
        .select('id, season_number, episode_number, episode_name, episode_type, status, published_at')
        .eq('media_id', mediaId)
        .order('season_number', { ascending: true })
        .order('episode_number', { ascending: true });

      if (epRows && epRows.length > 0) {
        return epRows.map((r) => ({
          id: r.id,
          season_number: r.season_number || 1,
          episode_number: r.episode_number || 1,
          episode_name: r.episode_name || `${r.episode_number}. Bölüm`,
          episode_type: r.episode_type || 'bolum',
          sources: [],
        })) as EpisodeData[];
      }
    } catch (err) {
      console.error(`Error loading server episodes for #${mediaId}:`, err);
    }
    return [];
  })();

  const [cast, episodes] = await Promise.all([castPromise, episodesPromise]);
  const franchise = getFranchiseForMedia(mediaId);

  return {
    media: mediaRow,
    episodes,
    cast,
    franchise,
  };
}
