-- Migration: 20261016160000_security_and_database_hardening.sql
-- Description: Comprehensive database security, RLS hardening, admin lock-down, episode reactions, comment moderation, and performance indexes.

-- ============================================================================
-- 1. SECURITY DEFINER HELPER: public.is_admin()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE 
    WHEN (SELECT auth.uid()) IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- ============================================================================
-- 2. SIGNUP TRIGGER & PROFILE ROLE PROTECTION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  base_username TEXT;
BEGIN
  base_username := coalesce(
    NEW.raw_user_meta_data->>'username',
    regexp_replace(split_part(coalesce(NEW.email, 'user'), '@', 1), '[^a-zA-Z0-9_]', '', 'g')
  );
  base_username := regexp_replace(base_username, '[^a-zA-Z0-9_]', '', 'g');
  IF char_length(base_username) < 3 THEN
    base_username := 'koup_' || substr(NEW.id::text, 1, 6);
  END IF;
  IF char_length(base_username) > 20 THEN
    base_username := substr(base_username, 1, 20);
  END IF;

  -- Always assign role = 'user'. Never bootstrap admin from signup.
  INSERT INTO public.profiles (id, username, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    base_username || '_' || substr(NEW.id::text, 1, 4),
    coalesce(NEW.raw_user_meta_data->>'display_name', base_username),
    NEW.raw_user_meta_data->>'avatar_url',
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkisiz rol değişikliği: Sadece yöneticiler kullanıcı rollerini değiştirebilir.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_protect_profile_role
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_role();

REVOKE EXECUTE ON FUNCTION public.protect_profile_role() FROM public, anon, authenticated;

-- ============================================================================
-- 3. HARDEN RPCs & REVOKE ANONYMOUS EXECUTION
-- ============================================================================
-- grant_admin_by_email: remove self-bootstrap loophole and enforce public.is_admin()
CREATE OR REPLACE FUNCTION public.grant_admin_by_email(target_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_uid uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkisiz erişim: Sadece yöneticiler admin yetkisi tanımlayabilir.';
  END IF;

  SELECT id INTO target_uid FROM auth.users WHERE lower(email) = lower(trim(target_email));
  IF target_uid IS NULL THEN
    RAISE EXCEPTION 'Kullanıcı bulunamadı: %', target_email;
  END IF;

  UPDATE public.profiles SET role = 'admin' WHERE id = target_uid;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_admin_by_email(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.grant_admin_by_email(text) TO authenticated, service_role;

-- admin_set_user_role: require is_admin() and validate roles
CREATE OR REPLACE FUNCTION public.admin_set_user_role(target_user_id uuid, new_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkisiz erişim: Sadece admin kullanıcı rolü değiştirebilir.';
  END IF;

  IF new_role NOT IN ('user', 'translator', 'editor', 'moderator', 'admin', 'banned') THEN
    RAISE EXCEPTION 'Geçersiz rol: %', new_role;
  END IF;

  UPDATE public.profiles SET role = new_role WHERE id = target_user_id;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated, service_role;

-- toggle_scraper_enabled: require is_admin()
CREATE OR REPLACE FUNCTION public.toggle_scraper_enabled(p_site_key text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkisiz erişim: Sadece yöneticiler scraper durumunu değiştirebilir.';
  END IF;

  UPDATE public.scraper_configs
  SET is_enabled = p_enabled
  WHERE id = p_site_key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.toggle_scraper_enabled(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.toggle_scraper_enabled(text, boolean) TO authenticated, service_role;

-- upsert_calendar_schedule: require is_admin()
CREATE OR REPLACE FUNCTION public.upsert_calendar_schedule(
  p_source_site text,
  p_day_of_week smallint,
  p_date_label text,
  p_title text,
  p_slug text,
  p_episode_label text,
  p_category text,
  p_cover_image text,
  p_source_url text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_media_id BIGINT;
  v_rec_id BIGINT;
  v_type TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkisiz erişim: Sadece yöneticiler takvim planı güncelleyebilir.';
  END IF;

  v_type := CASE 
    WHEN p_source_site = 'tranimeizle' OR p_category = 'Anime' THEN 'anime'
    ELSE 'dizi'
  END;

  SELECT id INTO v_media_id
  FROM public.media
  WHERE slug = p_slug OR LOWER(title) = LOWER(p_title)
  LIMIT 1;

  IF v_media_id IS NULL THEN
    INSERT INTO public.media (
      title,
      slug,
      cover_image,
      categories,
      content_type,
      country_code,
      release_year,
      status_broadcast,
      status_translation,
      air_days,
      views_total
    ) VALUES (
      p_title,
      p_slug,
      p_cover_image,
      ARRAY[COALESCE(p_category, 'Dizi')],
      v_type,
      CASE 
        WHEN p_source_site = 'tranimeizle' THEN 'JP'
        WHEN p_source_site = 'dizibox' THEN 'US'
        ELSE 'KR'
      END,
      2026,
      'Yayında',
      'Güncel Çeviri',
      ARRAY[p_day_of_week],
      50
    )
    ON CONFLICT (slug) DO UPDATE SET
      air_days = ARRAY(SELECT DISTINCT unnest(array_append(COALESCE(public.media.air_days, '{}'), p_day_of_week))),
      status_broadcast = 'Yayında'
    RETURNING id INTO v_media_id;
  ELSE
    UPDATE public.media
    SET air_days = ARRAY(SELECT DISTINCT unnest(array_append(COALESCE(air_days, '{}'), p_day_of_week))),
        status_broadcast = 'Yayında'
    WHERE id = v_media_id;
  END IF;

  INSERT INTO public.calendar_schedules (
    source_site,
    day_of_week,
    date_label,
    title,
    slug,
    episode_label,
    category,
    cover_image,
    source_url,
    media_id,
    updated_at
  ) VALUES (
    p_source_site,
    p_day_of_week,
    p_date_label,
    p_title,
    p_slug,
    p_episode_label,
    p_category,
    p_cover_image,
    p_source_url,
    v_media_id,
    now()
  )
  ON CONFLICT (source_site, day_of_week, slug)
  DO UPDATE SET
    date_label = EXCLUDED.date_label,
    title = EXCLUDED.title,
    episode_label = EXCLUDED.episode_label,
    category = EXCLUDED.category,
    cover_image = EXCLUDED.cover_image,
    source_url = EXCLUDED.source_url,
    media_id = EXCLUDED.media_id,
    updated_at = now()
  RETURNING id INTO v_rec_id;

  RETURN v_rec_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_calendar_schedule FROM public, anon;
GRANT EXECUTE ON FUNCTION public.upsert_calendar_schedule TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_bulk_ingest(text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_ingest(text, jsonb) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_ingest(text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_ingest(text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_comment_like_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.comments SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_person_fav_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.people SET favorites_count = favorites_count + 1 WHERE id = NEW.person_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.people SET favorites_count = GREATEST(0, favorites_count - 1) WHERE id = OLD.person_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.media_update_search_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.search_text := lower(
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.title_tr, '') || ' ' ||
    coalesce(NEW.title_en, '') || ' ' ||
    coalesce(NEW.native_title, '') || ' ' ||
    array_to_string(coalesce(NEW.aka_titles, '{}'), ' ')
  );
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_media_view(p_media_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.media
  SET views_total = views_total + 1,
      views_weekly = views_weekly + 1
  WHERE id = p_media_id;
$$;

CREATE OR REPLACE FUNCTION public.increment_person_favorite(p_person_id bigint, p_delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_count INT;
BEGIN
  UPDATE public.people
  SET favorites_count = GREATEST(0, COALESCE(favorites_count, 0) + p_delta)
  WHERE id = p_person_id
  RETURNING favorites_count INTO v_new_count;
  RETURN v_new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_catalog(p_query text, p_limit integer DEFAULT 8)
RETURNS TABLE(id bigint, slug text, title text, native_title text, content_type text, country_code text, release_year integer, cover_image text, backdrop_image text, mdl_rating numeric, anilist_rating integer, imdb_rating numeric, categories text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
    m.title ILIKE '%' || p_query || '%'
    OR m.slug ILIKE '%' || p_query || '%'
    OR m.search_text ILIKE '%' || p_query || '%'
    OR m.native_title ILIKE '%' || p_query || '%'
  ORDER BY 
    CASE 
      WHEN LOWER(m.title) = LOWER(p_query) THEN 0
      WHEN LOWER(m.title) LIKE LOWER(p_query) || ' %' THEN 1
      WHEN LOWER(m.title) LIKE LOWER(p_query) || '%' THEN 2
      WHEN LOWER(m.title) LIKE '% ' || LOWER(p_query) || ' %' THEN 3
      WHEN LOWER(m.title) LIKE '% ' || LOWER(p_query) || '%' THEN 4
      ELSE 5
    END,
    COALESCE(m.mdl_rating, m.imdb_rating, (m.anilist_rating::numeric / 10), 0) DESC,
    m.id DESC
  LIMIT p_limit;
$$;

-- ============================================================================
-- 4. EPISODE REACTIONS TABLE & FUNCTION
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.episode_reactions (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  media_id bigint NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
  season_number integer NOT NULL DEFAULT 1,
  episode_number integer NOT NULL DEFAULT 1,
  reaction text NOT NULL CHECK (reaction IN ('fire', 'cry', 'shock')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, media_id, season_number, episode_number)
);

ALTER TABLE public.episode_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read episode_reactions"
ON public.episode_reactions FOR SELECT USING (true);

CREATE POLICY "User insert own episode_reactions"
ON public.episode_reactions FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "User update own episode_reactions"
ON public.episode_reactions FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "User delete own episode_reactions"
ON public.episode_reactions FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.increment_episode_reaction(
  p_media_id bigint,
  p_season integer,
  p_episode integer,
  p_reaction text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_existing_reaction text;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Reaksiyon eklemek için giriş yapmanız gerekmektedir.';
  END IF;

  IF p_reaction NOT IN ('fire', 'cry', 'shock') THEN
    RAISE EXCEPTION 'Geçersiz reaksiyon türü: %', p_reaction;
  END IF;

  -- Ensure episode exists
  INSERT INTO public.episodes (media_id, season_number, episode_number, episode_name)
  VALUES (p_media_id, p_season, p_episode, p_episode || '. Bölüm')
  ON CONFLICT (media_id, season_number, episode_number) DO NOTHING;

  -- Check existing reaction
  SELECT reaction INTO v_existing_reaction
  FROM public.episode_reactions
  WHERE user_id = v_uid
    AND media_id = p_media_id
    AND season_number = p_season
    AND episode_number = p_episode;

  IF v_existing_reaction IS NULL THEN
    -- New reaction
    INSERT INTO public.episode_reactions (user_id, media_id, season_number, episode_number, reaction)
    VALUES (v_uid, p_media_id, p_season, p_episode, p_reaction);

    UPDATE public.episodes SET
      react_fire = react_fire + (CASE WHEN p_reaction = 'fire' THEN 1 ELSE 0 END),
      react_cry = react_cry + (CASE WHEN p_reaction = 'cry' THEN 1 ELSE 0 END),
      react_shock = react_shock + (CASE WHEN p_reaction = 'shock' THEN 1 ELSE 0 END)
    WHERE media_id = p_media_id AND season_number = p_season AND episode_number = p_episode;

  ELSIF v_existing_reaction = p_reaction THEN
    -- Toggle off
    DELETE FROM public.episode_reactions
    WHERE user_id = v_uid
      AND media_id = p_media_id
      AND season_number = p_season
      AND episode_number = p_episode;

    UPDATE public.episodes SET
      react_fire = GREATEST(0, react_fire - (CASE WHEN p_reaction = 'fire' THEN 1 ELSE 0 END)),
      react_cry = GREATEST(0, react_cry - (CASE WHEN p_reaction = 'cry' THEN 1 ELSE 0 END)),
      react_shock = GREATEST(0, react_shock - (CASE WHEN p_reaction = 'shock' THEN 1 ELSE 0 END))
    WHERE media_id = p_media_id AND season_number = p_season AND episode_number = p_episode;

  ELSE
    -- Change reaction
    UPDATE public.episode_reactions
    SET reaction = p_reaction, created_at = now()
    WHERE user_id = v_uid
      AND media_id = p_media_id
      AND season_number = p_season
      AND episode_number = p_episode;

    UPDATE public.episodes SET
      react_fire = GREATEST(0, react_fire - (CASE WHEN v_existing_reaction = 'fire' THEN 1 ELSE 0 END) + (CASE WHEN p_reaction = 'fire' THEN 1 ELSE 0 END)),
      react_cry = GREATEST(0, react_cry - (CASE WHEN v_existing_reaction = 'cry' THEN 1 ELSE 0 END) + (CASE WHEN p_reaction = 'cry' THEN 1 ELSE 0 END)),
      react_shock = GREATEST(0, react_shock - (CASE WHEN v_existing_reaction = 'shock' THEN 1 ELSE 0 END) + (CASE WHEN p_reaction = 'shock' THEN 1 ELSE 0 END))
    WHERE media_id = p_media_id AND season_number = p_season AND episode_number = p_episode;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_episode_reaction FROM public, anon;
GRANT EXECUTE ON FUNCTION public.increment_episode_reaction TO authenticated, service_role;

-- ============================================================================
-- 5. COMMENT MODERATION & SECURITY (is_hidden column, triggers)
-- ============================================================================
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

UPDATE public.comments
SET is_hidden = true
WHERE (content_json->>'is_hidden')::boolean IS TRUE;

CREATE OR REPLACE FUNCTION public.prepare_comment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Yorum yazmak için giriş yapmalısınız.';
  END IF;
  NEW.user_id := (SELECT auth.uid());
  IF NOT public.is_admin() THEN
    NEW.is_hidden := false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_prepare_comment_insert
BEFORE INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.prepare_comment_insert();

CREATE OR REPLACE FUNCTION public.protect_comment_moderation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_hidden IS DISTINCT FROM OLD.is_hidden AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkisiz işlem: Yorum gizleme/açma yetkisi sadece yöneticilere aittir.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_protect_comment_moderation
BEFORE UPDATE ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.protect_comment_moderation();

REVOKE EXECUTE ON FUNCTION public.prepare_comment_insert() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_comment_moderation() FROM public, anon, authenticated;

-- ============================================================================
-- 6. REFINED RLS POLICIES (Zero Multiple-Permissive Warnings & Strict Access)
-- ============================================================================

-- media
CREATE POLICY "Public read media" ON public.media FOR SELECT USING (true);
CREATE POLICY "Admin insert media" ON public.media FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admin update media" ON public.media FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin delete media" ON public.media FOR DELETE TO authenticated USING (public.is_admin());

-- episodes
CREATE POLICY "Public read episodes" ON public.episodes FOR SELECT USING (true);
CREATE POLICY "Admin insert episodes" ON public.episodes FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admin update episodes" ON public.episodes FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin delete episodes" ON public.episodes FOR DELETE TO authenticated USING (public.is_admin());

-- people
CREATE POLICY "Public read people" ON public.people FOR SELECT USING (true);
CREATE POLICY "Admin insert people" ON public.people FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admin update people" ON public.people FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin delete people" ON public.people FOR DELETE TO authenticated USING (public.is_admin());

-- media_cast
CREATE POLICY "Public read media_cast" ON public.media_cast FOR SELECT USING (true);
CREATE POLICY "Admin insert media_cast" ON public.media_cast FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admin update media_cast" ON public.media_cast FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin delete media_cast" ON public.media_cast FOR DELETE TO authenticated USING (public.is_admin());

-- media_relations
CREATE POLICY "Public read media_relations" ON public.media_relations FOR SELECT USING (true);
CREATE POLICY "Admin insert media_relations" ON public.media_relations FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admin update media_relations" ON public.media_relations FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin delete media_relations" ON public.media_relations FOR DELETE TO authenticated USING (public.is_admin());

-- magazine_posts
CREATE POLICY "Public read magazine_posts" ON public.magazine_posts FOR SELECT USING (true);
CREATE POLICY "Admin insert magazine_posts" ON public.magazine_posts FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admin update magazine_posts" ON public.magazine_posts FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin delete magazine_posts" ON public.magazine_posts FOR DELETE TO authenticated USING (public.is_admin());

-- broadcast_events
CREATE POLICY "Public read broadcast_events" ON public.broadcast_events FOR SELECT USING (true);
CREATE POLICY "Admin insert broadcast_events" ON public.broadcast_events FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admin update broadcast_events" ON public.broadcast_events FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin delete broadcast_events" ON public.broadcast_events FOR DELETE TO authenticated USING (public.is_admin());

-- scraper_configs
CREATE POLICY "Public read scraper_configs" ON public.scraper_configs FOR SELECT USING (true);
CREATE POLICY "Admin insert scraper_configs" ON public.scraper_configs FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admin update scraper_configs" ON public.scraper_configs FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin delete scraper_configs" ON public.scraper_configs FOR DELETE TO authenticated USING (public.is_admin());

-- calendar_schedules
CREATE POLICY "Public read calendar_schedules" ON public.calendar_schedules FOR SELECT USING (true);
CREATE POLICY "Admin insert calendar_schedules" ON public.calendar_schedules FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admin update calendar_schedules" ON public.calendar_schedules FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin delete calendar_schedules" ON public.calendar_schedules FOR DELETE TO authenticated USING (public.is_admin());

-- profiles
CREATE POLICY "Read public or own profile" ON public.profiles FOR SELECT USING ((NOT is_private) OR (id = (SELECT auth.uid())) OR public.is_admin());
CREATE POLICY "Insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((id = (SELECT auth.uid())) OR public.is_admin()) WITH CHECK ((id = (SELECT auth.uid())) OR public.is_admin());

-- comments
CREATE POLICY "Public read comments" ON public.comments FOR SELECT USING (is_hidden = false OR user_id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "Insert own comments" ON public.comments FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));
CREATE POLICY "Update own or admin comments" ON public.comments FOR UPDATE TO authenticated USING ((user_id = (SELECT auth.uid())) OR public.is_admin()) WITH CHECK ((user_id = (SELECT auth.uid())) OR public.is_admin());
CREATE POLICY "Delete own or admin comments" ON public.comments FOR DELETE TO authenticated USING ((user_id = (SELECT auth.uid())) OR public.is_admin());

-- comment_likes
CREATE POLICY "Public read comment_likes" ON public.comment_likes FOR SELECT USING (true);
CREATE POLICY "Insert own comment_likes" ON public.comment_likes FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Delete own comment_likes" ON public.comment_likes FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- person_favorites
CREATE POLICY "Public read person_favorites" ON public.person_favorites FOR SELECT USING (true);
CREATE POLICY "User insert own person_favorites" ON public.person_favorites FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "User delete own person_favorites" ON public.person_favorites FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- user_follows
CREATE POLICY "Public read user_follows" ON public.user_follows FOR SELECT USING (true);
CREATE POLICY "User insert own user_follows" ON public.user_follows FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "User delete own user_follows" ON public.user_follows FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- user_media_progress
CREATE POLICY "Read allowed progress" ON public.user_media_progress FOR SELECT USING (user_id = (SELECT auth.uid()) OR public.is_admin() OR (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = user_media_progress.user_id AND NOT p.is_private AND NOT p.hide_watch_history)));
CREATE POLICY "User insert own progress" ON public.user_media_progress FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "User update own progress" ON public.user_media_progress FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "User delete own progress" ON public.user_media_progress FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- custom_lists
CREATE POLICY "Read public or own lists" ON public.custom_lists FOR SELECT USING (visibility IN ('public', 'unlisted') OR user_id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "User insert own custom_lists" ON public.custom_lists FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "User update own custom_lists" ON public.custom_lists FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()) OR public.is_admin()) WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "User delete own custom_lists" ON public.custom_lists FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()) OR public.is_admin());

-- user_notifications
CREATE POLICY "Read own notifications" ON public.user_notifications FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Update own notifications" ON public.user_notifications FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Insert notifications" ON public.user_notifications FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR user_id = (SELECT auth.uid()));
CREATE POLICY "Delete notifications" ON public.user_notifications FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()) OR public.is_admin());

-- issue_reports
CREATE POLICY "Read own or admin issue reports" ON public.issue_reports FOR SELECT TO authenticated USING (reporter_id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "Insert issue reports" ON public.issue_reports FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND (reporter_id IS NULL OR reporter_id = (SELECT auth.uid())));
CREATE POLICY "Admin update issue reports" ON public.issue_reports FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin delete issue reports" ON public.issue_reports FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================================
-- 7. PERFORMANCE & FOREIGN KEY INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_comments_is_hidden_created ON public.comments(is_hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_target_created ON public.comments(target_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fk_issue_reports_reporter_id ON public.issue_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_issue_reports_status_created ON public.issue_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_follows_target ON public.user_follows(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_episode_reactions_lookup ON public.episode_reactions(media_id, season_number, episode_number);
CREATE INDEX IF NOT EXISTS idx_media_release_year ON public.media(release_year DESC);
