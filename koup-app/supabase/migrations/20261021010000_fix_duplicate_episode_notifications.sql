-- Migration: Fix Duplicate Episode Notifications & Prevent Unread Overwrite on Sync
-- 1. Updates handle_new_episode_notification trigger function with:
--    - Ignores unpublished episodes (pending_source, scheduled)
--    - On UPDATE: strictly only fires if transitioning to 'published' from non-published
--    - Deduplication: checks if notification already exists for (user_id, 'new_episode', link_url)

CREATE OR REPLACE FUNCTION public.handle_new_episode_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_media RECORD;
  v_follower RECORD;
  v_link_url TEXT;
BEGIN
  -- 1. Strictly ignore if the episode is NOT published (e.g. pending_source or scheduled)
  IF NEW.status IS DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;

  -- 2. On UPDATE, only trigger if it transitioned from non-published (e.g. pending_source/scheduled) to published
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'published' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 3. Fetch media details
  SELECT id, title, slug, content_type, cover_image
  INTO v_media
  FROM public.media
  WHERE id = NEW.media_id;

  IF v_media.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_link_url := '/seri/' || v_media.slug || '/' || NEW.episode_number;

  -- 4. Find all users following this media in user_follows
  FOR v_follower IN
    SELECT uf.user_id
    FROM public.user_follows uf
    JOIN public.profiles p ON p.id = uf.user_id
    WHERE uf.target_type = 'media'
      AND uf.target_id = NEW.media_id
      AND (p.notification_settings->>'notify_new_episode' IS NULL 
           OR (p.notification_settings->>'notify_new_episode')::boolean = true)
  LOOP
    -- 5. Deduplication: Strictly ensure a notification was NOT already sent to this user for this specific episode
    IF NOT EXISTS (
      SELECT 1 FROM public.user_notifications
      WHERE user_id = v_follower.user_id
        AND type = 'new_episode'
        AND link_url = v_link_url
    ) THEN
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
        v_link_url,
        v_media.cover_image,
        false,
        clock_timestamp() + (COALESCE(NEW.episode_number, 1) * interval '10 milliseconds')
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_episode_notification ON public.episodes;
CREATE TRIGGER trg_new_episode_notification
AFTER INSERT OR UPDATE OF status ON public.episodes
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_episode_notification();
