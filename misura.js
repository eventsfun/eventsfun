/* EventsFun - misurazione anonima delle visite (misura.js v1)
   Nessun cookie, nessun identificativo, nessun testo digitato dai visitatori.
   Invia solo: pagina, passaggio, etichetta ?src=, provenienza generica, mobile/desktop, dettaglio (es. piano cliccato).
   Rispetta Do Not Track e Global Privacy Control. Mai usata su landing.html, dashboard e area personale. */
(function () {
  'use strict';

  var ENDPOINT = 'https://vousendridklswygvqpl.supabase.co/functions/v1/misura';
  var RE = /^[a-z0-9_-]{1,40}$/;
  var memoria = {};

  function ss(k, v) {
    try {
      if (v === undefined) return window.sessionStorage.getItem(k);
      window.sessionStorage.setItem(k, v);
    } catch (e) {
      if (v === undefined) return memoria[k] || null;
      memoria[k] = v;
    }
    return null;
  }

  function rifiutato() {
    try {
      var n = window.navigator || {};
      if (n.doNotTrack === '1' || window.doNotTrack === '1' || n.msDoNotTrack === '1') return true;
      if (n.globalPrivacyControl === true) return true;
      if (n.webdriver === true) return true;
    } catch (e) {}
    return false;
  }

  function pulisci(v) {
    if (v === null || v === undefined) return null;
    v = String(v).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40);
    return RE.test(v) ? v : null;
  }

  function paginaCorrente() {
    var p = window.location.pathname || '/';
    if (/\/demo\.html$/.test(p)) return 'demo';
    if (/^\/guide(\/|$)/.test(p) || /\/alternativa-a-eventbrite\.html$/.test(p)) return 'guide';
    if (p === '/' || /\/index\.html$/.test(p)) return 'home';
    return null;
  }

  function param(nome) {
    try {
      var m = new RegExp('[?&]' + nome + '=([^&#]*)').exec(window.location.search || '');
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  var PAGINA = paginaCorrente();

  /* etichetta del link (?src=): resta solo nella scheda, mai in cookie */
  function srcCorrente() {
    var s = pulisci(param('src'));
    if (s) ss('ef_src', s);
    return s || pulisci(ss('ef_src'));
  }

  /* provenienza generica, calcolata una volta per sessione */
  function provenienza() {
    var salvata = ss('ef_da');
    if (salvata) return salvata;
    var r = '';
    try { r = document.referrer || ''; } catch (e) {}
    var host = '';
    var m = /^https?:\/\/([^\/?#:]+)/i.exec(r);
    if (m) host = m[1].toLowerCase().replace(/^www\./, '');
    var da = 'diretto';
    if (host) {
      if (host === 'eventsfun.com' || /\.eventsfun\.com$/.test(host)) da = 'diretto';
      else if (/(^|\.)(linkedin\.com|lnkd\.in)$/.test(host)) da = 'linkedin';
      else if (/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(host)) da = 'facebook';
      else if (/(^|\.)instagram\.com$/.test(host)) da = 'instagram';
      else if (/(^|\.)tiktok\.com$/.test(host)) da = 'tiktok';
      else if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) da = 'youtube';
      else if (/(^|\.)google\.[a-z.]+$/.test(host)) da = 'google';
      else da = 'altro';
    }
    /* se la prima pagina e' interna (ritorno) non salvo, cosi' non blocco una provenienza reale */
    if (!(host === 'eventsfun.com' || /\.eventsfun\.com$/.test(host))) ss('ef_da', da);
    return da;
  }

  function dispositivo() {
    try {
      if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) return 'mobile';
      if (window.innerWidth && window.innerWidth < 768) return 'mobile';
    } catch (e) {}
    return 'desktop';
  }

  function invia(evento, dettaglio) {
    if (!PAGINA || rifiutato()) return;
    var det = pulisci(dettaglio);
    var chiave = 'ef_m_' + PAGINA + '_' + evento + (det ? '_' + det : '');
    if (ss(chiave)) return; /* una sola volta per sessione: niente doppi conteggi al ricaricamento */
    ss(chiave, '1');
    var corpo = JSON.stringify({
      pagina: PAGINA,
      evento: evento,
      src: srcCorrente(),
      da: provenienza(),
      disp: dispositivo(),
      dettaglio: det
    });
    try {
      if (window.fetch) {
        window.fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: corpo,
          keepalive: true,
          credentials: 'omit'
        }).catch(function () {});
        return;
      }
    } catch (e) {}
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([corpo], { type: 'text/plain;charset=UTF-8' }));
    } catch (e2) {}
  }

  /* piani: riconosciuti dal codice del link di pagamento */
  function pianoDa(href) {
    var m = /buy\.stripe\.com\/[A-Za-z0-9]+(\d{5})(?:[?#].*)?$/.exec(href || '');
    var mappa = {
      '14400': 'base', '14401': 'pro', '14402': 'agenzia-mensile', '14403': 'agenzia-annuale',
      '14406': 'punto-info-mensile', '14407': 'punto-info-annuale'
    };
    return m && mappa[m[1]] ? mappa[m[1]] : 'altro';
  }

  /* passa l'etichetta ?src= ai link verso la demo */
  function propagaSrc() {
    var s = srcCorrente();
    if (!s) return;
    var links = document.getElementsByTagName('a');
    for (var i = 0; i < links.length; i++) {
      var h = links[i].getAttribute('href') || '';
      if (/(^|\/)demo\.html$/.test(h) && h.indexOf('?') < 0) links[i].setAttribute('href', h + '?src=' + s);
    }
  }

  /* link "Vedi i pacchetti" della demo: porta con se' l'etichetta e segnala la provenienza dalla demo */
  function aggiornaLinkPacchetti() {
    var s = srcCorrente() || 'demo';
    var links = document.querySelectorAll('a[data-ef-pacchetti]');
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute('href', 'https://eventsfun.com/?src=' + s + '&via=demo#prezzi');
    }
  }

  function clic(e) {
    var el = e.target;
    while (el && el !== document && !(el.tagName === 'A' || el.tagName === 'BUTTON')) el = el.parentNode;
    if (!el || el === document) return;
    var href = el.getAttribute('href') || '';
    if (el.getAttribute('data-ef-pacchetti') !== null) {
      aggiornaLinkPacchetti();
      invia('clic_invito', el.getAttribute('data-ef-pacchetti') || 'link');
      return;
    }
    if (/buy\.stripe\.com/.test(href) && PAGINA === 'home') {
      invia('clic_acquisto', pianoDa(href));
      return;
    }
    if (/(^|\/)demo\.html(\?|#|$)/.test(href) && (PAGINA === 'home' || PAGINA === 'guide')) {
      invia('clic_demo', null);
    }
  }

  var PASSI_DEMO = { created: 'evento_creato', landing_opened: 'invito_visto', registered: 'iscrizione_prova' };

  window.EFMisura = {
    /* chiamata da demo.html a ogni passo della guida */
    passo: function (id) {
      try { if (PASSI_DEMO[id]) invia(PASSI_DEMO[id], null); } catch (e) {}
    },
    /* chiamata da demo.html quando l'utente preme "Inizia la demo" */
    inizio: function () {
      try { invia('demo_iniziata', null); } catch (e) {}
    }
  };

  function avvio() {
    try {
      if (!PAGINA) return;
      srcCorrente();
      propagaSrc();
      aggiornaLinkPacchetti();
      document.addEventListener('click', clic, true);
      if (PAGINA === 'home') invia('home_vista', param('via') === 'demo' ? 'da_demo' : null);
      else if (PAGINA === 'demo') invia('demo_aperta', null);
      else if (PAGINA === 'guide') invia('guida_vista', null);
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvio);
  else avvio();
})();
