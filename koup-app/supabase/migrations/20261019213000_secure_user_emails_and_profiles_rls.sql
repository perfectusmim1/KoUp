-- Migration: 20261019213000_secure_user_emails_and_profiles_rls.sql
-- Description: Move sensitive user emails to protected user_emails table, strip emails from public.profiles, and allow public profile display metadata to be viewed while hiding private user activity

-- 1. Create protected public.user_emails table
CREATE TABLE IF NOT EXISTS public.user_emails (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User or admin read email" ON public.user_emails;
CREATE POLICY "User or admin read email" ON public.user_emails
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

-- 2. Clear emails from public.profiles
UPDATE public.profiles SET email = NULL WHERE email IS NOT NULL;

-- 3. Update protect_profile_role to verify admin directly from auth.users instead of public.profiles
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    IF NOT EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = NEW.id AND lower(u.email) = 'caganherdil@gmail.com'
    ) THEN
      RAISE EXCEPTION 'Guvenlik engeli: Admin rolu yalnizca caganherdil@gmail.com hesabina atanabilir.';
    END IF;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     AND NOT public.is_admin()
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND coalesce(auth.jwt() ->> 'role', '') != 'service_role' THEN
    RAISE EXCEPTION 'Yetkisiz rol degisikligi: Sadece caganherdil@gmail.com rol degistirebilir.';
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Update handle_new_user to store email only in public.user_emails
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  recent_reg_count INT;
BEGIN
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

  INSERT INTO public.profiles (id, username, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    final_username,
    coalesce(NEW.raw_user_meta_data->>'display_name', base_username),
    NEW.raw_user_meta_data->>'avatar_url',
    'user'
  )
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IS NOT NULL AND NEW.email != '' THEN
    INSERT INTO public.user_emails (user_id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Update profiles SELECT policy so profile metadata is readable, allowing avatar, banner, and private badge to display properly
ALTER POLICY "Read public or own profile" ON public.profiles USING (true);
