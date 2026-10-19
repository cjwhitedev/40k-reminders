import Wh40kHome from 'components/routes/Wh40kHome'
import { WH40K_CATALOG } from '../../wh40k11e/generated/catalog'
import { typicalSpaceMarineArmy } from '../../wh40k11e/samples/typicalSpaceMarines'

const sample = () => typicalSpaceMarineArmy(WH40K_CATALOG)

/** /sm-test: the home page opened on a typical 2000-point Space Marines list, for reviewing. */
const Wh40kSampleArmy = () => <Wh40kHome sample={sample} />

export default Wh40kSampleArmy
