-- 1. Ensure caganherdil@gmail.com has admin role
UPDATE public.profiles
SET role = 'admin'
WHERE lower(email) = 'caganherdil@gmail.com';

-- 2. Delete all demo custom lists
DELETE FROM public.custom_lists
WHERE user_id != (SELECT id FROM public.profiles WHERE lower(email) = 'caganherdil@gmail.com');

-- 3. Delete all demo profiles
DELETE FROM public.profiles
WHERE lower(email) != 'caganherdil@gmail.com';

-- 4. Delete all demo auth users
DELETE FROM auth.users
WHERE lower(email) != 'caganherdil@gmail.com';

-- 5. Lock protect_profile_role trigger so ONLY caganherdil@gmail.com can EVER have role = 'admin'
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.role = 'admin' AND lower(coalesce(NEW.email, '')) != 'caganherdil@gmail.com' THEN
    RAISE EXCEPTION 'Guvenlik engeli: Admin rolu yalnizca caganherdil@gmail.com hesabina atanabilir.';
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

-- 6. Lock grant_admin_by_email RPC
CREATE OR REPLACE FUNCTION public.grant_admin_by_email(target_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF lower(trim(target_email)) != 'caganherdil@gmail.com' THEN
    RAISE EXCEPTION 'Guvenlik engeli: Admin rolu baska bir hesaba verilemez.';
  END IF;
  UPDATE public.profiles SET role = 'admin' WHERE lower(email) = 'caganherdil@gmail.com';
  RETURN true;
END;
$$;
