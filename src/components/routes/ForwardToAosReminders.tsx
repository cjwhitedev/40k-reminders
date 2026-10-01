import Footer from 'components/page/footer'
import Navbar from 'components/page/navbar'
import { useTheme } from 'context/useTheme'
import { useEffect } from 'react'
import { AOS_REMINDERS_URL } from 'utils/env'

/** Account, subscription, and gift links belong to AoS Reminders; send them on with their path intact. */
const ForwardToAosReminders = () => {
  const { theme } = useTheme()
  const destination = `${AOS_REMINDERS_URL}${window.location.pathname}${window.location.search}`

  useEffect(() => {
    window.location.replace(destination)
  }, [destination])

  return (
    <div className={`d-block ${theme.bgColor}`}>
      <div className={`${theme.headerColor} py-2 d-print-none`}>
        <Navbar />
      </div>
      <div className={`container ${theme.text} py-5 text-center`}>
        <h1 className="h2">Taking you to AoS Reminders</h1>
        <p className="lead">
          Accounts, subscriptions, and gifts are part of Davis E. Ford&apos;s AoS Reminders.
        </p>
        <a className="btn btn-outline-primary" href={destination}>
          Continue to aosreminders.com
        </a>
      </div>
      <Footer />
    </div>
  )
}

export default ForwardToAosReminders
