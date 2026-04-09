<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTheme } from 'vuetify';
import NotificationFeed from '../components/notifications/NotificationFeed.vue';
import { useWebSocket } from '../composables/useWebSocket';
import { useBrowserNotifications } from '../composables/useBrowserNotifications';

const drawer = ref(true);
const theme = useTheme();

// HI-05: bind the sidebar connection chip to the real WS state.
const ws = useWebSocket();
// CAP-032: subscribe to browser notifications for incoming approvals.
const browserNotifications = useBrowserNotifications();
const chipColor = computed(() => {
  switch (ws.state.value) {
    case 'connected':
      return 'success';
    case 'connecting':
      return 'warning';
    case 'disconnected':
    case 'error':
    default:
      return 'error';
  }
});
const chipLabel = computed(() => {
  switch (ws.state.value) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'error':
      return 'Error';
    case 'disconnected':
    default:
      return 'Disconnected';
  }
});

const navItems = [
  { title: 'Overview', icon: 'mdi-view-dashboard', to: '/' },
  { title: 'Jobs', icon: 'mdi-briefcase-outline', to: '/jobs' },
  { title: 'Repos', icon: 'mdi-source-repository', to: '/repos' },
  { title: 'Pull Requests', icon: 'mdi-source-pull', to: '/prs' },
  { title: 'Sessions', icon: 'mdi-console', to: '/sessions' },
  { title: 'Machines', icon: 'mdi-server', to: '/machines' },
  { title: 'Queue', icon: 'mdi-playlist-play', to: '/queues' },
  { title: 'Scheduled', icon: 'mdi-clock-outline', to: '/scheduled-tasks' },
  { title: 'Approvals', icon: 'mdi-shield-check', to: '/approvals' },
  { title: 'Costs', icon: 'mdi-currency-usd', to: '/costs' },
  { title: 'Settings', icon: 'mdi-cog', to: '/settings/approval-policies' },
  { title: 'Help', icon: 'mdi-help-circle-outline', to: '/help' },
];

function toggleTheme(): void {
  theme.global.name.value = theme.global.current.value.dark ? 'light' : 'dark';
}
</script>

<template>
  <v-app>
    <v-app-bar elevation="1" density="comfortable">
      <v-app-bar-nav-icon @click="drawer = !drawer" />
      <v-app-bar-title>
        <span class="font-weight-bold">Claude</span>
        <span class="font-weight-light ml-1">HQ</span>
      </v-app-bar-title>
      <v-spacer />
      <!-- CAP-032: enable browser notifications for approvals -->
      <v-btn
        v-if="browserNotifications.supported.value && browserNotifications.permission.value === 'default'"
        icon="mdi-bell-ring-outline"
        variant="text"
        title="Enable browser notifications for approvals"
        @click="browserNotifications.requestPermission()"
      />
      <v-icon
        v-else-if="browserNotifications.permission.value === 'granted'"
        class="mr-2"
        color="success"
        title="Browser notifications enabled"
        size="small"
      >
        mdi-bell
      </v-icon>
      <NotificationFeed />
      <v-btn
        :icon="theme.global.current.value.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
        variant="text"
        @click="toggleTheme"
      />
    </v-app-bar>

    <v-navigation-drawer v-model="drawer" :rail="false" permanent>
      <v-list nav density="comfortable">
        <v-list-item
          v-for="item in navItems"
          :key="item.to"
          :prepend-icon="item.icon"
          :title="item.title"
          :to="item.to"
          rounded="lg"
        />
      </v-list>

      <template #append>
        <v-list-item class="pa-2">
          <v-chip :color="chipColor" size="small" prepend-icon="mdi-circle-small">
            {{ chipLabel }}
          </v-chip>
        </v-list-item>
      </template>
    </v-navigation-drawer>

    <v-main>
      <v-container fluid class="pa-6">
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>
