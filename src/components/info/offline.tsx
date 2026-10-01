import { useAppStatus } from 'context/useAppStatus'
import { useTheme } from 'context/useTheme'
import { FiWifiOff } from 'react-icons/fi'

const OfflineComponent = () => {
  const { isOnline } = useAppStatus()
  const { theme } = useTheme()

  if (isOnline) return null

  return (
    <div className="container pt-4">
      <div className="row justify-content-center">
        <div
          className={`col-12 col-sm-8 col-md-6 col-lg-6 col-xl-6 col-xxl-4 ${theme.card} ${theme.bgColor} ${theme.text} py-3 text-center`}
        >
          <p className="text-danger">
            <FiWifiOff className="me-2" />
            You are in <strong>Offline</strong> mode.
            <FiWifiOff className="ms-2" />
          </p>
          <p className="mb-0">Your army and reminders still work; links to other sites will not.</p>
        </div>
      </div>
    </div>
  )
}

export default OfflineComponent
