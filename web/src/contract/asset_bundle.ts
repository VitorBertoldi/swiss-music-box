/* Generated from contract/asset_bundle.schema.json by json-schema-to-typescript. Do not edit; run make contract. */

/**
 * Binary map assets (vector tiles or label glyphs) packed into one JSON file.
 *
 * Some static hosts only serve common web file types; protobuf tiles and glyphs are not
 * among them. The player reads entries from bundles through a `bundle://` map protocol.
 */
export interface AssetBundle {
  schema_version: 3;
  /**
   * Entry name (e.g. 'x/y') -> base64 bytes
   */
  entries: {
    [k: string]: string;
  };
}
