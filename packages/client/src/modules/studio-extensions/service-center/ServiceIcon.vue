<script setup lang="ts">
const props = defineProps<{ name: string; size?: number }>()
const paths: Record<string, string> = {
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM2 12h20M12 2c3 3 4 6 4 10s-1 7-4 10M12 2c-3 3-4 6-4 10s1 7 4 10',
  server: 'M4 3h16v8H4zM4 13h16v8H4zM8 7h.01M8 17h.01',
  cloud: 'M5 18a4 4 0 0 1-.5-8 8 8 0 0 1 15 2A3 3 0 0 1 19 18z',
  tool: 'M14 7a5 5 0 0 0-7 7l-4 4 3 3 4-4a5 5 0 0 0 7-7l-3 3-3-3z',
  database: 'M3 5c0-4 18-4 18 0s-18 4-18 0Zm0 0v7c0 4 18 4 18 0V5M3 12v7c0 4 18 4 18 0v-7',
  monitor: 'M3 4h18v13H3zM8 21h8M12 17v4',
  folder: 'M2 6h8l2 2h10v12H2z',
  shield: 'M12 2 3 6v6c0 6 4 9 9 10 5-1 9-4 9-10V6z',
  star: 'm12 2 3.1 6.3 7 1-5 4.9 1.2 7-6.3-3.3-6.3 3.3 1.2-7-5-4.9 7-1z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 11v6M12 7h.01',
  location: 'M12 22s8-7 8-12a8 8 0 0 0-16 0c0 5 8 12 8 12ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  external: 'M14 3h7v7M21 3l-10 10M20 14v6H4V4h6',
  chevron: 'm6 9 6 6 6-6',
  close: 'M5 5l14 14M19 5 5 19',
}
</script>
<template>
  <svg :width="props.size || 20" :height="props.size || 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[props.name] || paths.globe" /></svg>
</template>
