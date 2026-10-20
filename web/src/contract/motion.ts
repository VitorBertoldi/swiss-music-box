/* Generated from contract/motion.schema.json by json-schema-to-typescript. Do not edit; run make contract. */

/**
 * How every moving vehicle travels on one service day.
 */
export interface Motion {
  schema_version: 3;
  service_date: string;
  segments: Segment[];
  trips: Trips;
  legs: Legs;
  tunnels: Tunnel[];
}
/**
 * The path between two consecutive stops, shared by every trip that uses it.
 */
export interface Segment {
  /**
   * Flat [longitude, latitude, ...]; OSM geometry with redundant points removed
   */
  coordinates: number[];
  /**
   * The same path simplified to 15 m, for country-wide views
   */
  overview_coordinates: number[];
  /**
   * Length along the network
   */
  length_m: number;
  /**
   * How the path was found
   */
  route: "track" | "ferry_route" | "straight";
  tunnels: TunnelPassage[];
}
/**
 * The part of a segment that runs inside a tunnel, as fractions of the segment length.
 */
export interface TunnelPassage {
  /**
   * Index into Motion.tunnels
   */
  tunnel: number;
  start_fraction: number;
  end_fraction: number;
}
/**
 * Column-wise: trip i has `layer[i]` and legs `first_leg[i] .. first_leg[i]+leg_count[i]`.
 */
export interface Trips {
  layer: ("long_rail" | "mountain_rail" | "regional_rail" | "boat" | "aerial" | "funicular")[];
  first_leg: number[];
  leg_count: number[];
}
/**
 * Column-wise: leg i travels `segments[segment[i]]` (backwards if `reversed`).
 */
export interface Legs {
  segment: number[];
  reversed: boolean[];
  /**
   * May exceed 1440 for trips past midnight
   */
  depart_minute: number[];
  arrive_minute: number[];
}
/**
 * A long tunnel found in OpenStreetMap (`tunnel=yes` on rail ways).
 */
export interface Tunnel {
  id: string;
  /**
   * OSM name, or 'Tunnel near <station>' when OSM has none
   */
  name: string;
  length_m: number;
  /**
   * Flat [longitude, latitude, ...] of its axis
   */
  coordinates: number[];
}
