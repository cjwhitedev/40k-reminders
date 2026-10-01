// @vitest-environment jsdom

import Navbar from 'components/page/navbar'
import { AppStatusProvider } from 'context/useAppStatus'
import { ThemeProvider } from 'context/useTheme'
import { render, unmountComponentAtNode } from 'tests/support/reactTestHelpers'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryStorage } from 'tests/support/memoryStorage'

describe('40K Reminders navigation', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: new MemoryStorage() })
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => {
      unmountComponentAtNode(container)
    })
    container.remove()
  })

  const renderNavbar = (path = '/') => {
    act(() => {
      render(
        <AppStatusProvider>
          <ThemeProvider>
            <MemoryRouter initialEntries={[path]}>
              <Navbar />
            </MemoryRouter>
          </ThemeProvider>
        </AppStatusProvider>,
        container
      )
    })
  }

  it('offers the FAQ and AoS Reminders instead of account navigation', () => {
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
  })

  it('links home from every other page', () => {
    renderNavbar('/faq')

    expect(container.textContent).toContain('Home')
    expect(container.textContent).not.toContain('FAQ')
  })
})
