// City of Zero: copies the Instagram follower count of @thecityofzero into Firestore town/stats.
// Runs on GitHub Actions (.github/workflows/instagram.yml). Repository secrets:
//   IG_TOKEN                 Instagram token from the Meta app (either an Instagram user token "IG…",
//                            or a long-lived system-user token "EAA…" from the Unified-login setup)
//   FIREBASE_SERVICE_ACCOUNT service-account JSON from Firebase (Project settings > Service accounts)
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const IG_USER_ID = '17841462167930061';   // @thecityofzero
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing or not valid JSON.');
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const keep = db.doc('private/instagram');

const clean = (t) => String(t || '').replace(/^\s*(IG_TOKEN\s*=\s*)?["']?|["']?\s*$/g, '').replace(/\s+/g, '');
const saved = (await keep.get()).data() || {};
const secret = clean(process.env.IG_TOKEN);
// a new IG_TOKEN secret always wins over the copy kept in Firestore
let token = secret && secret !== saved.from ? secret : clean(saved.token) || secret;
if (!token) throw new Error('No Instagram token. Add the IG_TOKEN secret.');
console.log(`Token type: ${token.slice(0, 3)}…, length ${token.length}`);
const get = async (u) => (await fetch(u)).json();

let count, user;
if (token.startsWith('EAA')) {                       // Facebook / system-user token: never expires
  const r = await get(`https://graph.facebook.com/v21.0/${IG_USER_ID}?fields=username,followers_count&access_token=${encodeURIComponent(token)}`);
  if (typeof r.followers_count !== 'number') throw new Error('Graph API: ' + JSON.stringify(r.error || r));
  count = r.followers_count; user = r.username;
} else {                                             // Instagram-login token: lasts 60 days, refresh weekly
  const age = saved.refreshed ? (Date.now() - saved.refreshed.toMillis()) / 864e5 : 99;
  if (age > 7) {
    const j = await get(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
    if (j.access_token) { token = j.access_token; await keep.set({ token, from: secret, refreshed: FieldValue.serverTimestamp() }, { merge: true }); console.log('Token refreshed.'); }
    else console.warn('Token refresh skipped:', JSON.stringify(j.error || j));
  }
  const r = await get(`https://graph.instagram.com/me?fields=username,followers_count&access_token=${encodeURIComponent(token)}`);
  if (typeof r.followers_count !== 'number') throw new Error('Instagram API: ' + JSON.stringify(r.error || r));
  count = r.followers_count; user = r.username;
}
await db.doc('town/stats').set({ followers: count, updated: FieldValue.serverTimestamp(), source: 'instagram' }, { merge: true });
console.log(`@${user}: ${count} followers saved to town/stats.`);
