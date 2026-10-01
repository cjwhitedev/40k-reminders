import Reminders from 'components/info/reminders'
import { REMINDERS_ANCHOR_ID } from 'components/info/remindersAnchor'
import { UpdateAvailable } from 'components/info/updateAvailable'
import { SelectionCards } from 'components/input/army_builder'
import Toolbar from 'components/input/toolbar/toolbar'
import Footer from 'components/page/footer'
import { Header } from 'components/page/homeHeader'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AOS_REMINDERS_AUTHOR_URL, AOS_REMINDERS_URL, WH40K_AUTHOR_URL } from 'utils/env'
import { WH40K_CATALOG } from '../../wh40k11e/generated/catalog'
import { loadWh40kArmyDocument, saveWh40kArmyDocument } from '../../wh40k11e/runtime/armyStorage'
import {
  createWh40kArmyDocument,
  setWh40kReminderPreference,
  type Wh40kArmyDocument,
} from '../../wh40k11e/state/armyDocument'
import {
  createWh40kBuilderViewModel,
  type Wh40kBuilderGroup,
  type Wh40kBuilderGroupKey,
} from '../../wh40k11e/view/builder'
import { createWh40kReminderViewModels, type Wh40kReminderViewModel } from '../../wh40k11e/view/reminders'

const ClearArmyModal = lazy(() => import('components/modals/generic/generic_destructive_modal'))

const noop = () => undefined
const noSources = () => Promise.resolve([])

const outbound = { className: 'text-white', target: '_blank', rel: 'noopener noreferrer' } as const

const Byline = () => (
  <div className="mt-3 mb-1 d-none d-sm-block text-white">
    <p className="mb-0">
      By cjwhitedev -{' '}
      <a {...outbound} href={WH40K_AUTHOR_URL}>
        github.com/cjwhitedev
      </a>
    </p>
    <p className="mb-0 small">
      Built on{' '}
      <a {...outbound} href={AOS_REMINDERS_URL}>
        AoS Reminders
      </a>{' '}
      by{' '}
      <a {...outbound} href={AOS_REMINDERS_AUTHOR_URL}>
        Davis E. Ford
      </a>
    </p>
  </div>
)

/** Names the army at the top of a printed sheet; hidden on screen by print.scss. */
const PrintHeader = ({ armyName, groups }: { armyName: string; groups: Wh40kBuilderGroup[] }) => {
  const picked = (key: Wh40kBuilderGroupKey) =>
    groups
      .find(group => group.key === key)
      ?.options.filter(option => option.selected)
      .map(option => option.name) ?? []
  const detachment = picked('detachment')[0]
  const enhancements = picked('enhancement')
  const units = picked('datasheet')

  return (
    <header className="PrintHeader container">
      <h1>{armyName}</h1>
      {detachment && <p className="PrintStrap">{detachment}</p>}
      {enhancements.length > 0 && (
        <p className="PrintRoster">
          <strong>Enhancements:</strong> {enhancements.join(', ')}
        </p>
      )}
      {units.length > 0 && (
        <p className="PrintRoster">
          <strong>Units:</strong> {units.join(', ')}
        </p>
      )}
      <p className="PrintSite">40K Reminders - cjwhitedev.github.io/40k-reminders</p>
    </header>
  )
}

const loadDocument = (): Wh40kArmyDocument => {
  try {
    return loadWh40kArmyDocument(window.localStorage, WH40K_CATALOG).document
  } catch {
    // Browser storage can be unavailable in privacy modes; start from a clean army instead.
    return createWh40kArmyDocument(WH40K_CATALOG, 'SM')
  }
}

const Wh40kHome = () => {
  const [document, setDocument] = useState(loadDocument)
  const [isGameMode, setIsGameMode] = useState(false)
  const [clearArmyModalIsOpen, setClearArmyModalIsOpen] = useState(false)

  useEffect(() => {
    try {
      saveWh40kArmyDocument(window.localStorage, document)
    } catch {
      // Browser storage can be unavailable in privacy modes. The in-memory document remains usable.
    }
  }, [document])

  const builder = useMemo(() => createWh40kBuilderViewModel(WH40K_CATALOG, document), [document])
  const reminders = useMemo(() => createWh40kReminderViewModels(WH40K_CATALOG, document), [document])
  const groupByOptionId = useMemo(
    () =>
      new Map<string, Wh40kBuilderGroupKey>(
        builder.groups.flatMap(group => group.options.map(option => [option.id, group.key] as const))
      ),
    [builder.groups]
  )
  const legendsIds = useMemo(
    () =>
      new Set(
        WH40K_CATALOG.datasheets
          .filter(sheet => sheet.context === 'legends')
          .map(sheet => sheet.sourceRecordId as string)
      ),
    []
  )
  const hiddenCount = reminders.filter(reminder => reminder.hidden).length

  const selectFaction = (factionId: string) => {
    if (factionId !== document.factionId) setDocument(createWh40kArmyDocument(WH40K_CATALOG, factionId))
  }

  const setSelections = (groupIds: string[], selectedIds: string[]) => {
    const key = groupIds.map(id => groupByOptionId.get(id)).find(Boolean)
    setDocument(current => {
      if (key === 'datasheet') {
        return {
          ...current,
          datasheetIds: selectedIds,
          allowsLegends: selectedIds.some(id => legendsIds.has(id)),
        }
      }
      if (key === 'detachment') {
        // An army fields one detachment, so a new pick replaces the old one and its enhancements.
        const detachmentId = selectedIds.find(id => id !== current.detachmentId) ?? selectedIds[0]
        if (detachmentId === current.detachmentId) return current
        const next: Wh40kArmyDocument = { ...current, enhancementIds: [] }
        if (detachmentId) next.detachmentId = detachmentId
        else delete next.detachmentId
        return next
      }
      if (key === 'enhancement') return { ...current, enhancementIds: selectedIds }
      return current
    })
  }

  const toggleReminder = (reminder: Wh40kReminderViewModel) =>
    setDocument(current => setWh40kReminderPreference(current, reminder.id, { hidden: !reminder.hidden }))

  const setReminderNote = (reminder: Wh40kReminderViewModel, note: string) =>
    setDocument(current => setWh40kReminderPreference(current, reminder.id, { note }))

  const reorderReminders = (ordered: Wh40kReminderViewModel[]) =>
    setDocument(current =>
      ordered.reduce(
        (next, reminder, order) => setWh40kReminderPreference(next, reminder.id, { order }),
        current
      )
    )

  const showAll = () =>
    setDocument(current =>
      reminders.reduce(
        (next, reminder) =>
          reminder.hidden ? setWh40kReminderPreference(next, reminder.id, { hidden: false }) : next,
        current
      )
    )

  return (
    <div>
      <a
        className="SkipLink visually-hidden-focusable bg-light text-dark d-print-none"
        href={`#${REMINDERS_ANCHOR_ID}`}
      >
        Skip to reminders
      </a>

      <Header
        armiesOfRenown={[]}
        armyName={document.name}
        armyOfRenownId={null}
        factionId={document.factionId}
        factions={builder.factions}
        isGameMode={isGameMode}
        onArmyOfRenownChange={noop}
        onFactionChange={selectFaction}
        onToggleGameMode={() => setIsGameMode(current => !current)}
        onToggleSeasonalRules={noop}
        seasonalRulesChecked={null}
        title="40K Reminders"
        byline={<Byline />}
      />

      <UpdateAvailable />

      <PrintHeader armyName={document.name} groups={builder.groups} />

      {!isGameMode && <SelectionCards groups={builder.groups} onSetGroupSelections={setSelections} />}

      {!isGameMode && (
        <Toolbar
          cloudArmyLinked={false}
          hiddenCount={hiddenCount}
          onClearArmy={() => setClearArmyModalIsOpen(true)}
          onPrint={() => window.print()}
          onShowAll={showAll}
          updateArmyStatus="idle"
        />
      )}

      <Reminders
        getSources={noSources}
        isGameMode={isGameMode}
        onHide={toggleReminder}
        onNote={setReminderNote}
        onReorder={reorderReminders}
        reminders={reminders}
      />

      {clearArmyModalIsOpen && (
        <Suspense fallback={null}>
          <ClearArmyModal
            bodyText="This empties the builder and discards the notes, hidden reminders, and ordering you set for this army."
            closeModal={() => setClearArmyModalIsOpen(false)}
            confirmText="Clear army"
            denyText="Keep it"
            headerText="Clear this army?"
            isOpen={clearArmyModalIsOpen}
            onConfirm={() => {
              setDocument(current => createWh40kArmyDocument(WH40K_CATALOG, current.factionId))
              setClearArmyModalIsOpen(false)
            }}
          />
        </Suspense>
      )}

      <Footer />
    </div>
  )
}

export default Wh40kHome
