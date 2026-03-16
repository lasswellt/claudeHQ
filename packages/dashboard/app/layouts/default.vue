<script setup lang="ts">
import { ref } from 'vue';
import { useTheme } from 'vuetify';
import NotificationFeed from '../components/notifications/NotificationFeed.vue';

const drawer = ref(true);
const theme = useTheme();

const navItems = [
  { title: 'Overview', icon: 'mdi-view-dashboard', to: '/' },
  { title: 'Jobs', icon: 'mdi-briefcase-outline', to: '/jobs' },
  { title: 'Repos', icon: 'mdi-source-repository', to: '/repos' },
  { title: 'Pull Requests', icon: 'mdi-source-pull', to: '/prs' },
  { title: 'Sessions', icon: 'mdi-console', to: '/sessions' },
  { title: 'Machines', icon: 'mdi-server', to: '/machines' },
  { title: 'Queue', icon: 'mdi-playlist-play', to: '/queues' },
  { title: 'Approvals', icon: 'mdi-shield-check', to: '/approvals' },
  { title: 'Settings', icon: 'mdi-cog', to: '/settings/approval-policies' },
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
          <v-chip color="success" size="small" prepend-icon="mdi-circle-small">
            Connected
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
