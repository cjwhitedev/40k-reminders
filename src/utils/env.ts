export const isDev = process.env.NODE_ENV === 'development'
export const isTest = process.env.NODE_ENV === 'test'
export const isProd = process.env.NODE_ENV === 'production'

export const PAYPAL_CLIENT_ID = isProd
  ? 'AfLnIE4o2jXPWtGItGIxptUDHTHfWIJS53doOYvAM2Y3-04croyYfZPxT_JR2oRAaavF14oYNtCe7IKw'
  : 'AUdnPSV280IH8pjveo62IzfQJgfFo0MoJ9w-zouTipgjAethtmcvHFjV8DXCCqoti4WHdbjhMNnwn9oa'

export const GITHUB_URL = '//github.com/daviseford/aos-reminders'

/** Davis E. Ford's AoS Reminders, which this site is built on; AoS players and account holders go there. */
export const AOS_REMINDERS_URL = 'https://aosreminders.com'
export const AOS_REMINDERS_AUTHOR_URL = 'https://daviseford.com'

export const WH40K_GITHUB_URL = 'https://github.com/cjwhitedev/40k-reminders'
export const WH40K_AUTHOR_URL = 'https://github.com/cjwhitedev'

export const ROUTES = {
  FAQ: '/faq',
  HOME: '/',
  JOIN: '/join',
  PROFILE: '/profile',
  REDEEM: '/redeem',
  SUBSCRIBE: '/subscribe',
  WH40K: '/40k',
} as const
