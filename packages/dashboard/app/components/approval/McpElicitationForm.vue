<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ApprovalRequest } from '@chq/shared/browser';

// CAP-031 / story 013-007: MCP elicitation JSON-Schema form renderer.
//
// Supported schema subset (documented; anything else rejects with a
// clear error so MCP servers can degrade gracefully):
//   - type: "object" at the root with `properties: { ... }`
//   - string  (→ text field; enum → select; format=date → date picker)
//   - number  (→ number field)
//   - integer (→ number field with step=1)
//   - boolean (→ checkbox)
//
// NOT supported: nested objects, arrays, oneOf/anyOf/allOf, $ref.
// Unsupported schemas surface a visible error banner instead of
// silently rendering a broken form.

const props = defineProps<{
  modelValue: boolean;
  approval: ApprovalRequest | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'submit', approvalId: string, responseData: Record<string, unknown>): void;
}>();

type JsonSchemaProp =
  | {
      type: 'string';
      title?: string;
      description?: string;
      enum?: string[];
      format?: 'date' | 'date-time' | 'email' | 'uri';
      default?: string;
    }
  | {
      type: 'number' | 'integer';
      title?: string;
      description?: string;
      minimum?: number;
      maximum?: number;
      default?: number;
    }
  | {
      type: 'boolean';
      title?: string;
      description?: string;
      default?: boolean;
    };

interface ObjectSchema {
  type: 'object';
  title?: string;
  description?: string;
  properties: Record<string, JsonSchemaProp>;
  required?: string[];
}

interface ParsedSchema {
  ok: true;
  schema: ObjectSchema;
}
interface ParsedSchemaError {
  ok: false;
  error: string;
}

function parseSchema(raw: string): ParsedSchema | ParsedSchemaError {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, error: 'Schema must be a JSON object' };
  }
  const s = obj as Record<string, unknown>;
  if (s.type !== 'object') {
    return { ok: false, error: `Unsupported root type "${String(s.type)}"; only "object" is supported` };
  }
  const props = s.properties;
  if (typeof props !== 'object' || props === null) {
    return { ok: false, error: 'Schema must declare "properties" as an object' };
  }
  // Validate each property has a supported type.
  for (const [name, prop] of Object.entries(props as Record<string, unknown>)) {
    if (typeof prop !== 'object' || prop === null) {
      return { ok: false, error: `Property "${name}" is not an object` };
    }
    const ptype = (prop as Record<string, unknown>).type;
    if (ptype !== 'string' && ptype !== 'number' && ptype !== 'integer' && ptype !== 'boolean') {
      return {
        ok: false,
        error: `Property "${name}" has unsupported type "${String(ptype)}"; only string/number/integer/boolean`,
      };
    }
  }
  return { ok: true, schema: s as unknown as ObjectSchema };
}

const parsed = computed(() => {
  const raw = props.approval?.prompt_options ?? '';
  if (!raw) return { ok: false, error: 'No elicitation schema attached to the approval' } as const;
  return parseSchema(raw);
});

interface FieldEntry {
  key: string;
  prop: JsonSchemaProp;
  required: boolean;
}

const fields = computed<FieldEntry[]>(() => {
  if (!parsed.value.ok) return [];
  const { properties, required = [] } = parsed.value.schema;
  return Object.entries(properties).map(([key, prop]) => ({
    key,
    prop,
    required: required.includes(key),
  }));
});

type FieldValue = string | number | boolean | null | undefined;
const formData = ref<Record<string, FieldValue>>({});

// Typed bridges for Vuetify components — each underlying field is
// only bound to one type of input, but the backing record is
// heterogeneous, so template v-model fails its narrow type check.
function getString(key: string): string | null {
  const v = formData.value[key];
  return typeof v === 'string' ? v : null;
}
function setString(key: string, v: string | null): void {
  formData.value[key] = v ?? '';
}
function getNumber(key: string): number | null {
  const v = formData.value[key];
  return typeof v === 'number' ? v : null;
}
function setNumber(key: string, v: number | null): void {
  formData.value[key] = v ?? undefined;
}
function getBoolean(key: string): boolean {
  return formData.value[key] === true;
}
function setBoolean(key: string, v: boolean | null): void {
  formData.value[key] = v === true;
}
const submitting = ref(false);
const validationError = ref<string | null>(null);

function resetForm(): void {
  formData.value = {};
  validationError.value = null;
  submitting.value = false;
  if (!parsed.value.ok) return;
  for (const { key, prop } of fields.value) {
    if ('default' in prop && prop.default !== undefined) {
      formData.value[key] = prop.default;
    } else if (prop.type === 'boolean') {
      formData.value[key] = false;
    }
  }
}

// Reset whenever the approval changes.
watch(
  () => props.approval?.id,
  () => resetForm(),
  { immediate: true },
);

function validate(): string | null {
  if (!parsed.value.ok) return parsed.value.error;
  for (const { key, prop, required } of fields.value) {
    const value = formData.value[key];
    const empty = value === undefined || value === null || value === '';
    if (required && empty) {
      return `"${prop.title ?? key}" is required`;
    }
    if (!empty) {
      if (prop.type === 'number' || prop.type === 'integer') {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          return `"${prop.title ?? key}" must be a number`;
        }
        if (prop.type === 'integer' && !Number.isInteger(value)) {
          return `"${prop.title ?? key}" must be an integer`;
        }
        if (prop.minimum !== undefined && value < prop.minimum) {
          return `"${prop.title ?? key}" must be ≥ ${prop.minimum}`;
        }
        if (prop.maximum !== undefined && value > prop.maximum) {
          return `"${prop.title ?? key}" must be ≤ ${prop.maximum}`;
        }
      }
      if (prop.type === 'string' && prop.enum && !prop.enum.includes(String(value))) {
        return `"${prop.title ?? key}" must be one of: ${prop.enum.join(', ')}`;
      }
    }
  }
  return null;
}

function handleSubmit(): void {
  const err = validate();
  if (err) {
    validationError.value = err;
    return;
  }
  if (!props.approval) return;
  submitting.value = true;
  emit('submit', props.approval.id, { ...formData.value });
  emit('update:modelValue', false);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card v-if="approval">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="info">mdi-form-dropdown</v-icon>
        MCP Request
      </v-card-title>

      <v-card-text>
        <p v-if="approval.prompt_text" class="text-body-1 mb-4">{{ approval.prompt_text }}</p>

        <!-- Schema parse failure -->
        <v-alert
          v-if="!parsed.ok"
          type="error"
          variant="tonal"
          class="mb-3"
          density="compact"
        >
          <template #title>Unsupported schema</template>
          {{ parsed.error }}
        </v-alert>

        <!-- Form rendering -->
        <div v-else class="d-flex flex-column ga-3">
          <template v-for="field in fields" :key="field.key">
            <!-- string + enum → select -->
            <v-select
              v-if="field.prop.type === 'string' && field.prop.enum"
              :model-value="getString(field.key)"
              :items="field.prop.enum"
              :label="(field.prop.title ?? field.key) + (field.required ? ' *' : '')"
              :hint="field.prop.description"
              :persistent-hint="!!field.prop.description"
              variant="outlined"
              density="compact"
              @update:model-value="(v: string | null) => setString(field.key, v)"
            />

            <!-- string + format=date → date input -->
            <v-text-field
              v-else-if="field.prop.type === 'string' && field.prop.format === 'date'"
              :model-value="getString(field.key)"
              type="date"
              :label="(field.prop.title ?? field.key) + (field.required ? ' *' : '')"
              :hint="field.prop.description"
              :persistent-hint="!!field.prop.description"
              variant="outlined"
              density="compact"
              @update:model-value="(v: string) => setString(field.key, v)"
            />

            <!-- string (plain) → text field -->
            <v-text-field
              v-else-if="field.prop.type === 'string'"
              :model-value="getString(field.key)"
              :label="(field.prop.title ?? field.key) + (field.required ? ' *' : '')"
              :hint="field.prop.description"
              :persistent-hint="!!field.prop.description"
              variant="outlined"
              density="compact"
              @update:model-value="(v: string) => setString(field.key, v)"
            />

            <!-- number / integer -->
            <v-text-field
              v-else-if="field.prop.type === 'number' || field.prop.type === 'integer'"
              :model-value="getNumber(field.key)"
              type="number"
              :step="field.prop.type === 'integer' ? 1 : 'any'"
              :min="field.prop.minimum"
              :max="field.prop.maximum"
              :label="(field.prop.title ?? field.key) + (field.required ? ' *' : '')"
              :hint="field.prop.description"
              :persistent-hint="!!field.prop.description"
              variant="outlined"
              density="compact"
              @update:model-value="(v: string) => setNumber(field.key, v === '' ? null : Number(v))"
            />

            <!-- boolean -->
            <v-checkbox
              v-else-if="field.prop.type === 'boolean'"
              :model-value="getBoolean(field.key)"
              :label="field.prop.title ?? field.key"
              :hint="field.prop.description"
              :persistent-hint="!!field.prop.description"
              density="compact"
              @update:model-value="(v: boolean | null) => setBoolean(field.key, v)"
            />
          </template>
        </div>

        <v-alert
          v-if="validationError"
          type="warning"
          variant="tonal"
          class="mt-3"
          density="compact"
          closable
          @click:close="validationError = null"
        >
          {{ validationError }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!parsed.ok || submitting"
          @click="handleSubmit"
        >
          Submit
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
