/* Generated from contract/day.schema.json by json-schema-to-typescript. Do not edit; run make contract. */

/**
 * Everything the player needs to perform one service day.
 */
export interface Day {
  schema_version: 3;
  /**
   * ISO date, e.g. 2026-10-21
   */
  service_date: string;
  /**
   * Feed the day was built from
   */
  source: string;
  minutes_per_day: 1440;
  texture_bins: number;
  bounds: Bounds;
  stations: Station[];
  notes: NoteEvents;
  textures: TextureSeries[];
  tunnels: TunnelSeries[];
}
/**
 * Extent of the map in LV95 metres.
 */
export interface Bounds {
  min_easting_m: number;
  max_easting_m: number;
  min_northing_m: number;
  max_northing_m: number;
}
/**
 * A parent station that emits note events.
 */
export interface Station {
  name: string;
  easting_m: number;
  northing_m: number;
  longitude: number;
  latitude: number;
  elevation_m: number;
}
/**
 * Departures of sparse layers, stored column-wise to keep the file small.
 *
 * Row i is: at `minute[i]`, a vehicle of `layer[i]` departs from `stations[station[i]]`.
 */
export interface NoteEvents {
  /**
   * Minute of day, 0..1439 (service after 24:00 wraps)
   */
  minute: number[];
  /**
   * Index into Day.stations
   */
  station: number[];
  layer: ("long_rail" | "mountain_rail" | "boat" | "aerial" | "funicular")[];
  /**
   * True if this is the first stop of its trip
   */
  trip_start: boolean[];
}
/**
 * Departure counts of a dense layer, per minute and per west-to-east bin.
 */
export interface TextureSeries {
  layer: "regional_rail" | "tram" | "bus";
  /**
   * counts[minute][bin], bins ordered west to east
   */
  counts: number[][];
}
/**
 * How many trains are inside a long OSM tunnel at each minute of the day.
 */
export interface TunnelSeries {
  /**
   * Matches Motion.tunnels[].id
   */
  id: string;
  name: string;
  easting_m: number;
  northing_m: number;
  /**
   * occupancy[minute], length MINUTES_PER_DAY
   */
  occupancy: number[];
}
