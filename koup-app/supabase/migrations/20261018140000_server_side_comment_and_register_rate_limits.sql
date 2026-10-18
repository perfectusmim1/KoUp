-- ============================================================================
-- Migration: 20261018140000_server_side_comment_and_register_rate_limits.sql
-- Description: Server-side anti-spam enforcement for comments & registration
-- ============================================================================

-- 1. Anti-spam rate limit on comments (Max 15/hour per user, 10s flood cooldown)
CREATE OR REPLACE FUNCTION public.prepare_comment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_hourly_count int;
  v_last_created timestamptz;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Yorum yazmak için giriş yapmalısınız.';
  END IF;
  NEW.user_id := v_uid;
  
  IF NOT public.is_admin() THEN
    NEW.is_hidden := false;

    -- Anti-spam hourly rate limit: Maximum 15 comments per hour
    SELECT COUNT(*), MAX(created_at)
    INTO v_hourly_count, v_last_created
    FROM public.comments
    WHERE user_id = v_uid
      AND created_at > (NOW() - INTERVAL '1 hour');

    IF v_hourly_count >= 15 THEN
      RAISE EXCEPTION 'Saatlik yorum sınırına ulaştınız (15 yorum/saat). Lütfen daha sonra tekrar deneyin.';
    END IF;

    -- Anti-spam flood cooldown: Minimum 10 seconds between comments
    IF v_last_created IS NOT NULL AND v_last_created > (NOW() - INTERVAL '10 seconds') THEN
      RAISE EXCEPTION 'Çok hızlı yorum gönderiyorsunuz. Lütfen en az 10 saniye bekleyin.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Anti-bot / flood rate limit on user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  base_username TEXT;
  final_username TEXT;
  recent_reg_count INT;
BEGIN
  -- Anti-bot / Anti-spam flood rate limit: Max 10 new registrations per 2 minutes
  SELECT COUNT(*) INTO recent_reg_count 
  FROM public.profiles 
  WHERE created_at > (NOW() - INTERVAL '2 minutes');

  IF recent_reg_count >= 10 THEN
    RAISE EXCEPTION 'Sistem yoğunluğu veya çok fazla kayıt denemesi. Lütfen birkaç dakika bekleyip tekrar deneyin.';
  END IF;

  base_username := coalesce(
    NEW.raw_user_meta_data->>'username',
    regexp_replace(split_part(coalesce(NEW.email, 'user'), '@', 1), '[^a-zA-Z0-9_]', '', 'g')
  );
  base_username := regexp_replace(base_username, '[^a-zA-Z0-9_]', '', 'g');
  IF char_length(base_username) < 3 THEN
    base_username := 'koup_' || substr(NEW.id::text, 1, 6);
  END IF;
  IF char_length(base_username) > 28 THEN
    base_username := substr(base_username, 1, 28);
  END IF;

  final_username := base_username;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) THEN
    final_username := base_username || '_' || substr(NEW.id::text, 1, 4);
  END IF;

  INSERT INTO public.profiles (id, username, display_name, avatar_url, role, email)
  VALUES (
    NEW.id,
    final_username,
    coalesce(NEW.raw_user_meta_data->>'display_name', base_username),
    NEW.raw_user_meta_data->>'avatar_url',
    'user',
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET 
    email = EXCLUDED.email;
  RETURN NEW;
END;
$function$;
