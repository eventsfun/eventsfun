/* EventsFun | Gestionale | service worker v1 04/10/2026
   Serve SOLO alle notifiche push del gestionale e a renderlo installabile come app.
   Ambito limitato al gestionale (registrato con scope "gestionale"): non tocca il resto del sito.
   NON tiene copie delle pagine: ogni apertura scarica la versione aggiornata dal sito. */
'use strict';

self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(ev){ ev.waitUntil(self.clients.claim()); });

function indirizzo(rel){
  try{ return new URL(rel || 'gestionale.html', self.location.href).href; }
  catch(e){ return new URL('gestionale.html', self.location.href).href; }
}

self.addEventListener('push', function(ev){
  var d = {};
  try{ d = ev.data ? ev.data.json() : {}; }
  catch(e){ d = { body: ev.data ? ev.data.text() : '' }; }
  var titolo = String(d.title || 'Gestionale EventsFun');
  var opzioni = {
    body: String(d.body || ''),
    icon: indirizzo('gestionale-icona-192.png'),
    badge: indirizzo('gestionale-badge-96.png'),
    lang: 'it',
    data: { url: indirizzo(d.url) }
  };
  if(d.tag){ opzioni.tag = String(d.tag); opzioni.renotify = true; }
  ev.waitUntil(self.registration.showNotification(titolo, opzioni));
});

self.addEventListener('notificationclick', function(ev){
  ev.notification.close();
  var url = (ev.notification.data && ev.notification.data.url) || indirizzo('gestionale.html');
  var base = url.split('#')[0];
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(lista){
    for(var i = 0; i < lista.length; i++){
      var c = lista[i];
      if(c.url.split('#')[0] === base){
        // gestionale gia' aperto: lo porta davanti e gli dice dove andare (e di aggiornare i dati)
        try{ c.postMessage({ tipo: 'apri', url: url }); }catch(e){}
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
