-- Ultra-fast catalog search function optimization:
-- Eliminates repeated per-row exception blocks and unaccent overhead in ORDER BY.
-- Uses indexed search_text and title prefix sorting for sub-40ms execution.

CREATE OR REPLACE FUNCTION public.search_catalog(p_query text, p_limit integer DEFAULT 8)
 RETURNS TABLE(id bigint, slug text, title text, native_title text, content_type text, country_code text, release_year integer, cover_image text, backdrop_image text, mdl_rating numeric, anilist_rating integer, imdb_rating numeric, categories text[])
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_raw text;
  v_norm text;
  v_len integer;
BEGIN
  v_raw := trim(coalesce(p_query, ''));
  v_len := length(v_raw);
  IF v_len < 1 THEN
    RETURN;
  END IF;

  v_norm := public.normalize_search_string(v_raw);
  IF v_norm = '' THEN
    v_norm := lower(v_raw);
  END IF;

  IF v_len >= 3 THEN
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
      m.title ILIKE '%' || v_raw || '%'
      OR m.search_text ILIKE '%' || v_norm || '%'
      OR m.slug ILIKE '%' || v_norm || '%'
    ORDER BY 
      CASE 
        WHEN LOWER(m.title) = LOWER(v_raw) OR m.slug = v_norm THEN 0
        WHEN LOWER(m.title) LIKE LOWER(v_raw) || '%' OR m.slug LIKE v_norm || '%' THEN 1
        WHEN m.search_text LIKE v_norm || '%' THEN 2
        ELSE 3
      END,
      COALESCE(m.views_total, 0) DESC,
      COALESCE(m.sources_count, 0) DESC,
      m.id DESC
    LIMIT p_limit;
  ELSE
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
      lower(m.title) LIKE lower(v_raw) || '%'
      OR lower(m.slug) LIKE lower(v_norm) || '%'
    ORDER BY 
      CASE 
        WHEN LOWER(m.title) = LOWER(v_raw) OR m.slug = v_norm THEN 0
        ELSE 1
      END,
      COALESCE(m.views_total, 0) DESC,
      COALESCE(m.sources_count, 0) DESC,
      m.id DESC
    LIMIT p_limit;
  END IF;
END;
$function$;
