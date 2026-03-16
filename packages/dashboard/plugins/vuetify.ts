import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';

export default defineNuxtPlugin((nuxtApp) => {
  const vuetify = createVuetify({
    components,
    directives,
    theme: {
      defaultTheme: 'dark',
      themes: {
        dark: {
          dark: true,
          colors: {
            primary: '#7C4DFF',
            secondary: '#448AFF',
            accent: '#FF6D00',
            background: '#121212',
            surface: '#1E1E1E',
            'surface-variant': '#2A2A2A',
            error: '#CF6679',
            success: '#4CAF50',
            warning: '#FB8C00',
            info: '#2196F3',
          },
        },
        light: {
          dark: false,
          colors: {
            primary: '#651FFF',
            secondary: '#2979FF',
            accent: '#FF6D00',
            background: '#FAFAFA',
            surface: '#FFFFFF',
            error: '#B00020',
            success: '#4CAF50',
            warning: '#FB8C00',
            info: '#2196F3',
          },
        },
      },
    },
    defaults: {
      VCard: { elevation: 2, rounded: 'lg' },
      VBtn: { rounded: 'lg' },
      VTextField: { variant: 'outlined', density: 'comfortable' },
      VSelect: { variant: 'outlined', density: 'comfortable' },
      VDataTable: { density: 'comfortable' },
    },
  });

  nuxtApp.vueApp.use(vuetify);
});
