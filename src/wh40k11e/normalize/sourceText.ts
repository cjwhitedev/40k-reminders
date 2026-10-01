import type { SourceTextNormalizationOptions } from '../../aos4/normalize/text'
import { WH40K_LIST_ITEM_MARKER } from '../domain/rules'

/**
 * Wahapedia wraps flavour text in `ShowFluff` and prints a core ability's heading and Core Rules
 * section number (`LEADER` `24.22`) in `abNameWrap`; neither is rules text.
 */
export const WH40K_SOURCE_TEXT_OPTIONS: SourceTextNormalizationOptions = {
  skipClasses: ['ShowFluff', 'abNameWrap'],
  listItemMarker: WH40K_LIST_ITEM_MARKER,
}

/** The text the timing parsers read: list items as plain lines, as the grammar was written for. */
export const withoutListMarkers = (text: string): string =>
  text
    .split('\n')
    .map(line => (line.startsWith(WH40K_LIST_ITEM_MARKER) ? line.slice(WH40K_LIST_ITEM_MARKER.length) : line))
    .join('\n')
