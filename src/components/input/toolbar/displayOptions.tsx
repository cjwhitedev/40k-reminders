import type { Wh40kDisplaySettings } from '../../../wh40k11e/runtime/displaySettings'

/** Whether printing keeps the sections' title-bar colours or stays black and white. */
const DisplayOptions = ({
  settings,
  onChange,
}: {
  settings: Wh40kDisplaySettings
  onChange: (settings: Wh40kDisplaySettings) => void
}) => (
  <div className="container d-print-none">
    <div className="row justify-content-center align-items-center pb-2 DisplayOptions">
      <div className="col-auto small px-2">Colour a section with the palette on its title bar.</div>
      <div className="col-auto form-check form-switch px-2 ms-2 mb-0">
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
