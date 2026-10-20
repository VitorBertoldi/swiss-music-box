import type { AssetBundle } from "../contract/asset_bundle";
import { SCHEMA_VERSION } from "../music/constants";

/**
 * Map assets packed into JSON bundles (see `AssetBundle` in the contract), for hosts that
 * only serve common web file types. MapLibre requests them as
 * `bundle://<bundle file URL>?entry=<entry name>`; a protocol handler answers from the bundle.
 */
export const BUNDLE_PROTOCOL = "bundle";
const ENTRY_PARAMETER = "?entry=";

export interface BundleRequest {
	readonly fileUrl: string;
	readonly entry: string;
}

/** A `bundle://` URL template; `entryTemplate` may contain MapLibre placeholders like {x}. */
export function bundleUrl(fileUrl: string, entryTemplate: string): string {
	return `${BUNDLE_PROTOCOL}://${fileUrl}${ENTRY_PARAMETER}${entryTemplate}`;
}

export function parseBundleUrl(url: string): BundleRequest {
	const withoutScheme = url.slice(`${BUNDLE_PROTOCOL}://`.length);
	const split = withoutScheme.indexOf(ENTRY_PARAMETER);
	if (split < 0) throw new Error(`not a bundle URL: ${url}`);
	return {
		fileUrl: withoutScheme.slice(0, split),
		// MapLibre URL-encodes glyph font names ("Noto%20Sans%20Regular").
		entry: decodeURIComponent(withoutScheme.slice(split + ENTRY_PARAMETER.length)),
	};
}

export type JsonFetcher = (url: string) => Promise<unknown>;

const fetchJson: JsonFetcher = async (url) => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`could not load ${url}: HTTP ${response.status}`);
	return response.json();
};

/** Loads each bundle file once and hands out its entries as bytes. */
export class AssetBundleLoader {
	private readonly bundles = new Map<string, Promise<AssetBundle["entries"]>>();

	constructor(private readonly fetcher: JsonFetcher = fetchJson) {}

	/** The entry's bytes, or null if the bundle has no such entry (e.g. an all-sea tile). */
	async entry({ fileUrl, entry }: BundleRequest): Promise<ArrayBuffer | null> {
		let bundle = this.bundles.get(fileUrl);
		if (bundle === undefined) {
			bundle = this.fetcher(fileUrl).then((document) => entriesOf(document, fileUrl));
			this.bundles.set(fileUrl, bundle);
		}
		const encoded = (await bundle)[entry];
		return encoded === undefined ? null : decodeBase64(encoded);
	}
}

function entriesOf(document: unknown, fileUrl: string): AssetBundle["entries"] {
	const bundle = document as Partial<AssetBundle>;
	if (bundle.schema_version !== SCHEMA_VERSION || typeof bundle.entries !== "object") {
		throw new Error(`${fileUrl} is not an asset bundle of schema version ${SCHEMA_VERSION}`);
	}
	return bundle.entries;
}

export function decodeBase64(encoded: string): ArrayBuffer {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}
