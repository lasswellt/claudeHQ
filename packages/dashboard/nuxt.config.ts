export default defineNuxtConfig({
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

  compatibilityDate: '2025-01-01',
});
