// @vitest-environment jsdom

import Navbar from 'components/page/navbar'
import { AppStatusProvider } from 'context/useAppStatus'
import { SubscriptionProvider } from 'context/useSubscription'
import { ThemeProvider } from 'context/useTheme'
import { render, unmountComponentAtNode } from 'tests/support/reactTestHelpers'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import config from '../../auth_config.json'

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  loginWithPopup: vi.fn(),
  logout: vi.fn(),
  user: undefined as { email: string } | undefined,
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => auth,
}))

describe('40K Reminders navigation', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: vi.fn(),
        getItem: vi.fn(() => null),
        key: vi.fn(() => null),
        length: 0,
        removeItem: vi.fn(),
        setItem: vi.fn(),
      } satisfies Storage,
    })
    auth.isAuthenticated = false
    auth.isLoading = false
    auth.loginWithPopup.mockReset()
    auth.logout.mockReset()
    auth.user = undefined
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => {
      unmountComponentAtNode(container)
    })
    container.remove()
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  const renderNavbar = () => {
    act(() => {
      render(
        <AppStatusProvider>
          <SubscriptionProvider>
            <ThemeProvider>
              <MemoryRouter>
                <Navbar />
              </MemoryRouter>
            </ThemeProvider>
          </SubscriptionProvider>
        </AppStatusProvider>,
        container
      )
    })
  }

  it('offers the FAQ and AoS Reminders instead of account navigation, whatever Auth0 reports', () => {
    for (const isAuthenticated of [false, true]) {
      auth.isAuthenticated = isAuthenticated
      renderNavbar()

      expect(container.textContent).toContain('FAQ')
      for (const accountLink of ['Log in', 'Log out', 'Subscribe', 'Profile']) {
        expect(container.textContent).not.toContain(accountLink)
      }
      const original = Array.from(container.querySelectorAll('a')).find(
        link => link.textContent === 'AoS Reminders'
      )
      expect(original?.getAttribute('href')).toBe('https://aosreminders.com')
      expect(original?.getAttribute('target')).toBe('_blank')
      expect(original?.getAttribute('rel')).toBe('noopener noreferrer')
      expect(auth.loginWithPopup).not.toHaveBeenCalled()

      act(() => {
        unmountComponentAtNode(container)
      })
    }
  })

  it('links home from every other page', () => {
    window.history.pushState({}, '', '/faq')
    renderNavbar()

    expect(container.textContent).toContain('Home')
    expect(container.textContent).not.toContain('FAQ')
  })

  it('reaches the tenant through the first-party custom domain', () => {
    // A subdomain of the site, not the canonical dev-*.auth0.com host: same tenant either way, but
    // only this one is same-site, so the Auth0 session cookie is first-party. Tokens minted here
    // carry iss https://auth.aosreminders.com/, which both API Gateway JWT authorizers pin exactly.
    expect(config.domain).toBe('auth.aosreminders.com')
    expect(config.clientId).toBeTruthy()
    expect(config.audience).toBe('https://api.aosreminders.com')
  })
})
