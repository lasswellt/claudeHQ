---
globs: "packages/dashboard/**/*.{ts,vue}"
---
# Nuxt 3 Patterns

- Pages use `definePageMeta({ layout: 'default' })` for layout selection
- Components use `<script setup lang="ts">` — no Options API, no `defineComponent()`
- Props: `defineProps<{ sessionId: string }>()` — fully typed, no `any`
- Emits: `defineEmits<{ (e: 'close'): void }>()` — typed events
- Composables follow `useXxx` naming and return `{ data, loading, error }` shape
- Pinia stores use setup syntax: `defineStore('sessions', () => { ... })`
- SPA mode (`ssr: false`) — no server-side rendering concerns
- Vuetify 3 components preferred: VCard, VDataTable, VDialog, VBtn, VSnackbar, VSkeletonLoader
- Every data view handles three states: loading (VSkeletonLoader), empty (VAlert), error (VAlert + retry)
- Use Vuetify's utility classes for spacing/layout (e.g., `pa-4`, `ma-2`, `d-flex`)
- Theme: use Vuetify's `createVuetify({ theme: { ... } })` for dark/light mode
