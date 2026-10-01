import { useAppStatus } from 'context/useAppStatus'
import { useTheme } from 'context/useTheme'
import { AOS_REMINDERS_AUTHOR_URL, AOS_REMINDERS_URL } from 'utils/env'

/** Where the donation card was: this site is built on AoS Reminders, so support goes to its author. */
export const SupportOriginal = () => {
  const { isOffline } = useAppStatus()
  const { theme } = useTheme()

  if (isOffline) return null

  return (
    <div className={`container ${theme.bgColor} pt-4`}>
      <div className="row justify-content-center">
        <div
          className={`col-10 col-sm-8 col-md-6 col-lg-4 col-xl-4 card ${theme.bgColor} ${theme.text} py-3 text-center`}
        >
          <small>
            40K Reminders is built on{' '}
            <a href={AOS_REMINDERS_URL} target="_blank" rel="noopener noreferrer">
              AoS Reminders
            </a>{' '}
            by{' '}
            <a href={AOS_REMINDERS_AUTHOR_URL} target="_blank" rel="noopener noreferrer">
              Davis E. Ford
            </a>
            . Years of his work made this page possible.
          </small>
          <div className="mt-3 d-print-none">
            <a
              className="btn btn-outline-primary btn-sm TapTarget"
              href={`${AOS_REMINDERS_URL}/subscribe`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Support the original
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
