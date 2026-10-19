import { WH40K_TITLE_BAR_COLOURS, type Wh40kDisplaySettings } from '../../../wh40k11e/runtime/displaySettings'

/** Swatches for the title-bar colour, and whether printing keeps it or stays black and white. */
const DisplayOptions = ({
  settings,
  onChange,
}: {
  settings: Wh40kDisplaySettings
  onChange: (settings: Wh40kDisplaySettings) => void
}) => (
  <div className="container d-print-none">
    <div className="row justify-content-center align-items-center pb-2 DisplayOptions">
      <div className="col-auto d-flex align-items-center px-2" role="radiogroup" aria-label="Title colour">
        <span className="me-2 small">Title colour</span>
        {WH40K_TITLE_BAR_COLOURS.map(colour => (
          <button
            key={colour.value}
            type="button"
            role="radio"
            aria-checked={settings.titleBarColour === colour.value}
            aria-label={colour.name}
            title={colour.name}
            className={`ColourSwatch${settings.titleBarColour === colour.value ? ' ColourSwatch--selected' : ''}`}
            style={{ backgroundColor: colour.value }}
            onClick={() => onChange({ ...settings, titleBarColour: colour.value })}
          />
        ))}
      </div>
      <div className="col-auto form-check form-switch px-2 ms-3 mb-0">
        <input
          className="form-check-input ms-0 me-2"
          type="checkbox"
          role="switch"
          id="printInColour"
          checked={settings.printInColour}
          onChange={event => onChange({ ...settings, printInColour: event.target.checked })}
        />
        <label className="form-check-label small" htmlFor="printInColour">
          Print in colour
        </label>
      </div>
    </div>
  </div>
)

export default DisplayOptions
