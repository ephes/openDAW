import {defineConfig} from 'vitest/config'

export default defineConfig({test: {
    environment: 'node',
    // Transform lib0 so its captured clock participates in the synthetic clock.
    server: {deps: {inline: ['lib0']}}
}})
