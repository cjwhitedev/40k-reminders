import { LinkNewTab } from 'components/helpers/link'
import { LoadingHeader } from 'components/helpers/suspenseFallbacks'
import Contact from 'components/page/contact'
import Footer from 'components/page/footer'
import { useTheme } from 'context/useTheme'
import { lazy, Suspense, useEffect } from 'react'
import { AOS_REMINDERS_AUTHOR_URL, AOS_REMINDERS_URL, WH40K_AUTHOR_URL, WH40K_GITHUB_URL } from 'utils/env'

const Navbar = lazy(() => import('components/page/navbar'))

/*
 * A reading column, not a card gallery. The previous layout was Bootstrap's featured-blog-post
 * example: three cards at col-md-8/col-lg-6/col-xl-5 that tiled 2-up and orphaned the third, with
 * the screenshots sized 200x250 regardless of what they actually were.
 *
 * The measure is set per breakpoint to hold answers near 75 characters a line. Sections reuse the
 * product's own card + Signal Teal header, so the FAQ reads as part of the same manual as the
 * reminders screen rather than as a marketing page bolted onto the side.
 */
const columnClass = 'col-12 col-md-11 col-lg-8 col-xl-7 col-xxl-5'

interface IFaqEntry {
  answer: React.ReactNode
  /** Anchor target, so a question can be linked to directly. */
  id: string
  question: string
}

interface IFaqSection {
  entries: IFaqEntry[]
  id: string
  title: string
}

const GithubIssuesLink = () => (
  <LinkNewTab className="FaqLink" href={`${WH40K_GITHUB_URL}/issues`}>
    open an issue on GitHub
  </LinkNewTab>
)

const WahapediaLink = () => (
  <LinkNewTab className="FaqLink" href="//wahapedia.ru/wh40k11ed/the-rules/">
    Wahapedia
  </LinkNewTab>
)

const BsDataLink = () => (
  <LinkNewTab className="FaqLink" href="//github.com/BSData/wh40k-11e">
    BSData
  </LinkNewTab>
)

const AosRemindersLink = ({ children = 'AoS Reminders' }: React.PropsWithChildren<object>) => (
  <LinkNewTab className="FaqLink" href={AOS_REMINDERS_URL}>
    {children}
  </LinkNewTab>
)

/*
 * Every claim below is checked against what the app ships today. Control names are bolded and
 * spelled exactly as they appear in the interface so they can be found by eye.
 */
const FaqSections: IFaqSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    entries: [
      {
        id: 'what-is-this',
        question: 'What does 40K Reminders actually do?',
        answer: (
          <>
            You give it the army you are bringing: faction, detachment, enhancements, and units. It works out
            every rule that army gives you and lists each one under the moment it comes up - before the
            battle, the start and end of a battle round, each phase of the turn, reactions to your opponent,
            and the rules that are always active. It is not a rules search. It is your list, in turn order.
          </>
        ),
      },
      {
        id: 'edit-and-play',
        question: 'What is the difference between Edit and Play mode?',
        answer: (
          <>
            Edit is for the desk: you get the faction picker, the army builder, and the toolbar, and rules you
            have hidden are still listed. Play is for the table: the builder and the toolbar disappear, hidden
            rules drop out completely, and what is left is what comes up in this game. The switch sits at the
            top of the home page.
          </>
        ),
      },
      {
        id: 'hide-reminders',
        question: 'How do I get rid of reminders I already know?',
        answer: (
          <>
            Open the ⋯ menu on any reminder and choose <strong>Hide rule</strong>. It stays out of Play mode
            until you change your mind - <strong>Show Hidden</strong> in the toolbar keeps a count and brings
            them all back at once. The same menu has <strong>Add note</strong> for writing your own line under
            a rule, and you can drag reminders into a different order within their phase.
          </>
        ),
      },
      {
        id: 'import-a-roster',
        question: 'Can I import a list I already made?',
        answer: (
          <>
            Not yet. For now, pick your faction, detachment, enhancements, and units in the builder. Your army
            is kept in this browser, so you only build it once.
          </>
        ),
      },
    ],
  },
  {
    id: 'at-the-table',
    title: 'At the table',
    entries: [
      {
        id: 'print',
        question: 'Can I take this to the table on paper?',
        answer: (
          <>
            Use your browser&apos;s <strong>Print</strong>. The builder and the buttons are left off the page,
            and anything you hid stays hidden. A PDF download like the one AoS Reminders has is planned.
          </>
        ),
      },
      {
        id: 'offline',
        question: 'Does it work without Wifi?',
        answer: (
          <>
            Your army is kept in this browser, and once the site has loaded its rules are kept for offline
            use, so a connection that drops mid-game should not take your reminders with it. If the venue wifi
            is unreliable, open the site once before the game while you still have signal.
          </>
        ),
      },
    ],
  },
  {
    id: 'rules-and-data',
    title: 'Rules and data',
    entries: [
      {
        id: 'which-edition',
        question: 'Which rules does this cover?',
        answer: (
          <>
            Warhammer 40,000 eleventh edition, matched play. Boarding Actions detachments are not offered.
            Legends units are listed under their own <strong>Legends</strong> heading in the unit picker.
          </>
        ),
      },
      {
        id: 'where-rules-come-from',
        question: 'Where do the rules come from?',
        answer: (
          <>
            Games Workshop publications are the authority. Most of the rules text currently comes from{' '}
            <WahapediaLink />, cross-checked against <BsDataLink />, and it is corrected against official
            Games Workshop documents as they are added. Where the sources disagree, the official document
            wins.
          </>
        ),
      },
      {
        id: 'wrong-or-missing-rule',
        question: "I've noticed an incorrect or missing rule!",
        answer: (
          <>
            <p>
              Please tell me. Corrections go into the rules data and are re-checked against the sources, so
              the fix reaches everyone rather than only your army. Naming the faction, the detachment or unit,
              and the rule makes it much faster to track down.
            </p>
            <p className="mb-2">
              The best route is to <GithubIssuesLink />.
            </p>
            <Contact size="small" />
          </>
        ),
      },
      {
        id: 'is-this-official',
        question: 'Is this an official Games Workshop app?',
        answer: (
          <>
            No. 40K Reminders is unofficial and fan-made, is in no way endorsed or sanctioned by Games
            Workshop, and takes no credit for their content.
          </>
        ),
      },
    ],
  },
  {
    id: 'about',
    title: 'About',
    entries: [
      {
        id: 'who-made-this',
        question: 'Who made this?',
        answer: (
          <>
            40K Reminders is put together by{' '}
            <LinkNewTab className="FaqLink" href={WH40K_AUTHOR_URL}>
              cjwhitedev
            </LinkNewTab>{' '}
            on top of <AosRemindersLink />, the Age of Sigmar app{' '}
            <LinkNewTab className="FaqLink" href={AOS_REMINDERS_AUTHOR_URL}>
              Davis E. Ford
            </LinkNewTab>{' '}
            has built and run for years. The army builder, the reminder cards, and much of the code under them
            are his work, retooled here for Warhammer 40,000.
          </>
        ),
      },
      {
        id: 'age-of-sigmar',
        question: 'I play Age of Sigmar. Where do I go?',
        answer: (
          <>
            To the original: <AosRemindersLink>aosreminders.com</AosRemindersLink>. It covers Age of Sigmar
            fourth edition, and it is where roster import, PDF export, and saved armies started.
          </>
        ),
      },
      {
        id: 'accounts',
        question: 'Can I save armies to an account, share them, or subscribe?',
        answer: (
          <>
            Not on this site. Accounts, saved armies, sharing, and subscriptions belong to{' '}
            <AosRemindersLink />, and the account links here forward you there. If this page helps your games,
            supporting AoS Reminders supports the work it is built on.
          </>
        ),
      },
    ],
  },
]

const Faq = () => {
  const { theme } = useTheme()

  useEffect(() => {
    /*
     * Questions carry anchors now, so /faq#who-made-this has to survive arrival. Scrolling to the top
     * unconditionally would land the reader back at the masthead every time.
     */
    const { hash } = window.location
    const target = hash ? document.getElementById(hash.slice(1)) : null
    /*
     * `instant` is required, not a preference. Bootstrap 5.3 sets `scroll-behavior: smooth` on
     * `:root` (4.6 did not), so a bare scrollIntoView() starts an animation from the top that the
     * browser's own load-time scroll handling cancels - the reader lands at the masthead and the
     * anchor silently does nothing. An arrival jump should be instant anyway; the smooth behaviour
     * still applies to the section links, which is where it reads well.
     */
    if (target) return target.scrollIntoView({ behavior: 'instant' })
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className={`d-block ${theme.bgColor}`}>
      <div className={`${theme.headerColor} py-2 d-print-none`}>
        <Suspense fallback={<LoadingHeader />}>
          <Navbar />
        </Suspense>
      </div>

      <div className={`container ${theme.bgColor} ${theme.text} pt-3 pb-5`}>
        <div className="row justify-content-center">
          <div className={columnClass}>
            <PageHeader />
            {FaqSections.map(section => (
              <FaqSectionCard key={section.id} section={section} />
            ))}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}

const PageHeader = () => (
  <div className="text-center">
    {/* Rendered at h2 size so the page gains a top-level heading without a visual change. */}
    <h1 className="h2">Frequently Asked Questions</h1>
    {/*
      A flex row, not a line of inline links. JSX leaves no whitespace between siblings, so an
      inline row has no break opportunity and ran 546px wide in a 371px viewport, scrolling the
      whole page sideways. Each title stays whole (text-nowrap) and the row wraps between them.
    */}
    <nav aria-label="Sections" className="d-flex flex-wrap justify-content-center d-print-none">
      {FaqSections.map(section => (
        <a className="FaqLink text-nowrap mx-2 mb-1" href={`#${section.id}`} key={section.id}>
          {section.title}
        </a>
      ))}
    </nav>
    <hr />
  </div>
)

const FaqSectionCard = ({ section }: { section: IFaqSection }) => {
  const { theme } = useTheme()

  return (
    <div className={`${theme.card} mb-4 shadow-sm`} id={section.id}>
      <div className={theme.cardHeader}>
        {/* Sits directly under the page h1, matching every other section header in the product. */}
        <h2 className="CardHeaderTitle">{section.title}</h2>
      </div>
      <div className={theme.cardBody}>
        {section.entries.map(entry => (
          <FaqEntry key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}

const FaqEntry = ({ entry }: { entry: IFaqEntry }) => {
  const { isDark } = useTheme()

  return (
    <div className={`FaqEntry PageBreak ${isDark ? 'FaqEntry-Dark' : ''}`}>
      {/* .h5 keeps the question below the section header in size without changing its outline level. */}
      <h3 className="h5 mb-2" id={entry.id}>
        {entry.question}
      </h3>
      <div className="mb-0">{entry.answer}</div>
    </div>
  )
}

export default Faq
