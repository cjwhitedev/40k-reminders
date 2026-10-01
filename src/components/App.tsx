import { router } from '../bootstrap/router'
import { UpdateAvailable } from 'components/info/updateAvailable'
import { useSyncExternalStore } from 'react'
import { RouterProvider } from 'react-router/dom'
import { ROUTES } from 'utils/env'

/*
 * App sits outside <RouterProvider>, so the router hooks are unavailable here. The data router is a
 * module singleton and exposes a subscription for the current location.
 */
const subscribeToRouter = (onStoreChange: () => void) => router.subscribe(onStoreChange)
const getPathname = () => router.state.location.pathname

const App = () => {
  const pathname = useSyncExternalStore(subscribeToRouter, getPathname)

  return (
    <div className="d-block">
      {/*
        Home owns a banner slot under its masthead and renders the prompt there itself, so this
        instance covers only the routes that have nowhere better to put it. Mounted here rather than
        in the navbar: Navbar early-returns <OfflineHeader /> while offline, which would hide the
        prompt exactly when a client has a waiting worker and loses the network.
      */}
      {pathname !== ROUTES.HOME && <UpdateAvailable />}
      {/* Each route renders its own navbar, so <main> wraps the whole routed tree. */}
      <main>
        <RouterProvider router={router} />
      </main>
    </div>
  )
}

export default App
