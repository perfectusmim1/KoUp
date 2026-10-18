-- Add image_url column to user_notifications if not exists
ALTER TABLE public.user_notifications ADD COLUMN IF NOT EXISTS image_url text;

-- 1. Clean up junk self-notifications
DELETE FROM public.user_notifications
WHERE title IN ('Yanıtınız Gönderildi', 'Yorumun Yayınlandı', 'Yanıtın Gönderildi')
   OR title ILIKE '%yorumun yayınlandı%'
   OR title ILIKE '%yanıtınız gönderildi%'
   OR title ILIKE '%yanıtın gönderildi%';

-- 2. Comment reply notification trigger function
CREATE OR REPLACE FUNCTION public.handle_comment_reply_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent RECORD;
  v_author_name text;
  v_author_avatar text;
  v_link text;
  v_media_slug text;
  v_person_slug text;
  v_post_slug text;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, user_id, target_type, media_id, season_number, episode_number, person_id, magazine_id
  INTO v_parent
  FROM public.comments
  WHERE id = NEW.parent_id;

  IF v_parent.id IS NULL OR v_parent.user_id IS NULL OR v_parent.user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  v_author_name := COALESCE(NEW.author_username, 'Bir kullanıcı');
  v_author_avatar := NEW.author_avatar;

  IF v_author_avatar IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT avatar_url INTO v_author_avatar FROM public.profiles WHERE id = NEW.user_id;
  END IF;

  v_link := '/bildirimler';
  IF v_parent.media_id IS NOT NULL THEN
    SELECT slug INTO v_media_slug FROM public.media WHERE id = v_parent.media_id;
    IF v_media_slug IS NOT NULL THEN
      IF v_parent.episode_number IS NOT NULL AND v_parent.episode_number > 0 THEN
        v_link := '/seri/' || v_media_slug || '/' || v_parent.episode_number;
      ELSE
        v_link := '/seri/' || v_media_slug;
      END IF;
    END IF;
  ELSIF v_parent.person_id IS NOT NULL THEN
    SELECT slug INTO v_person_slug FROM public.people WHERE id = v_parent.person_id;
    IF v_person_slug IS NOT NULL THEN
      v_link := '/oyuncu/' || v_person_slug;
    END IF;
  ELSIF v_parent.magazine_id IS NOT NULL THEN
    SELECT slug INTO v_post_slug FROM public.magazine_posts WHERE id = v_parent.magazine_id;
    IF v_post_slug IS NOT NULL THEN
      v_link := '/magazin/' || v_post_slug;
    END IF;
  END IF;

  INSERT INTO public.user_notifications (
    user_id,
    type,
    title,
    body,
    link_url,
    image_url,
    is_read,
    created_at
  ) VALUES (
    v_parent.user_id,
    'comment_reply',
    'Yorumunuza Yanıt Geldi',
    '@' || v_author_name || ' yorumunuza yanıt verdi.',
    v_link,
    v_author_avatar,
    false,
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comment_reply_notification ON public.comments;
CREATE TRIGGER trg_comment_reply_notification
AFTER INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.handle_comment_reply_notification();


-- 3. New episode notification trigger function for series followers
CREATE OR REPLACE FUNCTION public.handle_new_episode_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_media RECORD;
  v_follower RECORD;
BEGIN
  -- Fetch media details including cover_image
  SELECT id, title, slug, content_type, cover_image
  INTO v_media
  FROM public.media
  WHERE id = NEW.media_id;

  IF v_media.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find all users following this media in user_follows
  FOR v_follower IN
    SELECT uf.user_id
    FROM public.user_follows uf
    JOIN public.profiles p ON p.id = uf.user_id
    WHERE uf.target_type = 'media'
      AND uf.target_id = NEW.media_id
      AND (p.notification_settings->>'notify_new_episode' IS NULL 
           OR (p.notification_settings->>'notify_new_episode')::boolean = true)
  LOOP
    INSERT INTO public.user_notifications (
      user_id,
      type,
      title,
      body,
      link_url,
      image_url,
      is_read,
      created_at
    ) VALUES (
      v_follower.user_id,
      'new_episode',
      v_media.title || ' • Yeni Bölüm!',
      v_media.title || ' ' || COALESCE(NEW.season_number, 1) || '. Sezon ' || NEW.episode_number || '. Bölüm eklendi.',
      '/seri/' || v_media.slug || '/' || NEW.episode_number,
      v_media.cover_image,
      false,
      now()
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_episode_notification ON public.episodes;
CREATE TRIGGER trg_new_episode_notification
AFTER INSERT ON public.episodes
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_episode_notification();


-- 4. Followed actor in new project notification trigger function
CREATE OR REPLACE FUNCTION public.handle_actor_new_media_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person RECORD;
  v_media RECORD;
  v_follower RECORD;
BEGIN
  -- Fetch person details including image_url
  SELECT id, name, slug, image_url
  INTO v_person
  FROM public.people
  WHERE id = NEW.person_id;

  -- Fetch media details including cover_image
  SELECT id, title, slug, content_type, cover_image
  INTO v_media
  FROM public.media
  WHERE id = NEW.media_id;

  IF v_person.id IS NULL OR v_media.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Notify all users following this person in user_follows or person_favorites
  FOR v_follower IN
    SELECT DISTINCT u.user_id
    FROM (
      SELECT user_id FROM public.user_follows WHERE target_type = 'person' AND target_id = NEW.person_id
      UNION
      SELECT user_id FROM public.person_favorites WHERE person_id = NEW.person_id
    ) u
    JOIN public.profiles p ON p.id = u.user_id
    WHERE (p.notification_settings->>'notify_followed_actor' IS NULL 
           OR (p.notification_settings->>'notify_followed_actor')::boolean = true)
  LOOP
    INSERT INTO public.user_notifications (
      user_id,
      type,
      title,
      body,
      link_url,
      image_url,
      is_read,
      created_at
    ) VALUES (
      v_follower.user_id,
      'actor_update',
      v_person.name || ' • Yeni Proje!',
      v_person.name || ', yeni yapım "' || v_media.title || '" kadrosuna katıldı.',
      '/seri/' || v_media.slug,
      COALESCE(v_person.image_url, v_media.cover_image),
      false,
      now()
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_actor_new_media_notification ON public.media_cast;
CREATE TRIGGER trg_actor_new_media_notification
AFTER INSERT ON public.media_cast
FOR EACH ROW
EXECUTE FUNCTION public.handle_actor_new_media_notification();
