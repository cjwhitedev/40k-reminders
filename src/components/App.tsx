import { router } from '../bootstrap/router'
import { InstallingUpdate } from 'components/info/installingUpdate'
import { RouterProvider } from 'react-router/dom'

const App = () => (
  <div className="d-block">
    {/*
      One mount for every route, Home included: an update installs behind a modal rather than
      occupying a banner slot (#2046). Mounted here rather than in the navbar, which early-returns
      <OfflineHeader /> while offline -- exactly when a waiting worker can still need applying.
    */}
    <InstallingUpdate />
    {/* Each route renders its own navbar, so <main> wraps the whole routed tree. */}
    <main>
      <RouterProvider router={router} />
    </main>
  </div>
)

export default App
