/**
 * Extra layer props understood by deck.gl's MapLibre overlay (not exported by the package):
 * `beforeId` draws a deck layer just below that map layer, e.g. below the street labels.
 */
export interface OverlayProps {
	readonly beforeId?: string;
}
