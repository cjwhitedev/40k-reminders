import Reminders from 'components/info/reminders'
import { REMINDERS_ANCHOR_ID } from 'components/info/remindersAnchor'
import { SelectionCards } from 'components/input/army_builder'
import DisplayOptions from 'components/input/toolbar/displayOptions'
import Toolbar from 'components/input/toolbar/toolbar'
import Footer from 'components/page/footer'
import { Header } from 'components/page/homeHeader'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  AOS_REMINDERS_AUTHOR_URL,
  AOS_REMINDERS_URL,
  ROUTES,
  WH40K_AUTHOR_URL,
  WH40K_GITHUB_URL,
} from 'utils/env'
import { WH40K_CATALOG } from '../../wh40k11e/generated/catalog'
import { loadWh40kArmyDocument, saveWh40kArmyDocument } from '../../wh40k11e/runtime/armyStorage'
import {
  loadWh40kDisplaySettings,
  pickWh40kSectionColour,
  saveWh40kDisplaySettings,
  WH40K_DEFAULT_DISPLAY_SETTINGS,
  WH40K_TITLE_BAR_COLOURS,
} from '../../wh40k11e/runtime/displaySettings'
import {
  createWh40kArmyDocument,
  setWh40kReminderPreference,
  type Wh40kArmyDocument,
} from '../../wh40k11e/state/armyDocument'
import {
  createWh40kBuilderViewModel,
  WH40K_ALLY_OPTION_PREFIX,
  type Wh40kBuilderGroupKey,
} from '../../wh40k11e/view/builder'
import {
  createWh40kReminderViewModels,
  wh40kTimingIssueUrl,
  type Wh40kReminderViewModel,
} from '../../wh40k11e/view/reminders'
import { formatWh40kRemindersCsv } from '../../wh40k11e/view/remindersCsv'

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

const loadDocument = (): Wh40kArmyDocument => {
  try {
    return loadWh40kArmyDocument(window.localStorage, WH40K_CATALOG).document
  } catch {
    // Browser storage can be unavailable in privacy modes; start from a clean army instead.
    return createWh40kArmyDocument(WH40K_CATALOG, 'SM')
  }
}

const loadDisplaySettings = () => {
  try {
    return loadWh40kDisplaySettings(window.localStorage)
  } catch {
    return WH40K_DEFAULT_DISPLAY_SETTINGS
  }
}

const Wh40kHome = ({ sample }: { sample?: () => Wh40kArmyDocument }) => {
  const [document, setDocument] = useState(() => sample?.() ?? loadDocument())
  const [display, setDisplay] = useState(loadDisplaySettings)
  const [isGameMode, setIsGameMode] = useState(false)
  const [clearArmyModalIsOpen, setClearArmyModalIsOpen] = useState(false)

  useEffect(() => {
    try {
      saveWh40kDisplaySettings(window.localStorage, display)
    } catch {
      // As with the army: without storage the choice lasts until the page closes.
    }
  }, [display])

  useEffect(() => {
    // A sample army must not replace the army the visitor has saved.
    if (sample) return
    try {
      saveWh40kArmyDocument(window.localStorage, document)
    } catch {
      // Browser storage can be unavailable in privacy modes. The in-memory document remains usable.
    }
  }, [document])

  const builder = useMemo(() => createWh40kBuilderViewModel(WH40K_CATALOG, document), [document])
  const reminders = useMemo(
    () =>
      createWh40kReminderViewModels(WH40K_CATALOG, document).map(reminder => ({
        ...reminder,
        suggestTimingUrl: wh40kTimingIssueUrl(WH40K_GITHUB_URL, reminder),
      })),
    [document]
  )
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
  const datasheetFactions = useMemo(
    () =>
      new Map<string, string>(WH40K_CATALOG.datasheets.map(sheet => [sheet.sourceRecordId, sheet.factionId])),
    []
  )
  const hiddenCount = reminders.filter(reminder => reminder.hidden).length

  const selectFaction = (factionId: string) => {
    if (factionId !== document.factionId) setDocument(createWh40kArmyDocument(WH40K_CATALOG, factionId))
  }

  const selectSubFaction = (subFaction: string | null) =>
    setDocument(current => {
      const next = { ...current }
      if (subFaction) next.subFaction = subFaction
      else delete next.subFaction
      return next
    })

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
      if (key === 'ally') {
        // Dropping an ally drops its units too.
        const allyFactionIds = selectedIds.map(id => id.slice(WH40K_ALLY_OPTION_PREFIX.length))
        const fielded = new Set([current.factionId, ...allyFactionIds])
        const datasheetIds = current.datasheetIds.filter(id => fielded.has(datasheetFactions.get(id) ?? ''))
        const next: Wh40kArmyDocument = {
          ...current,
          datasheetIds,
          allowsLegends: datasheetIds.some(id => legendsIds.has(id)),
        }
        if (allyFactionIds.length) next.allyFactionIds = allyFactionIds
        else delete next.allyFactionIds
        return next
      }
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

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([formatWh40kRemindersCsv(reminders)], { type: 'text/csv' }))
    const link = window.document.createElement('a')
    link.href = url
    link.download = `${[document.name, document.subFaction].filter(Boolean).join(' - ')} reminders.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const showAll = () =>
    setDocument(current =>
      reminders.reduce(
        (next, reminder) =>
          reminder.hidden ? setWh40kReminderPreference(next, reminder.id, { hidden: false }) : next,
        current
      )
    )

  return (
    <div className={display.printInColour ? 'PrintInColour' : undefined}>
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
        {...(builder.subFactions
          ? {
              subFaction: {
                ...builder.subFactions,
                value: document.subFaction ?? null,
                onChange: selectSubFaction,
              },
            }
          : {})}
        title="40K Reminders"
        byline={<Byline />}
      />

      {sample && (
        <p className="SampleArmyNote container text-center small my-2 d-print-none" role="note">
          A typical 2000-point Space Marines list, for reviewing. Changes here are not saved.{' '}
          <Link to={ROUTES.HOME}>Back to your army</Link>
        </p>
      )}

      {!isGameMode && <SelectionCards groups={builder.groups} onSetGroupSelections={setSelections} />}

      {!isGameMode && (
        <Toolbar
          cloudArmyLinked={false}
          hiddenCount={hiddenCount}
          onClearArmy={() => setClearArmyModalIsOpen(true)}
          onPrint={() => window.print()}
          onExportCsv={exportCsv}
          onShowAll={showAll}
          updateArmyStatus="idle"
        />
      )}

      {!isGameMode && <DisplayOptions settings={display} onChange={setDisplay} />}

      <Reminders
        getSources={noSources}
        isGameMode={isGameMode}
        onHide={toggleReminder}
        onNote={setReminderNote}
        onReorder={reorderReminders}
        reminders={reminders}
        sectionColours={{
          choices: WH40K_TITLE_BAR_COLOURS,
          picked: display.sectionColours,
          onPick: (sectionKey, colour) =>
            setDisplay(current => pickWh40kSectionColour(current, sectionKey, colour)),
        }}
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
