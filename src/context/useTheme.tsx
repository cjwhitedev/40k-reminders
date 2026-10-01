import React, { useEffect, useMemo } from 'react'
import LightTheme from 'theme/light'
import { ITheme } from 'types/theme'

/*
 * Light only. Dark theme was an AoS Reminders subscriber feature, and this site does not offer
 * features that the original charges for.
 */
interface IThemeProvider {
  isDark: boolean
  isLight: boolean
  theme: ITheme
}

const ThemeContext = React.createContext<IThemeProvider | void>(undefined)

const ThemeProvider = ({ children }: React.PropsWithChildren<object>) => {
  // Assign the theme's bgColor to the root element
  useEffect(() => {
    const element = document.getElementById('root')
    if (element) element.className = LightTheme.bgColor

    /*
     * ...and to <body>, which owns the canvas: iOS rubber-band overscroll and the gap a short page
     * leaves are painted from <body>. `classList` rather than `className`, because react-modal writes
     * `ReactModal__Body--open` onto <body> while a modal is open and assigning `className` would drop it.
     */
    document.body.classList.add(LightTheme.bgColor)
  }, [])

  const value = useMemo(() => ({ isDark: false, isLight: true, theme: LightTheme }), [])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

const useTheme = () => {
  const context = React.useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export { ThemeProvider, useTheme }
