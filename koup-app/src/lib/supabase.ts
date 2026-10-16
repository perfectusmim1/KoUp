import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://aocvcotmikzlwbaezdpl.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export interface MediaItem {
  id: number;
  slug: string;
  content_type: 'dizi' | 'film' | 'anime' | 'program';
  country_code: string;
  country_name: string;
  title: string;
  title_tr?: string | null;
  title_en?: string | null;
  native_title?: string | null;
  aka_titles: string[];
  overview: string;
  release_year: number;
  episode_count: number;
  duration_minutes: number;
  status_broadcast: string;
  status_translation: string;
  cover_image: string;
  poster_fallback_url?: string | null;
  backdrop_image?: string | null;
  logo_image?: string | null;
  trailer_url?: string | null;
  mydramalist_url?: string | null;
  mdl_id?: string | null;
  anilist_id?: number | null;
  anilist_url?: string | null;
  imdb_id?: string | null;
  tmdb_id?: number | null;
  source_url?: string | null;
  alt_sites: string[];
  categories: string[];
  tags: string[];
  site_rating: number;
  site_rating_count: number;
  mdl_rating?: number | null;
  anilist_rating?: number | null;
  imdb_rating?: number | null;
  air_days: number[];
  air_time?: string | null;
  next_episode_number?: number | null;
  next_episode_at?: string | null;
  last_published_episode?: number | null;
  sources_count: number;
  episodes_available: number;
  views_total: number;
  views_weekly: number;
  favorites_count: number;
  followers_count: number;
  is_featured: boolean;
  featured_order: number;
}

export interface PersonItem {
  id: number;
  slug: string;
  name: string;
  native_name?: string | null;
  person_type: 'actor' | 'character' | 'seiyuu' | 'director';
  country_code?: string | null;
  image_url?: string | null;
  mydramalist_url?: string | null;
  profile_url?: string | null;
  anilist_id?: number | null;
  tmdb_id?: number | null;
  bio_tr?: string | null;
  birth_date?: string | null;
  favorites_count: number;
  followers_count: number;
  comments_count: number;
  drama_count: number;
  avg_rating: number;
}

export interface CastMember {
  media_id: number;
  person_id: number;
  role_type: 'lead' | 'support' | 'character' | 'seiyuu' | 'director';
  character_name?: string | null;
  voice_actor_name?: string | null;
  voice_actor_image?: string | null;
  voice_actor_slug?: string | null;
  billing_order: number;
  people?: PersonItem;
  media?: MediaItem;
}

export interface EpisodeSource {
  source_name: string;
  embed_id: string;
  direct_url: string;
  provider: string;
  site: string;
  fansub?: string | null;
  stream_type: 'hls' | 'mp4' | 'tau' | 'postmessage_iframe' | 'locked_iframe';
  quality_label?: string;
}

export interface EpisodeData {
  id: number;
  season_number: number;
  episode_number: number;
  episode_name: string;
  episode_type: string;
  status?: 'published' | 'scheduled' | 'broken';
  scheduled_release_at?: string | null;
  translation_note?: string | null;
  react_fire?: number;
  react_cry?: number;
  react_shock?: number;
  sources: EpisodeSource[];
}

export interface MagazinePost {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content_html: string;
  featured_image?: string | null;
  categories: string[];
  tags: string[];
  related_media_ids: number[];
  related_person_ids: number[];
  source_url?: string | null;
  likes_count: number;
  comments_count: number;
  published_at: string;
}

export interface UserProfile {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  bio?: string | null;
  role: 'user' | 'translator' | 'editor' | 'admin';
  is_private: boolean;
  hide_watch_history: boolean;
  notification_settings: {
    sound_enabled: boolean;
    sound_tone: 'apple_glass' | 'soft_chime' | 'minimal_pop';
    sound_volume: number;
    mute_during_fullscreen: boolean;
    notify_new_episode: boolean;
    notify_followed_actor: boolean;
    notify_comment_reply: boolean;
    notify_list_activity: boolean;
  };
  stats_episodes_watched: number;
  stats_series_completed: number;
  stats_movies_completed: number;
  stats_anime_completed: number;
  stats_total_minutes: number;
  mdl_username?: string | null;
  anilist_username?: string | null;
  anilist_auto_sync: boolean;
}

export interface UserMediaProgress {
  user_id?: string;
  media_id: number;
  status: 'watching' | 'completed' | 'plan_to_watch' | 'on_hold' | 'dropped';
  is_favorite: boolean;
  user_score?: number | null;
  watched_episodes: number[];
  last_season_num: number;
  last_episode_num: number;
  last_episode_title?: string | null;
  resume_position_sec: number;
  resume_duration_sec: number;
  updated_at: string;
  media?: MediaItem;
}

export function getProxiedImageUrl(url?: string | null, fallback?: string | null): string {
  if (!url) {
    if (fallback) return getProxiedImageUrl(fallback, null);
    return '/logo-dark.png';
  }
  if (url.startsWith('/') || url.startsWith('data:')) return url;
  // Direct fast CDN hosts that support HTTPS & CORS cleanly
  if (
    url.includes('image.tmdb.org') ||
    url.includes('s4.anilist.co') ||
    url.includes('lh3.googleusercontent.com')
  ) {
    return url;
  }
  const params = new URLSearchParams({ url });
  if (fallback) params.set('fallback', fallback);
  return `/api/image-proxy?${params.toString()}`;
}

export const COUNTRY_FLAGS: Record<string, string> = {
  KR: '🇰🇷',
  CN: '🇨🇳',
  JP: '🇯🇵',
  TH: '🇹🇭',
  TW: '🇹🇼',
  HK: '🇭🇰',
  PH: '🇵🇭',
  US: '🇺🇸',
  VN: '🇻🇳',
  SG: '🇸🇬',
};
