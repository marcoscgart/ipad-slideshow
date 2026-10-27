/* Configuração da página. Usado pela página e pelo service worker. */
self.SLIDESHOW_CONFIG = {
  // URL do seu Worker (troque depois do "wrangler deploy")
  workerUrl: 'https://icloud-slideshow.marcoscgart.workers.dev/',
  // Versão do cache offline: aumente ao publicar mudanças na página
  // (e mude também a linha "# vN" em offline.appcache)
  cacheVersion: 'v9'
};
