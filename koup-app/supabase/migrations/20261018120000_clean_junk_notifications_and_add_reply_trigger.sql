-- 1. Clean up junk self-notifications
DELETE FROM public.user_notifications
WHERE title IN ('Yanıtınız Gönderildi', 'Yorumun Yayınlandı', 'Yanıtın Gönderildi')
   OR title ILIKE '%yorumun yayınlandı%'
   OR title ILIKE '%yanıtınız gönderildi%'
   OR title ILIKE '%yanıtın gönderildi%';

-- 2. Create comment reply notification trigger function
CREATE OR REPLACE FUNCTION public.handle_comment_reply_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent RECORD;
  v_author_name text;
  v_link text;
  v_media_slug text;
  v_person_slug text;
  v_post_slug text;
BEGIN
  -- Only execute when this comment is a reply (parent_id is set)
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch parent comment details
  SELECT id, user_id, target_type, media_id, season_number, episode_number, person_id, magazine_id
  INTO v_parent
  FROM public.comments
  WHERE id = NEW.parent_id;

  -- If parent comment does not exist or user replied to their own comment, do nothing
  IF v_parent.id IS NULL OR v_parent.user_id IS NULL OR v_parent.user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Determine display name of the replier
  v_author_name := COALESCE(NEW.author_username, 'Bir kullanıcı');

  -- Generate destination link
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

  -- Insert notification for the parent comment owner
  INSERT INTO public.user_notifications (
    user_id,
    type,
    title,
    body,
    link_url,
    is_read,
    created_at
  ) VALUES (
    v_parent.user_id,
    'comment_reply',
    'Yorumunuza Yanıt Geldi',
    '@' || v_author_name || ' yorumunuza yanıt verdi.',
    v_link,
    false,
    now()
  );

  RETURN NEW;
END;
$$;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trg_comment_reply_notification ON public.comments;
CREATE TRIGGER trg_comment_reply_notification
AFTER INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.handle_comment_reply_notification();
