/** How the reminder sheet looks: each section's title-bar colour, and whether printing keeps them. Kept apart from the army so clearing or switching armies keeps it. */
export interface Wh40kDisplaySettings {
  /** Picked colours by section (the reminder group key, e.g. a phase); unpicked sections use the first colour. */
  sectionColours: Record<string, string>
  printInColour: boolean
}

// v2: v1 held one colour for every section.
export const WH40K_DISPLAY_STORAGE_KEY = 'wh40k-reminders:wh40k11e:display:v2'

/** The first is the site's own colour and the default; the rest stay distinct from it and each other, all dark enough for white text. */
export const WH40K_TITLE_BAR_COLOURS = [
  { name: 'Teal', value: '#1c7595' },
  { name: 'Crimson', value: '#a3262a' },
  { name: 'Forest', value: '#2f6b3a' },
  { name: 'Purple', value: '#5e3b8f' },
  { name: 'Bronze', value: '#9a5b13' },
] as const

export const WH40K_DEFAULT_DISPLAY_SETTINGS: Wh40kDisplaySettings = {
  sectionColours: {},
  printInColour: false,
}

const isListedColour = (value: unknown): value is string =>
  WH40K_TITLE_BAR_COLOURS.some(colour => colour.value === value)

export const loadWh40kDisplaySettings = (storage: Storage): Wh40kDisplaySettings => {
  try {
    const value: unknown = JSON.parse(storage.getItem(WH40K_DISPLAY_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return WH40K_DEFAULT_DISPLAY_SETTINGS
    const { sectionColours, printInColour } = value as Record<string, unknown>
    return {
      sectionColours:
        sectionColours && typeof sectionColours === 'object'
          ? Object.fromEntries(Object.entries(sectionColours).filter(([, colour]) => isListedColour(colour)))
          : {},
      printInColour: typeof printInColour === 'boolean' ? printInColour : false,
    }
  } catch {
    return WH40K_DEFAULT_DISPLAY_SETTINGS
  }
}

export const saveWh40kDisplaySettings = (storage: Storage, settings: Wh40kDisplaySettings): void =>
  storage.setItem(WH40K_DISPLAY_STORAGE_KEY, JSON.stringify(settings))

/** Picks a section's colour; the default colour is stored as no pick, keeping the settings small. */
export const pickWh40kSectionColour = (
  settings: Wh40kDisplaySettings,
  sectionKey: string,
  colour: string
): Wh40kDisplaySettings => {
  const sectionColours = { ...settings.sectionColours }
  if (colour === WH40K_TITLE_BAR_COLOURS[0].value) delete sectionColours[sectionKey]
  else sectionColours[sectionKey] = colour
  return { ...settings, sectionColours }
}
