import { LoadingBody } from 'components/helpers/suspenseFallbacks'
import type { ComponentType, ReactNode } from 'react'
import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { ROUTES } from 'utils/env'

const Faq = lazy(() => import('components/routes/Faq'))
const ForwardToAosReminders = lazy(() => import('components/routes/ForwardToAosReminders'))
const Wh40kHome = lazy(() => import('components/routes/Wh40kHome'))

/*
 * React Router v5 wrapped the whole <Switch> in one <Suspense>; a data router renders each route
 * element directly, so every lazy screen keeps its own fallback boundary with the same LoadingBody.
 */
const lazyScreen = (Screen: ComponentType): ReactNode => (
  <Suspense fallback={<LoadingBody />}>
    <Screen />
  </Suspense>
)

/*
 * The router is a module singleton so code outside the React tree, such as App's banner slot, can
 * subscribe through stable data-router APIs. The basename follows the build's base path, which is
 * `/40k-reminders/` on GitHub Pages and `/` locally.
 */
export const router = createBrowserRouter(
  [
    { path: ROUTES.HOME, element: lazyScreen(Wh40kHome) },
    { path: ROUTES.FAQ, element: lazyScreen(Faq) },
    // Accounts and subscriptions belong to AoS Reminders; those links keep working by forwarding there.
    { path: ROUTES.JOIN, element: lazyScreen(ForwardToAosReminders) },
    { path: ROUTES.REDEEM, element: lazyScreen(ForwardToAosReminders) },
    { path: ROUTES.SUBSCRIBE, element: lazyScreen(ForwardToAosReminders) },
    { path: ROUTES.PROFILE, element: lazyScreen(ForwardToAosReminders) },
    { path: ROUTES.WH40K, element: <Navigate to={ROUTES.HOME} replace /> },
  ],
  { basename: import.meta.env.BASE_URL }
)
