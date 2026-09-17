/* =====================================================================
   Hyrrä-hallintaportaali — Konfiguraatio + Supabase-client + helperit
   ---------------------------------------------------------------------
   SELAIMESSA VAIN: Supabase URL + anon-avain. EI muita salaisuuksia.
   Kaikki kolmansien rajapintakutsut (provisiointi, export, lataus, poisto)
   tehdään Edge Functioneja kutsumalla — ks. callFn().
   ===================================================================== */

/* >>> TÄYTÄ NÄMÄ DEPLOYISSA <<<
   Löytyy: Supabase Studio → Project Settings → API.
   anon-avain on julkinen (RLS suojaa datan) — ei salainen.            */
window.HYRRA_CONFIG = {
  SUPABASE_URL:      'https://snalhrhaetbyikkugwvh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_ScLA1roxkUZrUrRt6Uk1Ug_D366sIoV'
};

/* ---------------------------------------------------------------------
   Supabase-clientin init (supabase-js ladataan CDN:stä HTML-sivulla
   ennen tätä tiedostoa: window.supabase.createClient).
   --------------------------------------------------------------------- */
window.SB = (function () {
  if (!window.supabase || !window.supabase.createClient) {
    console.error('supabase-js ei ole ladattu. Lisää CDN-script ennen config.js:ää.');
    return null;
  }
  return window.supabase.createClient(
    window.HYRRA_CONFIG.SUPABASE_URL,
    window.HYRRA_CONFIG.SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
  );
})();

/* =====================================================================
   HELPERIT
   ===================================================================== */
window.Hyrra = (function () {
  const SB = window.SB;
  const CFG = window.HYRRA_CONFIG;

  /* --- Istunnon pakottaminen: ohjaa kirjautumiseen jos ei sessiota --- */
  async function requireSession(redirect = 'kirjautuminen.html') {
    if (!SB) { location.href = redirect; return null; }
    const { data, error } = await SB.auth.getSession();
    if (error || !data || !data.session) { location.href = redirect; return null; }
    return data.session;
  }

  /* --- Profiilin lataus (rooli + customer_id) --- */
  async function loadProfile() {
    const { data: u } = await SB.auth.getUser();
    if (!u || !u.user) return null;
    const { data, error } = await SB
      .from('profiles')
      .select('id, email, name, role, customer_id')
      .eq('id', u.user.id)
      .single();
    if (error) { console.error('loadProfile', error); return null; }
    return data;
  }

  /* --- Edge Function -kutsu (Authorization: Bearer <jwt>) ---
     GET: callFn('download-transcript', null, { method:'GET', query:{call_id, format} })
     POST: callFn('provision-customer', { ...body })                       */
  async function callFn(name, body, opts = {}) {
    const { data: s } = await SB.auth.getSession();
    const token = s && s.session ? s.session.access_token : '';
    const method = opts.method || (body ? 'POST' : 'GET');
    let url = `${CFG.SUPABASE_URL}/functions/v1/${name}`;
    if (opts.query) {
      const q = new URLSearchParams(opts.query).toString();
      if (q) url += `?${q}`;
    }
    const headers = {
      'Authorization': `Bearer ${token}`,
      'apikey': CFG.SUPABASE_ANON_KEY
    };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const raw = opts.raw === true;
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); msg = j.error || j.message || msg; } catch (e) {}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    if (raw) return res;                                   // esim. tiedostolataus blobina
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  async function logout() {
    try { await SB.auth.signOut(); } catch (e) {}
    location.href = 'kirjautuminen.html';
  }

  /* =================== FMT-funktiot =================== */
  const OUTCOME_FI = {
    varaus_tehty:        'Varaus tehty',
    hinta_annettu:       'Hinta annettu',
    ohjattu_yrittajalle: 'Ohjattu yrittäjälle',
    ei_vastattu:         'Ei vastattu',
    peruutus:            'Peruutus',
    tiedustelu:          'Tiedustelu',
    muu:                 'Muu'
  };
  /* Vastatuksi lasketaan kaikki paitsi 'ei_vastattu'. */
  const ANSWERED_OK = (oc) => oc && oc !== 'ei_vastattu';

  const STATUS_FI = { pilotti:'Pilotti', aktiivinen:'Aktiivinen', paussi:'Paussilla', poistettu:'Poistettu' };
  const SUBSTATUS_FI = { trialing:'Kokeilujakso', active:'Aktiivinen', past_due:'Maksu myöhässä', canceled:'Päättynyt', paused:'Tauolla' };
  const INVSTATUS_FI = { maksettu:'Maksettu', avoinna:'Avoinna', myohassa:'Myöhässä', peruutettu:'Peruutettu' };

  function outcomeFi(oc){ return OUTCOME_FI[oc] || (oc || '—'); }
  function statusFi(s){ return STATUS_FI[s] || (s || '—'); }
  function subStatusFi(s){ return SUBSTATUS_FI[s] || (s || '—'); }
  function invStatusFi(s){ return INVSTATUS_FI[s] || (s || '—'); }

  function fmtDateTime(iso){
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('fi-FI', { day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function fmtDate(iso){
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('fi-FI', { day:'numeric', month:'numeric', year:'numeric' });
  }
  function fmtTime(t){
    if (!t) return '';
    return String(t).slice(0,5);
  }
  function fmtDuration(sec){
    if (sec == null) return '—';
    const m = Math.floor(sec/60), s = sec % 60;
    return m > 0 ? `${m} min ${s} s` : `${s} s`;
  }
  function fmtDurShort(sec){
    if (sec == null) return '—';
    const m = Math.floor(sec/60), s = sec % 60;
    return `${m}:${String(s).padStart(2,'0')}`;
  }
  function fmtEur(n){
    if (n == null) return '—';
    return new Intl.NumberFormat('fi-FI').format(n) + ' €';
  }
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }
  function startOfWeek(d = new Date()){
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7;          // ma=0
    x.setHours(0,0,0,0); x.setDate(x.getDate() - day);
    return x;
  }
  function downloadText(filename, text, mime = 'text/plain'){
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function downloadBlob(filename, blob){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return {
    SB, CFG,
    requireSession, loadProfile, callFn, logout,
    OUTCOME_FI, ANSWERED_OK,
    outcomeFi, statusFi, subStatusFi, invStatusFi,
    fmtDateTime, fmtDate, fmtTime, fmtDuration, fmtDurShort, fmtEur,
    esc, startOfWeek, downloadText, downloadBlob
  };
})();
