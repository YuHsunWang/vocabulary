const CACHE_NAME = 'toeic-master-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/static/js/bundle.js', // 根據你的打包路徑可能有所不同
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});