-- ============================================================================
-- WEEKLY TRENDING TOP 10 (Netflix-style)
-- ----------------------------------------------------------------------------
-- "Bugün Türkiye'de En Popüler 10 İçerik" satırı artık tamamen sunucu taraflı,
-- gerçek kullanıcı etkileşimlerinden (son 7 gün, kayan pencere) hesaplanır:
--   * Detay sayfası tıklamaları / bölüm izleme açılışları (media_view_events)
--   * Yorumlar (farklı yorumcu sayısı ağırlıklı)
--   * Puanlar, favoriler, izleme durumları (user_media_progress)
--   * Bölüm reaksiyonları (episode_reactions)
-- Etkileşim azken satırın boş kalmaması için tüm zamanların en çok izlenen /
-- en yüksek puanlı içerikleriyle otomatik doldurulur.
-- ============================================================================

-- 1. Raw, de-duplicated view events --------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_view_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  media_id bigint NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
  viewer_key text NOT NULL,
  kind text NOT NULL DEFAULT 'detail' CHECK (kind IN ('detail', 'watch')),
  ip_hash text,
  view_day date NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/Istanbul')::date),
  viewed_at timestamptz NOT NULL DEFAULT now()
);

-- One counted view per viewer / media / kind / day (refresh spam is ignored)
CREATE UNIQUE INDEX IF NOT EXISTS media_view_events_dedupe_idx
  ON public.media_view_events (media_id, viewer_key, kind, view_day);
CREATE INDEX IF NOT EXISTS media_view_events_viewed_at_idx
  ON public.media_view_events (viewed_at DESC, media_id);
CREATE INDEX IF NOT EXISTS media_view_events_ip_idx
  ON public.media_view_events (ip_hash, viewed_at DESC);

-- Only reachable through SECURITY DEFINER functions below
ALTER TABLE public.media_view_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_view_events FROM anon, authenticated;

-- Helper indexes for the weekly aggregation
CREATE INDEX IF NOT EXISTS comments_media_created_idx
  ON public.comments (created_at DESC, media_id) WHERE media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_media_progress_updated_idx
  ON public.user_media_progress (updated_at DESC, media_id);
CREATE INDEX IF NOT EXISTS episode_reactions_created_idx
  ON public.episode_reactions (created_at DESC, media_id);

-- 2. View tracking RPC (backwards compatible: p_media_id alone still works) -----
CREATE OR REPLACE FUNCTION public.increment_media_view(
  p_media_id bigint,
  p_viewer_key text DEFAULT NULL,
  p_kind text DEFAULT 'detail'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_kind text := CASE WHEN p_kind = 'watch' THEN 'watch' ELSE 'detail' END;
  v_headers json;
  v_ip text;
  v_ip_hash text;
  v_key text;
  v_inserted integer := 0;
BEGIN
  IF p_media_id IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;

  v_ip := nullif(trim(coalesce(
    v_headers->>'cf-connecting-ip',
    split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1),
    v_headers->>'x-real-ip',
    ''
  )), '');
  IF v_ip IS NOT NULL THEN
    v_ip_hash := md5('koup-view:' || v_ip);
  END IF;

  v_key := CASE
    WHEN v_uid IS NOT NULL THEN 'u:' || v_uid::text
    WHEN p_viewer_key IS NOT NULL AND length(p_viewer_key) BETWEEN 8 AND 128 THEN 'a:' || p_viewer_key
    WHEN v_ip_hash IS NOT NULL THEN 'ip:' || v_ip_hash
    ELSE NULL
  END;
  IF v_key IS NULL THEN
    RETURN;
  END IF;

  -- Anti-bot: at most 120 counted views per IP per hour
  IF v_ip_hash IS NOT NULL AND (
    SELECT count(*) FROM public.media_view_events e
    WHERE e.ip_hash = v_ip_hash AND e.viewed_at > now() - interval '1 hour'
  ) >= 120 THEN
    RETURN;
  END IF;

  INSERT INTO public.media_view_events (media_id, viewer_key, kind, ip_hash)
  VALUES (p_media_id, v_key, v_kind, v_ip_hash)
  ON CONFLICT (media_id, viewer_key, kind, view_day) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted > 0 THEN
    UPDATE public.media
    SET views_total = coalesce(views_total, 0) + 1,
        views_weekly = coalesce(views_weekly, 0) + 1
    WHERE id = p_media_id;
  END IF;

  -- Lightweight retention (keeps the table small without pg_cron)
  IF random() < 0.02 THEN
    DELETE FROM public.media_view_events WHERE viewed_at < now() - interval '45 days';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_media_view(bigint, text, text) TO anon, authenticated;

-- 3. Weekly Top 10 RPC ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_weekly_top10(
  p_limit integer DEFAULT 10,
  p_days integer DEFAULT 7
)
RETURNS SETOF public.media
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH params AS (
    SELECT
      now() - make_interval(days => LEAST(GREATEST(coalesce(p_days, 7), 1), 30)) AS since,
      LEAST(GREATEST(coalesce(p_limit, 10), 1), 50) AS lim
  ),
  signals AS (
    -- Clicks (detail page = 1 pt) and watch opens (episode page = 3 pts), unique per viewer/day
    SELECT e.media_id, SUM(CASE WHEN e.kind = 'watch' THEN 3 ELSE 1 END)::numeric AS pts
    FROM public.media_view_events e, params
    WHERE e.viewed_at >= params.since
    GROUP BY e.media_id

    UNION ALL
    -- Comments: distinct commenters weigh most, extra comments add a little
    SELECT c.media_id, (COUNT(DISTINCT c.user_id) * 5 + COUNT(*))::numeric
    FROM public.comments c, params
    WHERE c.media_id IS NOT NULL
      AND coalesce(c.is_hidden, false) = false
      AND c.created_at >= params.since
    GROUP BY c.media_id

    UNION ALL
    -- Ratings / favourites / watch status (one row per user+media, so no spam)
    SELECT p.media_id, SUM(
        (CASE WHEN p.user_score IS NOT NULL AND p.user_score > 0
              THEN 4 + GREATEST(p.user_score - 5, 0) * 0.5 ELSE 0 END)
      + (CASE WHEN p.is_favorite THEN 4 ELSE 0 END)
      + (CASE WHEN p.status IN ('watching', 'completed') THEN 3
              WHEN p.status IN ('plan_to_watch', 'planned') THEN 1
              ELSE 0 END)
    )::numeric
    FROM public.user_media_progress p, params
    WHERE p.updated_at >= params.since
    GROUP BY p.media_id

    UNION ALL
    -- Episode reactions (distinct users)
    SELECT r.media_id, (COUNT(DISTINCT r.user_id) * 2)::numeric
    FROM public.episode_reactions r, params
    WHERE r.created_at >= params.since
    GROUP BY r.media_id
  ),
  scored AS (
    SELECT s.media_id, SUM(s.pts) AS score
    FROM signals s
    GROUP BY s.media_id
  ),
  ranked AS (
    SELECT m.id, 0 AS tier, sc.score
    FROM scored sc
    JOIN public.media m ON m.id = sc.media_id
    WHERE sc.score > 0
      AND m.cover_image IS NOT NULL AND m.cover_image <> ''
    ORDER BY sc.score DESC, m.views_total DESC NULLS LAST
    LIMIT (SELECT lim FROM params)
  ),
  fallback AS (
    SELECT m.id, 1 AS tier, 0::numeric AS score
    FROM public.media m
    WHERE m.cover_image IS NOT NULL AND m.cover_image <> ''
      AND m.backdrop_image IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ranked r WHERE r.id = m.id)
    ORDER BY m.views_total DESC NULLS LAST,
             coalesce(m.mdl_rating, m.imdb_rating, m.anilist_rating / 10.0) DESC NULLS LAST
    LIMIT (SELECT lim FROM params)
  )
  SELECT m.*
  FROM (SELECT * FROM ranked UNION ALL SELECT * FROM fallback) x
  JOIN public.media m ON m.id = x.id
  ORDER BY x.tier,
           x.score DESC,
           m.views_total DESC NULLS LAST,
           coalesce(m.mdl_rating, m.imdb_rating, m.anilist_rating / 10.0) DESC NULLS LAST
  LIMIT (SELECT lim FROM params);
$$;

GRANT EXECUTE ON FUNCTION public.get_weekly_top10(integer, integer) TO anon, authenticated;
