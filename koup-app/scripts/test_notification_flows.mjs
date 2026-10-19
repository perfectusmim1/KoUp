import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aocvcotmikzlwbaezdpl.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjEzOTY1MSwiZXhwIjoyMTA3NzE1NjUxfQ.K78fnOdpdiZiZHxT_Yy80cTWsdFCHP2uDLMrpfL1Ceg';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runTests() {
  console.log('=== KOUP NOTIFICATION AUTOMATION TEST SUITE ===');

  // Step 1: Ensure 2 test accounts exist
  const emailA = 'test_tester_a_notif@koup.test';
  const emailB = 'test_tester_b_notif@koup.test';
  const password = 'TestPassword123!';

  console.log('\n[1/5] Setting up 2 test user accounts...');
  
  async function getOrCreateUser(email, username) {
    const { data: listData } = await supabase.auth.admin.listUsers();
    const existing = listData?.users?.find((u) => u.email === email);
    if (existing) {
      console.log(`  - Found existing user: ${email} (${existing.id})`);
      return existing;
    }

    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, display_name: username },
    });

    if (error) throw error;
    console.log(`  - Created new test user: ${email} (${created.user.id})`);
    
    // Ensure profile row exists
    await supabase.from('profiles').upsert({
      id: created.user.id,
      username,
      display_name: username,
      role: 'user',
    });

    return created.user;
  }

  const userA = await getOrCreateUser(emailA, 'notif_tester_a');
  const userB = await getOrCreateUser(emailB, 'notif_tester_b');

  // Authenticate clients for both test users to simulate real app sessions
  const clientA = createClient(SUPABASE_URL, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk');
  const { error: loginAErr } = await clientA.auth.signInWithPassword({ email: emailA, password });
  if (loginAErr) throw loginAErr;

  const clientB = createClient(SUPABASE_URL, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk');
  const { error: loginBErr } = await clientB.auth.signInWithPassword({ email: emailB, password });
  if (loginBErr) throw loginBErr;
  console.log('  - Both test clients logged in successfully with user sessions.');

  // Clean previous test notifications for clean slate
  await supabase.from('user_notifications').delete().in('user_id', [userA.id, userB.id]);
  await supabase.from('user_follows').delete().in('user_id', [userA.id, userB.id]);
  await supabase.from('person_favorites').delete().in('user_id', [userA.id, userB.id]);

  console.log('  Cleaned existing test state for users A and B.');

  // Pick or create test media and test person
  const { data: mediaRows } = await supabase.from('media').select('id, title, slug').limit(1);
  const testMedia = mediaRows[0];
  console.log(`  Using Media for test: "${testMedia.title}" (ID: ${testMedia.id}, Slug: ${testMedia.slug})`);

  const { data: personRows } = await supabase.from('people').select('id, name, slug').limit(1);
  const testPerson = personRows[0];
  console.log(`  Using Person for test: "${testPerson.name}" (ID: ${testPerson.id}, Slug: ${testPerson.slug})`);

  let allPassed = true;

  // =========================================================================
  // TEST SCENARIO 1: COMMENT REPLY NOTIFICATION
  // =========================================================================
  console.log('\n[2/5] TEST 1: Comment Reply Notification');
  console.log('  - User A posts root comment...');
  const { data: parentComment, error: commentAErr } = await clientA.from('comments').insert({
    target_type: 'media',
    media_id: testMedia.id,
    author_username: 'notif_tester_a',
    content_html: 'Bu dizi gerçekten harika! Kesinlikle tavsiye ederim.',
  }).select().single();

  if (commentAErr) throw commentAErr;
  console.log(`  - Root comment created: ${parentComment.id}`);

  console.log('  - User B replies to User A comment...');
  const { data: replyComment, error: replyErr } = await clientB.from('comments').insert({
    target_type: 'media',
    media_id: testMedia.id,
    parent_id: parentComment.id,
    author_username: 'notif_tester_b',
    content_html: '@notif_tester_a Sana kesinlikle katılıyorum!',
  }).select().single();

  if (replyErr) throw replyErr;
  console.log(`  - Reply comment created: ${replyComment.id}`);

  // Small delay for DB trigger execution
  await new Promise((r) => setTimeout(r, 600));

  const { data: notifsA_test1 } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('user_id', userA.id)
    .eq('type', 'comment_reply');

  const { data: notifsB_test1 } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('user_id', userB.id)
    .eq('type', 'comment_reply');

  const replyNotif = notifsA_test1?.[0];
  if (replyNotif && replyNotif.title.includes('Yanıt')) {
    console.log(`  [PASS] User A received reply notification: "${replyNotif.title}" - "${replyNotif.body}" (Link: ${replyNotif.link_url})`);
  } else {
    console.error('  [FAIL] User A did NOT receive comment_reply notification!');
    allPassed = false;
  }

  if (!notifsB_test1 || notifsB_test1.length === 0) {
    console.log('  [PASS] User B (sender) did NOT receive self-notification.');
  } else {
    console.error('  [FAIL] User B incorrectly received self-notification!');
    allPassed = false;
  }

  // =========================================================================
  // TEST SCENARIO 2: NEW EPISODE NOTIFICATION FOR MEDIA FOLLOWERS
  // =========================================================================
  console.log('\n[3/5] TEST 2: New Episode Notification (Series Follower)');
  console.log('  - Setting User A to follow media via toggle_user_follow RPC...');
  await clientA.rpc('toggle_user_follow', {
    p_user_id: userA.id,
    p_target_type: 'media',
    p_target_id: testMedia.id,
  });

  const testSeason = 99;
  const testEpNum = 88;

  // Cleanup any old test episode
  await supabase.from('episodes').delete().match({ media_id: testMedia.id, season_number: testSeason, episode_number: testEpNum });

  console.log(`  - Inserting new episode S${testSeason} E${testEpNum} (status: published)...`);
  const { data: episodeRow, error: epErr } = await supabase.from('episodes').insert({
    media_id: testMedia.id,
    season_number: testSeason,
    episode_number: testEpNum,
    episode_name: `${testEpNum}. Bölüm (Test Yayını)`,
    status: 'published',
  }).select().single();

  if (epErr) throw epErr;
  console.log(`  - Episode inserted: ${episodeRow.id}`);

  await new Promise((r) => setTimeout(r, 600));

  const { data: notifsA_test2 } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('user_id', userA.id)
    .eq('type', 'new_episode');

  const { data: notifsB_test2 } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('user_id', userB.id)
    .eq('type', 'new_episode');

  const epNotif = notifsA_test2?.[0];
  if (epNotif && epNotif.link_url?.includes(String(testEpNum))) {
    console.log(`  [PASS] User A received new_episode notification: "${epNotif.title}" - "${epNotif.body}" (Link: ${epNotif.link_url})`);
  } else {
    console.error('  [FAIL] User A did NOT receive new_episode notification!');
    allPassed = false;
  }

  if (!notifsB_test2 || notifsB_test2.length === 0) {
    console.log('  [PASS] User B (non-follower) did NOT receive new_episode notification.');
  } else {
    console.error('  [FAIL] User B incorrectly received episode notification!');
    allPassed = false;
  }

  // =========================================================================
  // TEST SCENARIO 3: ACTOR NEW SERIES / PROJECT NOTIFICATION
  // (CRITICAL REQUIREMENT: Follower gets notified; Mere Favorite does NOT get notified!)
  // =========================================================================
  console.log('\n[4/5] TEST 3: Actor New Project Notification (Follow vs Favorite)');
  console.log(`  - Setting User A to FOLLOW actor "${testPerson.name}" via toggle_user_follow RPC...`);
  await clientA.rpc('toggle_user_follow', {
    p_user_id: userA.id,
    p_target_type: 'person',
    p_target_id: testPerson.id,
  });

  console.log(`  - Setting User B to ONLY FAVORITE actor "${testPerson.name}" in person_favorites (no follow)...`);
  await clientB.from('person_favorites').insert({
    user_id: userB.id,
    person_id: testPerson.id,
  });

  // Create a brand new test media series for this actor
  const testDramaSlug = `test-series-for-actor-${Date.now()}`;
  console.log(`  - Creating a new media project: "${testDramaSlug}"...`);
  const { data: newMedia, error: newMediaErr } = await supabase.from('media').insert({
    title: 'Harika Yeni K-Drama',
    title_tr: 'Harika Yeni K-Drama',
    slug: testDramaSlug,
    content_type: 'dizi',
  }).select().single();

  if (newMediaErr) throw newMediaErr;
  console.log(`  - Created test media ID: ${newMedia.id}`);

  console.log(`  - Adding actor "${testPerson.name}" to the new series cast (media_cast)...`);
  const { data: castRow, error: castErr } = await supabase.from('media_cast').insert({
    media_id: newMedia.id,
    person_id: testPerson.id,
    role_type: 'lead',
    character_name: 'Başrol Karakteri',
  }).select().single();

  if (castErr) throw castErr;
  console.log('  - Added cast member row to media_cast.');

  await new Promise((r) => setTimeout(r, 600));

  const { data: notifsA_test3 } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('user_id', userA.id)
    .eq('type', 'actor_update');

  const { data: notifsB_test3 } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('user_id', userB.id)
    .eq('type', 'actor_update');

  const actorNotif = notifsA_test3?.[0];
  if (actorNotif && actorNotif.title.includes(testPerson.name)) {
    console.log(`  [PASS] User A (FOLLOWER) received actor update notification: "${actorNotif.title}" - "${actorNotif.body}" (Link: ${actorNotif.link_url})`);
  } else {
    console.error('  [FAIL] User A (FOLLOWER) did NOT receive actor_update notification!');
    allPassed = false;
  }

  if (!notifsB_test3 || notifsB_test3.length === 0) {
    console.log('  [PASS] User B (FAVORITE ONLY) did NOT receive notification (as intended: favorite = like, follow = notification)!');
  } else {
    console.error('  [FAIL] User B (only favorite) unexpectedly received notification! Favoriting must not trigger notifications.');
    allPassed = false;
  }

  // =========================================================================
  // CLEANUP TEST DATA
  // =========================================================================
  console.log('\n[5/5] Cleaning up test artifacts...');
  try {
    if (replyComment?.id) await supabase.from('comments').delete().eq('id', replyComment.id);
    if (parentComment?.id) await supabase.from('comments').delete().eq('id', parentComment.id);
    await supabase.from('episodes').delete().match({ media_id: testMedia.id, season_number: testSeason, episode_number: testEpNum });
    if (newMedia?.id) {
      await supabase.from('media_cast').delete().eq('media_id', newMedia.id);
      await supabase.from('media').delete().eq('id', newMedia.id);
    }
    await supabase.from('user_notifications').delete().in('user_id', [userA.id, userB.id]);
    await supabase.from('user_follows').delete().in('user_id', [userA.id, userB.id]);
    await supabase.from('person_favorites').delete().in('user_id', [userA.id, userB.id]);
    console.log('  Test artifacts cleaned up successfully.');
  } catch (cleanErr) {
    console.warn('  Cleanup warning:', cleanErr.message);
  }

  console.log('\n=================================================');
  if (allPassed) {
    console.log('ALL NOTIFICATION TESTS PASSED SUCCESSFULLY! (3/3)');
  } else {
    console.log('SOME TESTS FAILED! Check error logs above.');
  }
  console.log('=================================================\n');
}

runTests().catch((err) => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
