import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

function friendly(error) {
  const msg = error?.message || String(error);
  if (/Database error saving new user|EMAIL_NOT_ON_ROSTER/i.test(msg)) {
    return new Error('This email is not on the roster yet. Ask your coach to add you, then try again.');
  }
  if (/Invalid login credentials/i.test(msg)) return new Error('Wrong email or password.');
  if (/already registered/i.test(msg)) return new Error('This email already has an account. Sign in, or reset your password.');
  if (/Email not confirmed/i.test(msg)) return new Error('Check your inbox and confirm your email first.');
  return new Error(msg);
}

export function createSupabaseApi(url, key) {
  const sb = createClient(url, key);
  const run = async (promise) => {
    const { data, error } = await promise;
    if (error) throw friendly(error);
    return data;
  };
  // Supabase returns at most 1000 rows per request, so page through big reads.
  const all = async (build) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = await run(build().range(from, from + 999));
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  };
  const baseUrl = () => location.origin + location.pathname;

  return {
    mode: 'live',

    async getSession() {
      const { data } = await sb.auth.getSession();
      return data.session;
    },
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((event, session) => cb(event, session));
    },
    async signIn(email, password) {
      await run(sb.auth.signInWithPassword({ email, password }));
    },
    async activate(email, password) {
      const data = await run(sb.auth.signUp({ email, password, options: { emailRedirectTo: baseUrl() } }));
      return { needsConfirm: !data.session };
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async sendReset(email) {
      await run(sb.auth.resetPasswordForEmail(email, { redirectTo: baseUrl() }));
    },
    async updatePassword(password) {
      await run(sb.auth.updateUser({ password }));
    },

    async me() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return null;
      await sb.rpc('link_my_account');
      const rows = await run(sb.from('students').select('*').eq('user_id', user.id));
      return rows[0] ?? null;
    },

    listBatches: () => run(sb.from('batches').select('*').order('start_date')),
    saveBatch: (b) => run(sb.from('batches').upsert(b).select().single()),
    deleteBatch: (id) => run(sb.from('batches').delete().eq('id', id)),

    listStudents: () => run(sb.from('students').select('*').order('full_name')),
    saveStudent: (s) => run(sb.from('students').upsert(s).select().single()),
    addStudents: (rows) => run(sb.from('students').insert(rows).select()),
    deleteStudent: (id) => run(sb.from('students').delete().eq('id', id)),

    listTradingDays: () => run(sb.from('trading_days').select('*')),
    saveTradingDay: (row) => run(sb.from('trading_days').upsert({ ...row, source: 'manual' }).select().single()),
    async syncForexFactory() {
      const data = await run(sb.functions.invoke('ff-sync', { body: {} }));
      if (!data?.ok) throw new Error(data?.error || 'Forex Factory sync failed');
      return data;
    },
    deleteTradingDay: (date) => run(sb.from('trading_days').delete().eq('date', date)),

    myCheckIns: (studentId) =>
      all(() => sb.from('check_ins').select('*').eq('student_id', studentId).order('date')),
    listCheckIns: (from, to) =>
      all(() => sb.from('check_ins').select('*').gte('date', from).lte('date', to).order('date').order('id')),
    async saveCheckIn(row) {
      const payload = { ...row };
      if (payload.id) payload.edited_at = new Date().toISOString();
      else delete payload.id;
      return run(sb.from('check_ins').upsert(payload, { onConflict: 'student_id,date' }).select().single());
    },
    deleteCheckIn: (id) => run(sb.from('check_ins').delete().eq('id', id)),

    cohortRoster: () => run(sb.rpc('cohort_roster')),
    cohortMarks: (from, to) =>
      all(() => sb.rpc('cohort_marks', { from_date: from, to_date: to }).order('date').order('student_id')),

    listChallenges: () => run(sb.from('challenges').select('*').order('start_date')),
    saveChallenge: (c) => run(sb.from('challenges').upsert(c).select().single()),
    deleteChallenge: (id) => run(sb.from('challenges').delete().eq('id', id)),

    // Prize winners. A student sees only their own rows; the admin sees all.
    listWinners: (challengeId) => run(sb.from('challenge_winners').select('*').eq('challenge_id', challengeId)),
    winnerList: (challengeId) => run(sb.rpc('challenge_winner_list', { ch_id: challengeId })),
    claimPrize: (id, prop_firm, prop_email) =>
      run(sb.from('challenge_winners').update({ prop_firm, prop_email }).eq('id', id).select().single()),
    setPrizeSent: (id, sent) =>
      run(sb.from('challenge_winners').update({ prize_sent_at: sent ? new Date().toISOString() : null }).eq('id', id).select().single()),
    finalizeChallengeNow: (id) => run(sb.rpc('finalize_challenge_now', { ch_id: id })),

    listReflections: () => run(sb.from('reflections').select('*').order('created_at', { ascending: false })),
    saveReflection: (r) =>
      run(sb.from('reflections').upsert(r, { onConflict: 'student_id,challenge_id' }).select().single()),

    async reviewCheckIn(id, coach_status, coach_note) {
      return run(sb.from('check_ins')
        .update({ coach_status, coach_note: coach_note || null, reviewed_at: coach_status ? new Date().toISOString() : null })
        .eq('id', id).select().single());
    },

    async getRulebook(studentId, month) {
      const rows = await run(sb.from('rulebooks').select('*').eq('student_id', studentId).eq('month', month));
      return rows[0] ?? null;
    },
    listRulebooks: (studentId) => run(sb.from('rulebooks').select('*').eq('student_id', studentId).order('month')),
    listAllRulebooks: (month) => run(sb.from('rulebooks').select('*').eq('month', month)),
    async saveRulebook(r) {
      const payload = { ...r };
      if (payload.id) payload.updated_at = new Date().toISOString();
      else delete payload.id;
      return run(sb.from('rulebooks').upsert(payload, { onConflict: 'student_id,month' }).select().single());
    },

    listTrades: (studentId, from, to) =>
      all(() => sb.from('trade_posts').select('*').eq('student_id', studentId).gte('date', from).lte('date', to).order('date').order('id')),
    listAllTrades: (from, to) =>
      all(() => sb.from('trade_posts').select('*').gte('date', from).lte('date', to).order('date').order('id')),
    async saveTrade(t) {
      const payload = { ...t };
      if (payload.id) payload.edited_at = new Date().toISOString();
      else delete payload.id;
      return run(sb.from('trade_posts').upsert(payload).select().single());
    },
    deleteTrade: (id) => run(sb.from('trade_posts').delete().eq('id', id)),

    async uploadExecution(studentId, blob) {
      const path = `${studentId}/${crypto.randomUUID()}.jpg`;
      await run(sb.storage.from('executions').upload(path, blob, { contentType: blob.type || 'image/jpeg' }));
      return path;
    },
    async imageUrl(path) {
      const data = await run(sb.storage.from('executions').createSignedUrl(path, 3600));
      return data.signedUrl;
    },
    deleteImage: (path) => run(sb.storage.from('executions').remove([path])),

    async getSettings() {
      const rows = await run(sb.from('app_settings').select('*').eq('id', 1));
      return rows[0] ?? { id: 1, followup_threshold: 2, inactive_days: 3 };
    },
    saveSettings: (s) => run(sb.from('app_settings').upsert({ ...s, id: 1 }).select().single()),
  };
}
