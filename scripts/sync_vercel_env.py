import subprocess
import os

def parse_env(path):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"\'')
    return env

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(root_dir, 'koup-app', '.env.local')
    app_dir = os.path.join(root_dir, 'koup-app')
    config = parse_env(env_path)
    print(f"Syncing {len(config)} environment variables to Vercel...")

    keys_to_sync = [
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'TMDB_API_KEY',
        'R2_PUBLIC_URL',
        'CF_ACCOUNT_ID',
        'CF_R2_BUCKET',
        'CF_R2_ACCESS_KEY_ID',
        'CF_R2_SECRET_ACCESS_KEY',
        'CF_R2_ENDPOINT',
        'CF_API_TOKEN',
    ]

    for k in keys_to_sync:
        v = config.get(k)
        if not v:
            continue
        env_target = 'production'
        type_flag = '--type config' if k.startswith('NEXT_PUBLIC_') else ''
        cmd = f'echo {v} | npx -y vercel env add {k} {env_target} {type_flag}'
        p = subprocess.run(cmd, shell=True, text=True, capture_output=True, cwd=app_dir)
        out = (p.stdout + p.stderr).strip()
        if 'already exists' in out:
            print(f"  = {k} ({env_target}) already exists")
        elif 'Added' in out:
            print(f"  + Added {k} ({env_target})")
        else:
            print(f"  ! {k} ({env_target}): {out[:80]}")

    print("Vercel environment variables sync completed (production only).")

if __name__ == '__main__':
    main()
