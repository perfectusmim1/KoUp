import re

with open('scripts/supabase_dedup_and_fix.sql', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract all IDs from DELETE FROM media WHERE id IN (...)
chunks = []
for line in content.splitlines():
    if line.startswith('DELETE FROM media WHERE id IN ('):
        m = re.search(r'\((.*?)\)', line)
        if m:
            id_list = [int(x.strip()) for x in m.group(1).split(',') if x.strip()]
            chunks.append(id_list)

print(f"Total chunks found: {len(chunks)}")
for idx, ch in enumerate(chunks):
    print(f"Chunk {idx+1}: {len(ch)} IDs (e.g. {ch[:5]}...)")

# Generate SQL queries using SELECT delete_ghost_media_batch
with open('scripts/call_batch_deletes.sql', 'w', encoding='utf-8') as f:
    for idx, ch in enumerate(chunks):
        ids_str = ','.join(map(str, ch))
        f.write(f"SELECT delete_ghost_media_batch(ARRAY[{ids_str}]::bigint[]);\n")

print("Generated scripts/call_batch_deletes.sql successfully!")
