// ══════════════════════════════════════
// Service Worker — Agendamento de Notebooks
// v3 — index.html NUNCA é cacheado
//      (sempre pega versão mais recente do Vercel)
// ══════════════════════════════════════

const CACHE_NAME = "notebooks-v17";

// Só cacheia assets que mudam raramente (fontes, css, ícones)
// index.html é EXCLUÍDO propositalmente
const ASSETS_ESTATICOS = [
  "/style.css",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "https://fonts.googleapis.com/css2?family=Architects+Daughter&family=DM+Sans:ital,wght@0,400;0,600;0,700;0,800;1,400&family=DM+Mono:wght@500;600&display=swap"
];

// ── Mensagens da página (SKIP_WAITING para forçar update) ──
self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Instalação ──
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        ASSETS_ESTATICOS.map(url => cache.add(url).catch(() => {}))
      )
    )
  );
});

// ── Ativação: limpa caches antigos ──
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ──
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // index.html — SEMPRE rede, nunca cache
  // Garante que o app sempre carrega a versão mais recente
  if (url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/index.html").then(c => c || new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // API do backend — sempre rede
  if (url.hostname.includes("onrender.com")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ erro: "Sem conexão. Verifique sua internet." }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    return;
  }

  // Google Sign-In — sempre rede
  if (url.hostname.includes("accounts.google.com") || url.hostname.includes("googleapis.com")) {
    event.respondWith(fetch(event.request).catch(() => new Response("", { status: 503 })));
    return;
  }

  // CSS — rede primeiro (garante atualização visual após deploy)
  if (url.pathname.endsWith(".css") || url.search.includes("table-fix")) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Demais assets (fontes, ícones) — cache first, fallback rede
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== "opaque") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
