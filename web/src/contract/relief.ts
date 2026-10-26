/* Generated from contract/relief.schema.json by json-schema-to-typescript. Do not edit; run make contract. */

/**
 * A shaded-relief image, Web-Mercator aligned, transparent outside Switzerland.
 */
export interface Relief {
  schema_version: 4;
  /**
   * PNG file name, next to this file
   */
  image: string;
  /**
   * Longitude of the left edge
   */
  west: number;
  /**
   * Latitude of the bottom edge
   */
  south: number;
  east: number;
  north: number;
  attribution: string;
}
