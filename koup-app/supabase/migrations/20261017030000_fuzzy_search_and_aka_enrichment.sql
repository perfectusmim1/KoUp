-- Migration: 20261017030000_fuzzy_search_and_aka_enrichment.sql
-- Description: Advanced fuzzy search, Turkish transliteration, space-insensitive condensed matching,
-- multi-token out-of-order queries, and automatic alternative title (AKA) enrichment from titles and slugs.

-- Ensure unaccent and pg_trgm extensions
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Normalization helper: strips accents, lowercases, handles Turkish (ı->i, ğ->g, ü->u, ş->s, ö->o, ç->c),
-- replaces punctuation with spaces, and collapses whitespace.
CREATE OR REPLACE FUNCTION public.normalize_search_string(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_res text;
BEGIN
  IF p_text IS NULL OR length(p_text) = 0 THEN
    RETURN '';
  END IF;
  v_res := lower(p_text);
  v_res := replace(v_res, 'ı', 'i');
  v_res := replace(v_res, 'ğ', 'g');
  v_res := replace(v_res, 'ü', 'u');
  v_res := replace(v_res, 'ş', 's');
  v_res := replace(v_res, 'ö', 'o');
  v_res := replace(v_res, 'ç', 'c');
  v_res := public.unaccent(v_res);
  -- Replace punctuation and symbols with space (preserving CJK, Cyrillic, and alphanumerics)
  v_res := regexp_replace(v_res, '[^a-z0-9\u0400-\u04ff\u1100-\u11ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+', ' ', 'g');
  RETURN trim(regexp_replace(v_res, '\s+', ' ', 'g'));
END;
$$;

-- 2. Extract alternative titles from title (parentheses, colons, slashes) and clean slug
CREATE OR REPLACE FUNCTION public.extract_alternative_titles(p_title text, p_slug text, p_existing_aka text[])
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_akas text[];
  v_part text;
  v_slug_clean text;
BEGIN
  v_akas := COALESCE(p_existing_aka, '{}');

  -- Add cleaned de-hyphenated slug
  IF p_slug IS NOT NULL AND length(p_slug) > 0 THEN
    v_slug_clean := trim(replace(regexp_replace(regexp_replace(p_slug, '-(ad|dq|box|hd[0-9]*|dizi[0-9]*|vip[0-9]*|[0-9]+)$', '', 'g'), '-(izle|full|turkce|altyazili|dublaj)$', '', 'g'), '-', ' '));
    IF length(v_slug_clean) > 2 AND NOT (v_slug_clean = ANY(v_akas)) THEN
      v_akas := array_append(v_akas, v_slug_clean);
    END IF;
  END IF;

  -- Extract parenthetical content, e.g. "Title (AKA Title)" -> "AKA Title" and "Title"
  IF p_title ~ '\([^)]+\)' THEN
    v_part := trim(substring(p_title from '\(([^)]+)\)'));
    IF length(v_part) > 1 AND NOT (v_part = ANY(v_akas)) THEN
      v_akas := array_append(v_akas, v_part);
    END IF;
    v_part := trim(regexp_replace(p_title, '\s*\([^)]+\).*', ''));
    IF length(v_part) > 1 AND NOT (v_part = ANY(v_akas)) THEN
      v_akas := array_append(v_akas, v_part);
    END IF;
  END IF;

  -- Extract parts separated by colon, e.g. "Doctor X: Season 7" -> "Doctor X", "Season 7"
  IF p_title LIKE '%:%' THEN
    v_part := trim(split_part(p_title, ':', 1));
    IF length(v_part) > 1 AND NOT (v_part = ANY(v_akas)) THEN
      v_akas := array_append(v_akas, v_part);
    END IF;
    v_part := trim(split_part(p_title, ':', 2));
    IF length(v_part) > 1 AND NOT (v_part = ANY(v_akas)) THEN
      v_akas := array_append(v_akas, v_part);
    END IF;
  END IF;

  -- Extract parts separated by slash, e.g. "Title / Alt Title"
  IF p_title LIKE '%/%' AND NOT p_title LIKE '%1/2%' THEN
    v_part := trim(split_part(p_title, '/', 1));
    IF length(v_part) > 1 AND NOT (v_part = ANY(v_akas)) THEN
      v_akas := array_append(v_akas, v_part);
    END IF;
    v_part := trim(split_part(p_title, '/', 2));
    IF length(v_part) > 1 AND NOT (v_part = ANY(v_akas)) THEN
      v_akas := array_append(v_akas, v_part);
    END IF;
  END IF;

  RETURN v_akas;
END;
$$;

-- 3. Search text generator: creates a comprehensive search corpus for each media item
CREATE OR REPLACE FUNCTION public.generate_media_search_text(
  p_title text,
  p_title_tr text,
  p_title_en text,
  p_native_title text,
  p_aka_titles text[],
  p_slug text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_raw text;
  v_norm text;
  v_condensed text;
  v_slug_spaced text;
  v_slug_condensed text;
BEGIN
  v_raw := lower(
    coalesce(p_title, '') || ' ' ||
    coalesce(p_title_tr, '') || ' ' ||
    coalesce(p_title_en, '') || ' ' ||
    coalesce(p_native_title, '') || ' ' ||
    array_to_string(coalesce(p_aka_titles, '{}'), ' ')
  );

  v_norm := public.normalize_search_string(v_raw);
  v_condensed := regexp_replace(v_norm, '\s+', '', 'g');

  v_slug_spaced := replace(coalesce(p_slug, ''), '-', ' ');
  v_slug_condensed := replace(coalesce(p_slug, ''), '-', '');

  RETURN trim(
    v_raw || ' ' ||
    v_norm || ' ' ||
    v_condensed || ' ' ||
    v_slug_spaced || ' ' ||
    v_slug_condensed
  );
END;
$$;

-- 4. Trigger on media table
CREATE OR REPLACE FUNCTION public.media_update_search_text()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.aka_titles := public.extract_alternative_titles(NEW.title, NEW.slug, NEW.aka_titles);
  NEW.search_text := public.generate_media_search_text(
    NEW.title,
    NEW.title_tr,
    NEW.title_en,
    NEW.native_title,
    NEW.aka_titles,
    NEW.slug
  );
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- 5. Omnibox search RPC
CREATE OR REPLACE FUNCTION public.search_catalog(p_query text, p_limit integer DEFAULT 8)
RETURNS TABLE(
  id bigint,
  slug text,
  title text,
  native_title text,
  content_type text,
  country_code text,
  release_year integer,
  cover_image text,
  backdrop_image text,
  mdl_rating numeric,
  anilist_rating integer,
  imdb_rating numeric,
  categories text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_raw_query text;
  v_norm_query text;
  v_condensed_query text;
  v_tokens text[];
  v_token_count integer;
BEGIN
  v_raw_query := trim(coalesce(p_query, ''));
  IF length(v_raw_query) < 1 THEN
    RETURN;
  END IF;

  v_norm_query := public.normalize_search_string(v_raw_query);
  v_condensed_query := regexp_replace(v_norm_query, '\s+', '', 'g');
  
  v_tokens := string_to_array(v_norm_query, ' ');
  v_token_count := coalesce(array_length(v_tokens, 1), 0);

  RETURN QUERY
  SELECT 
    m.id,
    m.slug,
    m.title,
    m.native_title,
    m.content_type,
    m.country_code,
    m.release_year,
    m.cover_image,
    m.backdrop_image,
    m.mdl_rating,
    m.anilist_rating,
    m.imdb_rating,
    m.categories
  FROM public.media m
  WHERE 
    m.search_text ILIKE '%' || v_norm_query || '%'
    OR m.title ILIKE '%' || v_raw_query || '%'
    OR m.slug ILIKE '%' || v_norm_query || '%'
    OR (length(v_condensed_query) >= 3 AND m.search_text ILIKE '%' || v_condensed_query || '%')
    OR (
      v_token_count > 1 
      AND (
        SELECT bool_and(m.search_text ILIKE '%' || token || '%')
        FROM unnest(v_tokens) AS token
        WHERE length(token) > 1
      )
    )
  ORDER BY 
    CASE 
      WHEN LOWER(m.title) = LOWER(v_raw_query) OR public.normalize_search_string(m.title) = v_norm_query THEN 0
      WHEN public.normalize_search_string(m.title) LIKE v_norm_query || '%' THEN 1
      WHEN public.normalize_search_string(m.title) LIKE '% ' || v_norm_query || ' %' THEN 2
      WHEN public.normalize_search_string(m.title) LIKE '%' || v_norm_query || '%' THEN 3
      WHEN m.slug LIKE '%' || replace(v_norm_query, ' ', '-') || '%' THEN 4
      WHEN length(v_condensed_query) >= 3 AND m.search_text LIKE '%' || v_condensed_query || '%' THEN 5
      ELSE 6
    END,
    COALESCE(m.mdl_rating, m.imdb_rating, (m.anilist_rating::numeric / 10), 0) DESC,
    m.id DESC
  LIMIT p_limit;
END;
$$;

-- 6. Keşfet catalog search RPC with filtering support
CREATE OR REPLACE FUNCTION public.search_media(
  p_query text DEFAULT '',
  p_type text DEFAULT 'ALL',
  p_country text DEFAULT 'ALL',
  p_genre text DEFAULT 'Tümü',
  p_sort text DEFAULT 'views',
  p_limit integer DEFAULT 72
)
RETURNS SETOF public.media
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_raw_query text;
  v_norm_query text;
  v_condensed_query text;
  v_tokens text[];
  v_token_count integer;
BEGIN
  v_raw_query := trim(coalesce(p_query, ''));
  v_norm_query := public.normalize_search_string(v_raw_query);
  v_condensed_query := regexp_replace(v_norm_query, '\s+', '', 'g');
  v_tokens := string_to_array(v_norm_query, ' ');
  v_token_count := coalesce(array_length(v_tokens, 1), 0);

  RETURN QUERY
  SELECT m.*
  FROM public.media m
  WHERE 
    (p_type = 'ALL' OR m.content_type = p_type)
    AND (p_country = 'ALL' OR m.country_code = p_country)
    AND (p_genre = 'Tümü' OR m.categories @> ARRAY[p_genre])
    AND (
      length(v_norm_query) < 2
      OR m.search_text ILIKE '%' || v_norm_query || '%'
      OR m.title ILIKE '%' || v_raw_query || '%'
      OR m.slug ILIKE '%' || v_norm_query || '%'
      OR (length(v_condensed_query) >= 3 AND m.search_text ILIKE '%' || v_condensed_query || '%')
      OR (
        v_token_count > 1 
        AND (
          SELECT bool_and(m.search_text ILIKE '%' || token || '%')
          FROM unnest(v_tokens) AS token
          WHERE length(token) > 1
        )
      )
    )
  ORDER BY 
    CASE 
      WHEN length(v_norm_query) >= 2 AND (LOWER(m.title) = LOWER(v_raw_query) OR public.normalize_search_string(m.title) = v_norm_query) THEN 0
      WHEN length(v_norm_query) >= 2 AND public.normalize_search_string(m.title) LIKE v_norm_query || '%' THEN 1
      WHEN length(v_norm_query) >= 2 AND public.normalize_search_string(m.title) LIKE '% ' || v_norm_query || ' %' THEN 2
      WHEN length(v_norm_query) >= 2 AND public.normalize_search_string(m.title) LIKE '%' || v_norm_query || '%' THEN 3
      WHEN length(v_norm_query) >= 2 AND m.slug LIKE '%' || replace(v_norm_query, ' ', '-') || '%' THEN 4
      WHEN length(v_norm_query) >= 2 AND length(v_condensed_query) >= 3 AND m.search_text LIKE '%' || v_condensed_query || '%' THEN 5
      ELSE 6
    END,
    CASE WHEN p_sort = 'latest' THEN m.id END DESC,
    CASE WHEN p_sort = 'views' THEN m.views_total END DESC,
    CASE WHEN p_sort = 'rating' THEN COALESCE(m.site_rating, m.mdl_rating, m.imdb_rating, 0) END DESC,
    CASE WHEN p_sort = 'year' THEN m.release_year END DESC NULLS LAST,
    m.id DESC
  LIMIT p_limit;
END;
$$;
