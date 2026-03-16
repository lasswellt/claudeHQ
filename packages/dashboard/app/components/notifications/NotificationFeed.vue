<script setup lang="ts">
import { useNotifications } from '../../composables/useNotifications';

const { notifications, unreadCount, markAllRead, clear } = useNotifications();
</script>

<template>
  <v-menu :close-on-content-click="false" location="bottom end">
    <template #activator="{ props: menuProps }">
      <v-btn icon v-bind="menuProps" variant="text">
        <v-badge :content="unreadCount" :model-value="unreadCount > 0" color="error">
          <v-icon>mdi-bell</v-icon>
        </v-badge>
      </v-btn>
    </template>

    <v-card min-width="350" max-height="400">
      <v-card-title class="d-flex align-center justify-space-between">
        <span class="text-subtitle-1">Notifications</span>
        <div>
          <v-btn size="x-small" variant="text" @click="markAllRead">Mark all read</v-btn>
          <v-btn size="x-small" variant="text" @click="clear">Clear</v-btn>
        </div>
      </v-card-title>

      <v-divider />

      <v-list v-if="notifications.length > 0" density="compact" class="overflow-y-auto" max-height="300">
        <v-list-item
          v-for="n in notifications"
          :key="n.id"
          :class="{ 'bg-surface-variant': !n.read }"
        >
          <template #prepend>
            <v-icon
              :color="n.type.includes('failed') ? 'error' : n.type.includes('completed') ? 'success' : 'info'"
              size="small"
            >
              {{ n.type.includes('failed') ? 'mdi-alert-circle' : n.type.includes('completed') ? 'mdi-check-circle' : 'mdi-information' }}
            </v-icon>
          </template>
          <v-list-item-title class="text-body-2">{{ n.message }}</v-list-item-title>
          <v-list-item-subtitle class="text-caption">
            {{ new Date(n.timestamp * 1000).toLocaleTimeString() }}
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>

      <v-card-text v-else class="text-center text-medium-emphasis">
        No notifications
      </v-card-text>
    </v-card>
  </v-menu>
</template>
