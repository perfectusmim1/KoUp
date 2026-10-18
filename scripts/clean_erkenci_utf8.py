# -*- coding: utf-8 -*-
import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
c = conn.cursor()

# Set clean UTF-8
c.execute("UPDATE dramas SET title = ? WHERE id = 31860", ("Erkenci Kuş",))
for ep_num in range(1, 52):
    c.execute("UPDATE episodes SET episode_name = ? WHERE drama_id = 31860 AND episode_number = ?", (f"Bölüm {ep_num}", ep_num))

conn.commit()
conn.close()
print("Successfully updated Erkenci Kuş and all 51 episodes with clean UTF-8 names!")
