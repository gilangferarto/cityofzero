// City of Zero: copies the Instagram follower count of @thecityofzero into Firestore town/stats.
// Runs on GitHub Actions (see .github/workflows/instagram.yml). Needs two repository secrets:
//   IG_TOKEN                 long-lived Instagram token (only needed the first time; after that the
//                            refreshed token is kept in Firestore private/instagram, which no visitor can read)
//   FIREBASE_SERVICE_ACCOUNT the service-account JSON from Firebase (Project settings > Service accounts)
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing or not valid JSON.');
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const keep = db.doc('private/instagram');

const saved = (await keep.get()).data() || {};
let token = saved.token || process.env.IG_TOKEN;
if (!token) throw new Error('No Instagram token. Add the IG_TOKEN secret.');

// Long-lived tokens last 60 days. Refresh about once a week so it never runs out.
const age = saved.refreshed ? (Date.now() - saved.refreshed.toMillis()) / 864e5 : 99;
if (age > 7) {
  const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
  const j = await r.json();
  if (j.access_token) { token = j.access_token; await keep.set({ token, refreshed: FieldValue.serverTimestamp(), expiresInDays: Math.round((j.expires_in || 0) / 86400) }, { merge: true }); console.log('Token refreshed.'); }
  else console.warn('Token refresh failed:', JSON.stringify(j.error || j));
}

const r = await fetch(`https://graph.instagram.com/me?fields=username,followers_count&access_token=${encodeURIComponent(token)}`);
const me = await r.json();
if (typeof me.followers_count !== 'number') throw new Error('Instagram did not return a follower count: ' + JSON.stringify(me.error || me));
await db.doc('town/stats').set({ followers: me.followers_count, updated: FieldValue.serverTimestamp(), source: 'instagram' }, { merge: true });
console.log(`@${me.username}: ${me.followers_count} followers saved to town/stats.`);
