/* =====================================================================
   Hyrrä-portaali — Integraatiot-näkymä (jaettu admin.html & asiakas.html)
   ---------------------------------------------------------------------
   Rakentaa kategorioittain ryhmitellyn "Integraatiot"-näkymän ja kytkee
   sen backendin Edge Functioneihin window.Hyrra.callFn():n kautta.

   ENDPOINTIT (backend):
     integration-list      POST {customer_id} → [{category,provider,status,account_label,config}]
     calendar-connect      POST {customer_id, provider} → { auth_url }
     calendar-disconnect   POST {customer_id, provider}
     integration-save      POST {customer_id, category, provider, config?, secret?} → { provider, status }

   TIETOTURVA: salaisuudet näytetään aina peitettynä (•••). Vain käyttäjän
   syöttämä uusi arvo lähetetään (secret). Tallennettua ei koskaan näytetä.

   CRM hoidetaan EDELLEEN customers.crm_* :n kautta (update-customer-config)
   — ks. crmSection-callback, jonka isäntäsivu antaa. Tämä moduuli ei riko
   olemassa olevaa CRM-osaa.
   ===================================================================== */
window.HyrraIntegrations = (function () {
  const H = window.Hyrra;
  const esc = H.esc;

  /* ---------- Tilan suomennokset + pilleri ---------- */
  function statusFi(s) {
    return ({
      connected: 'Yhdistetty',
      pending:   'Ei yhdistetty',
      error:     'Virhe',
      disabled:  'Pois käytöstä',
      requires_api: 'Vaatii API-pääsyn'
    })[s] || 'Ei yhdistetty';
  }
  function statusPill(s) {
    const cls = s === 'connected' ? 'good'
      : (s === 'error' ? 'warn'
      : (s === 'requires_api' ? 'locked'
      : 'pending'));
    const txt = s === 'connected' ? 'Yhdistetty ✓' : statusFi(s);
    return '<span class="pill ' + cls + '">' + esc(txt) + '</span>';
  }

  /* ---------- Katalogi: kategoriat, providerit, kentät ---------- */
  // field: { key, label, secret?, hint?, placeholder? }
  const CATEGORIES = [
    {
      key: 'calendar', title: 'Kalenteri',
      sub: 'Hyrrä varaa ajat suoraan kalenteriisi.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      providers: [
        { provider: 'google',    name: 'Google Calendar', kind: 'oauth' },
        { provider: 'microsoft', name: 'Microsoft 365',   kind: 'oauth' },
        { provider: 'ical',      name: 'iCal / CalDAV',    kind: 'form',
          fields: [
            { key: 'url',      label: 'CalDAV-URL',  placeholder: 'https://…/dav/' },
            { key: 'username', label: 'Käyttäjä' },
            { key: 'password', label: 'Salasana', secret: true }
          ]
        }
      ]
    },
    {
      key: 'booking', title: 'Varausjärjestelmät',
      sub: 'Synkronoi ajanvaraukset olemassa olevaan järjestelmääsi.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
      providers: [
        { provider: 'timma',  name: 'Timma',  kind: 'form', requiresApi: true,
          fields: [{ key: 'account', label: 'Tilitunnus' }, { key: 'api_key', label: 'API-avain', secret: true }] },
        { provider: 'vello',  name: 'Vello',  kind: 'form', requiresApi: true,
          fields: [{ key: 'account', label: 'Tilitunnus' }, { key: 'api_key', label: 'API-avain', secret: true }] },
        { provider: 'diarium', name: 'Diarium', kind: 'form', requiresApi: true,
          fields: [{ key: 'account', label: 'Tilitunnus' }, { key: 'api_key', label: 'API-avain', secret: true }] },
        { provider: 'slotti', name: 'Slotti', kind: 'form', requiresApi: true,
          fields: [{ key: 'account', label: 'Tilitunnus' }, { key: 'api_key', label: 'API-avain', secret: true }] },
        { provider: 'provet', name: 'Provet Cloud', kind: 'form', requiresApi: true,
          fields: [{ key: 'instance', label: 'Instanssi / aliverkkotunnus' }, { key: 'api_key', label: 'API-avain', secret: true }] }
      ]
    },
    {
      key: 'messaging', title: 'Viestintä',
      sub: 'Ilmoitukset ja vahvistukset eri kanaviin.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      providers: [
        { provider: 'telegram', name: 'Telegram', kind: 'form',
          fields: [
            { key: 'bot_token', label: 'Bot-token', secret: true, hint: 'BotFatherilta saatu token.' },
            { key: 'chat_id',   label: 'Chat-ID', hint: 'Ryhmän tai henkilön chat-id, johon ilmoitukset lähetetään.' }
          ] },
        { provider: 'whatsapp', name: 'WhatsApp Business', kind: 'form', requiresApi: true,
          fields: [
            { key: 'phone_number_id', label: 'Phone number ID' },
            { key: 'access_token',    label: 'Access token', secret: true }
          ] },
        { provider: 'sms',   name: 'SMS', kind: 'builtin',
          note: 'SMS-vahvistukset hallitaan asetuksista. Käytössä Hyrrän numeron kautta.' },
        { provider: 'email', name: 'Sähköposti', kind: 'builtin',
          note: 'Sähköposti-ilmoitukset hoidetaan Hyrrän kautta. Pohjat löytyvät ylläpidosta.' }
      ]
    },
    {
      key: 'finance', title: 'Talous',
      sub: 'Yhdistä taloushallinto laskutusta ja kirjanpitoa varten.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
      providers: [
        { provider: 'holvi', name: 'Holvi', kind: 'form', requiresApi: true,
          fields: [
            { key: 'business_id', label: 'Y-tunnus / Business ID' },
            { key: 'api_key',     label: 'API-avain', secret: true }
          ] }
      ]
    },
    {
      key: 'webhook', title: 'Webhook / oma järjestelmä',
      sub: 'Lähetä tapahtumat omaan järjestelmääsi geneerisesti.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13a4 4 0 0 1-4 4H7a4 4 0 0 1 0-8"/><path d="M6 11a4 4 0 0 1 4-4h7a4 4 0 0 1 0 8"/></svg>',
      providers: [
        { provider: 'webhook', name: 'Geneerinen webhook', kind: 'form',
          fields: [
            { key: 'url',    label: 'Webhook-URL', placeholder: 'https://…' },
            { key: 'secret_token', label: 'Allekirjoitusavain (valinn.)', secret: true, hint: 'Jos haluat, että Hyrrä allekirjoittaa pyynnöt.' }
          ] }
      ]
    }
  ];

  /* ---------- Tila per (customer): integraatiolista ---------- */
  // map "category|provider" → { status, account_label, config }
  function indexList(list) {
    const idx = {};
    (list || []).forEach(it => { idx[it.category + '|' + it.provider] = it; });
    return idx;
  }

  /* ---------- Yhden providerin kortti ---------- */
  function providerCard(cat, p, existing) {
    const status = existing ? existing.status : (p.requiresApi ? 'requires_api' : 'pending');
    const cfg = (existing && existing.config) || {};
    const label = existing && existing.account_label ? existing.account_label : '';
    const reqClass = (p.requiresApi && status !== 'connected') ? ' req' : '';
    const cid = cat.key + '__' + p.provider;

    let inner = '';
    if (p.kind === 'oauth') {
      inner =
        '<div class="ic-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-intg-oauth="' + esc(p.provider) + '">Yhdistä ' + esc(p.name.split(' ')[0]) + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-intg-check="1">Tarkista tila</button>' +
          (status === 'connected'
            ? '<button type="button" class="btn btn-danger btn-sm" data-intg-disc="' + esc(p.provider) + '">Katkaise</button>'
            : '') +
        '</div>';
    } else if (p.kind === 'builtin') {
      inner = '<div class="ic-note">' + esc(p.note || '') + '</div>';
    } else { // form
      inner =
        '<div class="ic-fields">' +
          (p.fields || []).map(f => {
            const hasSaved = f.secret && cfg && (cfg['_has_' + f.key] || (existing && existing.status === 'connected'));
            const ph = f.secret
              ? (hasSaved ? '••• (tallennettu — jätä tyhjäksi säilyttääksesi)' : (f.placeholder || ''))
              : (f.placeholder || '');
            const val = f.secret ? '' : esc(cfg[f.key] != null ? cfg[f.key] : '');
            return '<div class="field">' +
              '<label>' + esc(f.label) + '</label>' +
              '<input class="input" data-fkey="' + esc(f.key) + '"' +
                (f.secret ? ' type="password" autocomplete="new-password"' : '') +
                ' value="' + val + '" placeholder="' + esc(ph) + '">' +
              (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="ic-actions">' +
          '<button type="button" class="btn btn-deep btn-sm" data-intg-save="1">Tallenna</button>' +
          (status === 'connected'
            ? '<button type="button" class="btn btn-danger btn-sm" data-intg-clear="1">Poista</button>'
            : '') +
          (p.requiresApi ? '<span class="ic-note">Vaatii API-pääsyn — aktivoidaan kun rajapinta on saatavilla.</span>' : '') +
        '</div>';
    }

    return '<div class="intg-card' + reqClass + '" data-intg-card="' + esc(cid) +
        '" data-cat="' + esc(cat.key) + '" data-prov="' + esc(p.provider) + '" data-kind="' + esc(p.kind) + '">' +
      '<div class="intg-card-h">' +
        '<div><div class="ic-name">' + esc(p.name) + '</div>' +
          (label ? '<div class="ic-meta">' + esc(label) + '</div>' : '') + '</div>' +
        statusPill(status) +
      '</div>' +
      inner +
      '<div class="banner err" data-intg-err style="display:none"></div>' +
    '</div>';
  }

  /* ---------- Yhden kategorian ryhmä ---------- */
  function categoryGroup(cat, idx, opts) {
    // CRM-kategoria renderöidään isäntäsivun callbackilla (säilyttää vanhan toiminnan)
    let cards = cat.providers.map(p => providerCard(cat, p, idx[cat.key + '|' + p.provider])).join('');
    return '<div class="intg-group" data-intg-group="' + esc(cat.key) + '">' +
      '<div class="intg-group-h"><span class="ig-ico">' + cat.icon + '</span>' +
        '<div><h3>' + esc(cat.title) + '</h3><div class="ig-sub">' + esc(cat.sub) + '</div></div></div>' +
      '<div class="intg-grid">' + cards + '</div>' +
    '</div>';
  }

  /* ---------- Pääfunktio: rakenna näkymä containeriin ---------- */
  // opts: { customerId, crmHtml?, onCrmBind?(rootEl), onStatusChange?(idx) }
  function render(container, opts) {
    opts = opts || {};
    const cid = opts.customerId;
    if (!cid) { container.innerHTML = '<div class="empty">Asiakasta ei valittu.</div>'; return; }

    container.innerHTML = '<div class="empty"><span class="spinner" style="border-color:rgba(15,61,62,.3);border-top-color:var(--deep)"></span> Ladataan integraatioita…</div>';

    H.callFn('integration-list', { customer_id: cid })
      .then(list => paint(container, cid, list, opts))
      .catch(err => {
        // Listaus voi epäonnistua jos backend ei vielä valmis → näytä silti kortit tyhjällä tilalla
        paint(container, cid, [], opts);
        const w = document.createElement('div');
        w.className = 'banner info';
        w.style.marginTop = '4px';
        w.innerHTML = '<span class="ico">ℹ︎</span> Integraatioiden tilaa ei voitu hakea juuri nyt (' + esc(err.message) + '). Kortit näkyvät, toiminnot toimivat kun backend vastaa.';
        container.insertBefore(w, container.firstChild);
      });
  }

  function paint(container, cid, list, opts) {
    const idx = indexList(list);
    let html = '';
    CATEGORIES.forEach(cat => {
      html += categoryGroup(cat, idx, opts);
      // CRM-ryhmä lisätään kalenterin & varausjärjestelmien jälkeen, ennen viestintää
      if (cat.key === 'booking' && opts.crmHtml) {
        html += '<div class="intg-group" data-intg-group="crm">' +
          '<div class="intg-group-h"><span class="ig-ico">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
          '</span><div><h3>CRM</h3><div class="ig-sub">Varaukset ja puhelut asiakkaan CRM-järjestelmään.</div></div></div>' +
          '<div data-crm-host>' + opts.crmHtml + '</div>' +
        '</div>';
      }
    });
    container.innerHTML = html;

    // Sido CRM-isäntä (säilyttää vanhan logiikan)
    if (opts.crmHtml && typeof opts.onCrmBind === 'function') {
      opts.onCrmBind(container.querySelector('[data-crm-host]'));
    }

    bindCards(container, cid, opts);
    if (typeof opts.onStatusChange === 'function') opts.onStatusChange(idx);
  }

  /* ---------- Korttien tapahtumat ---------- */
  function bindCards(container, cid, opts) {
    container.querySelectorAll('[data-intg-card]').forEach(card => {
      const cat = card.dataset.cat, prov = card.dataset.prov;
      const errBox = card.querySelector('[data-intg-err]');
      const showErr = (msg) => { errBox.innerHTML = '<span class="ico">✕</span> ' + esc(msg); errBox.style.display = 'flex'; };
      const clrErr = () => { errBox.style.display = 'none'; };

      // OAuth: Yhdistä
      const oauthBtn = card.querySelector('[data-intg-oauth]');
      if (oauthBtn) oauthBtn.addEventListener('click', () => {
        clrErr();
        const orig = oauthBtn.textContent; oauthBtn.disabled = true;
        oauthBtn.innerHTML = '<span class="spinner"></span> Avataan…';
        H.callFn('calendar-connect', { customer_id: cid, provider: prov })
          .then(res => {
            const u = res && res.auth_url;
            if (u) window.open(u, '_blank', 'noopener');
            else throw new Error('Auth-linkkiä ei saatu.');
          })
          .catch(e => showErr('Yhdistäminen epäonnistui: ' + e.message))
          .finally(() => { oauthBtn.disabled = false; oauthBtn.textContent = orig; });
      });

      // OAuth: Tarkista tila (hakee listan uudestaan)
      const checkBtn = card.querySelector('[data-intg-check]');
      if (checkBtn) checkBtn.addEventListener('click', () => {
        clrErr();
        const orig = checkBtn.textContent; checkBtn.disabled = true;
        checkBtn.innerHTML = '<span class="spinner"></span> Tarkistetaan…';
        H.callFn('integration-list', { customer_id: cid })
          .then(list => paint(container, cid, list, opts))
          .catch(e => { showErr('Tilan tarkistus epäonnistui: ' + e.message); checkBtn.disabled = false; checkBtn.textContent = orig; });
      });

      // OAuth: Katkaise
      const discBtn = card.querySelector('[data-intg-disc]');
      if (discBtn) discBtn.addEventListener('click', () => {
        clrErr();
        if (!confirm('Katkaistaanko kalenteriyhteys (' + prov + ')?')) return;
        const orig = discBtn.textContent; discBtn.disabled = true;
        discBtn.innerHTML = '<span class="spinner"></span> Katkaistaan…';
        H.callFn('calendar-disconnect', { customer_id: cid, provider: prov })
          .then(() => H.callFn('integration-list', { customer_id: cid }))
          .then(list => paint(container, cid, list, opts))
          .catch(e => { showErr('Katkaisu epäonnistui: ' + e.message); discBtn.disabled = false; discBtn.textContent = orig; });
      });

      // Form: Tallenna
      const saveBtn = card.querySelector('[data-intg-save]');
      if (saveBtn) saveBtn.addEventListener('click', () => {
        clrErr();
        const config = {}; let secret = null;
        card.querySelectorAll('[data-fkey]').forEach(inp => {
          const v = inp.value.trim();
          const isSecret = inp.type === 'password';
          if (!v) return;                                  // tyhjä = säilytä nykyinen (etenkin salaisuus)
          if (isSecret) { secret = secret || {}; secret[inp.dataset.fkey] = v; }
          else config[inp.dataset.fkey] = v;
        });
        const body = { customer_id: cid, category: cat, provider: prov };
        if (Object.keys(config).length) body.config = config;
        if (secret) body.secret = secret;                  // VAIN uudet käyttäjän syöttämät salaisuudet
        const orig = saveBtn.textContent; saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner"></span> Tallennetaan…';
        H.callFn('integration-save', body)
          .then(() => H.callFn('integration-list', { customer_id: cid }))
          .then(list => paint(container, cid, list, opts))
          .catch(e => { showErr('Tallennus epäonnistui: ' + e.message); saveBtn.disabled = false; saveBtn.textContent = orig; });
      });

      // Form: Poista (asettaa disabled-tilan tallentamalla tyhjän + status)
      const clearBtn = card.querySelector('[data-intg-clear]');
      if (clearBtn) clearBtn.addEventListener('click', () => {
        clrErr();
        if (!confirm('Poistetaanko integraatio (' + prov + ')?')) return;
        const orig = clearBtn.textContent; clearBtn.disabled = true;
        clearBtn.innerHTML = '<span class="spinner"></span> Poistetaan…';
        H.callFn('integration-save', { customer_id: cid, category: cat, provider: prov, config: { _disable: true } })
          .then(() => H.callFn('integration-list', { customer_id: cid }))
          .then(list => paint(container, cid, list, opts))
          .catch(e => { showErr('Poisto epäonnistui: ' + e.message); clearBtn.disabled = false; clearBtn.textContent = orig; });
      });
    });
  }

  /* ---------- Apuri: koonti checklistiä varten ---------- */
  function summary(idx) {
    const cal = idx['calendar|google'] || idx['calendar|microsoft'] || idx['calendar|ical'];
    const calConnected =
      (idx['calendar|google'] && idx['calendar|google'].status === 'connected') ||
      (idx['calendar|microsoft'] && idx['calendar|microsoft'].status === 'connected') ||
      (idx['calendar|ical'] && idx['calendar|ical'].status === 'connected');
    return { calendarConnected: !!calConnected };
  }

  return { CATEGORIES, render, statusFi, statusPill, summary };
})();
