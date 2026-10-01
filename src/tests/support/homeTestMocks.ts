import { vi } from 'vitest'

/**
 * A no-op PWA registration for component tests that mount the update prompt.
 *
 * Exported as a factory *value* rather than as a `vi.mock` call, because `vi.mock` is hoisted above
 * every import in the file that makes it, including this one. Each test calls
 * `vi.mock('virtual:pwa-register', async () => ...)` itself and `await import()`s this module inside
 * that factory, which resolves only after this module has loaded.
 */
export const pwaRegisterMockValue = () => ({
  registerSW: vi.fn(() => vi.fn(async () => undefined)),
})
