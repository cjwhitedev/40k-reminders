/** How the reminder sheet looks: the title-bar colour, and whether printing keeps it. Kept apart from the army so clearing or switching armies keeps it. */
export interface Wh40kDisplaySettings {
  titleBarColour: string
  printInColour: boolean
}

export const WH40K_DISPLAY_STORAGE_KEY = 'wh40k-reminders:wh40k11e:display:v1'

/** The first is the site's own colour and the default; the rest stay distinct from it and each other, all dark enough for white text. */
export const WH40K_TITLE_BAR_COLOURS = [
  { name: 'Teal', value: '#1c7595' },
  { name: 'Crimson', value: '#a3262a' },
  { name: 'Forest', value: '#2f6b3a' },
  { name: 'Purple', value: '#5e3b8f' },
  { name: 'Bronze', value: '#9a5b13' },
] as const

export const WH40K_DEFAULT_DISPLAY_SETTINGS: Wh40kDisplaySettings = {
  titleBarColour: WH40K_TITLE_BAR_COLOURS[0].value,
  printInColour: false,
}

export const loadWh40kDisplaySettings = (storage: Storage): Wh40kDisplaySettings => {
  try {
    const value: unknown = JSON.parse(storage.getItem(WH40K_DISPLAY_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return WH40K_DEFAULT_DISPLAY_SETTINGS
    const { titleBarColour, printInColour } = value as Record<string, unknown>
    return {
      titleBarColour: WH40K_TITLE_BAR_COLOURS.some(colour => colour.value === titleBarColour)
        ? (titleBarColour as string)
        : WH40K_DEFAULT_DISPLAY_SETTINGS.titleBarColour,
      printInColour: typeof printInColour === 'boolean' ? printInColour : false,
    }
  } catch {
    return WH40K_DEFAULT_DISPLAY_SETTINGS
  }
}

export const saveWh40kDisplaySettings = (storage: Storage, settings: Wh40kDisplaySettings): void =>
  storage.setItem(WH40K_DISPLAY_STORAGE_KEY, JSON.stringify(settings))
