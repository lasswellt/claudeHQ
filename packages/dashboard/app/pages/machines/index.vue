<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useMachinesStore } from '../../stores/machines';
import MachineCard from '../../components/machine/MachineCard.vue';

definePageMeta({ layout: 'default' });

const router = useRouter();
const store = useMachinesStore();

onMounted(() => store.fetchMachines());

function goToMachine(id: string): void {
  router.push(`/machines/${id}`);
}
</script>

<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-6">Machines</h1>

    <v-skeleton-loader v-if="store.loading" type="card" />
    <v-alert v-else-if="store.error" type="error" variant="tonal">
      {{ store.error }}
      <template #append>
        <v-btn variant="text" size="small" @click="store.fetchMachines()">Retry</v-btn>
      </template>
    </v-alert>
    <v-alert v-else-if="store.machines.length === 0" type="info" variant="tonal">
      No machines registered. Start an agent with <code>chq agent start</code>.
    </v-alert>

    <v-row v-else>
      <v-col v-for="machine in store.machines" :key="machine.id" cols="12" sm="6" md="4" lg="3">
        <MachineCard :machine="machine" @select="goToMachine" />
      </v-col>
    </v-row>
  </div>
</template>
