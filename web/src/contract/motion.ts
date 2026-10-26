/* Generated from contract/motion.schema.json by json-schema-to-typescript. Do not edit; run make contract. */

/**
 * How every moving vehicle travels on one service day.
 */
export interface Motion {
  schema_version: 4;
  service_date: string;
  segments: Segment[];
  trips: Trips;
  legs: Legs;
  lead_ins: LeadIn[];
  pylons: Pylon[];
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
   * Height above sea level per point of `coordinates`, in decimetres
   */
  heights_dm: number[];
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
  route: "track" | "ferry_route" | "rope" | "straight";
  /**
   * For a rope: what hangs from it (heights are the rope's), else null
   */
  ropeway: ("cable_car" | "gondola" | "chair_lift") | null;
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
  /**
   * Index into Motion.lead_ins where this leg starts a run (the trip's first leg, after a reversal or a gap), else -1
   */
  lead_in: number[];
}
/**
 * The track behind the start of a run, where a waiting train's rear cars stand.
 */
export interface LeadIn {
  /**
   * Flat [longitude, latitude, ...] in travel order, ending where the run starts
   */
  coordinates: number[];
  /**
   * Height per point, in decimetres
   */
  heights_dm: number[];
}
/**
 * A ropeway pylon (`aerialway=pylon`) on a rope in use: where it stands and how high.
 */
export interface Pylon {
  longitude: number;
  latitude: number;
  /**
   * Height of the ground at its foot, in decimetres
   */
  base_dm: number;
  /**
   * Height of its top, where the rope runs, in decimetres
   */
  top_dm: number;
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
