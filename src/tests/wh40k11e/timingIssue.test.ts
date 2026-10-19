import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WH40K_GITHUB_URL } from '../../utils/env'
import { WH40K_CATALOG } from '../../wh40k11e/generated/catalog'
import { createWh40kArmyDocument } from '../../wh40k11e/state/armyDocument'
import { createWh40kReminderViewModels, wh40kTimingIssueUrl } from '../../wh40k11e/view/reminders'

describe('suggest a timing change', () => {
  const [reminder] = createWh40kReminderViewModels(
    WH40K_CATALOG,
    createWh40kArmyDocument(WH40K_CATALOG, 'SM')
  )
  const url = new URL(wh40kTimingIssueUrl(WH40K_GITHUB_URL, reminder))

  it('opens the timing issue form with the rule filled in and the decide command for it', () => {
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/cjwhitedev/40k-reminders/issues/new')
    expect(url.searchParams.get('template')).toBe('timing.yml')
    expect(url.searchParams.get('rule')).toBe(reminder.name)
    expect(url.searchParams.get('army')).toContain(
      WH40K_CATALOG.factions.find(item => item.id === 'SM')!.name
    )
    expect(url.searchParams.get('current')).toContain(reminder.windowLabel)
    expect(url.searchParams.get('rule-id')).toBe(reminder.ruleId)
    expect(url.searchParams.get('command')).toBe(`yarn data:decide --rule "${reminder.ruleId}"`)
  })

  it('fills only fields the issue form has', () => {
    const form = readFileSync('.github/ISSUE_TEMPLATE/timing.yml', 'utf8')
    const fieldIds = new Set(Array.from(form.matchAll(/^\s+id: (\S+)$/gm), match => match[1]))
    const filled = Array.from(url.searchParams.keys()).filter(key => key !== 'template' && key !== 'title')
    expect(filled.filter(key => !fieldIds.has(key))).toEqual([])
  })
})
