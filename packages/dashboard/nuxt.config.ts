export default defineNuxtConfig({
  srcDir: 'app/',
  ssr: false,
  devtools: { enabled: true },

  app: {
    head: {
      title: 'Claude HQ',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },

  css: [
    'vuetify/styles',
    '@mdi/font/css/materialdesignicons.css',
  ],

  build: {
    transpile: ['vuetify'],
  },

  modules: [
    '@pinia/nuxt',
  ],

  runtimeConfig: {
    public: {
      hubWsUrl: process.env.NUXT_PUBLIC_HUB_WS_URL || 'ws://localhost:7700',
    },
  },

  // Proxy HTTP requests to Hub in dev mode
  routeRules: {
    '/api/**': { proxy: 'http://localhost:7700/api/**' },
    '/hooks/**': { proxy: 'http://localhost:7700/hooks/**' },
    '/health': { proxy: 'http://localhost:7700/health' },
  },

  compatibilityDate: '2025-01-01',
});
