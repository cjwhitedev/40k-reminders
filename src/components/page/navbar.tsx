import { OfflineHeader } from 'components/helpers/suspenseFallbacks'
import NavbarWrapper from 'components/page/navbar_wrapper'
import { useAppStatus } from 'context/useAppStatus'
import { Link } from 'react-router'
import { navbarStyles } from 'theme/helperClasses'
import { AOS_REMINDERS_URL, ROUTES } from 'utils/env'

const Navbar = () => {
  const { isOffline } = useAppStatus()
  const { pathname } = window.location

  if (isOffline) return <OfflineHeader />

  return (
    <NavbarWrapper>
      {pathname !== ROUTES.HOME && (
        <Link to={ROUTES.HOME} className={navbarStyles.link}>
          Home
        </Link>
      )}
      {pathname !== ROUTES.FAQ && (
        <Link to={ROUTES.FAQ} className={navbarStyles.link}>
          FAQ
        </Link>
      )}
      {/* Age of Sigmar players belong on the original site this one is built from. */}
      <a className={navbarStyles.btn} href={AOS_REMINDERS_URL} target="_blank" rel="noopener noreferrer">
        AoS Reminders
      </a>
    </NavbarWrapper>
  )
}

export default Navbar
