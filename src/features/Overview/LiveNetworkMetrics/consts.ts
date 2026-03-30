export type NetworkMetricsCardType = "Ingress" | "Egress";

export const networkProtocols = [
  "turbine.unicast",
  "turbine.multicast",
  "gossip",
  "tpu",
  "repair",
  "metrics",
  "shreds",
  "mcast",
  "mcast_new",
  "turbine_dup",
] as const;

type NetworkProtocol = (typeof networkProtocols)[number];
export type NetworkMetricsTableRowLabel = "Total";

// Max for the Total row utilization bar (1 Gb/s link).
export const NETWORK_TOTAL_MAX_BYTES = 1_000_000_000 / 8;

// For "shreds"/"mcast"/"mcast_new"/"turbine_dup", the max is a count (shreds/s), not bytes.
export const networkMaxByteValues: {
  [key in NetworkMetricsCardType]: {
    [key in NetworkProtocol | NetworkMetricsTableRowLabel]: number;
  };
} = {
  Ingress: {
    "turbine.unicast": 64_000_000 / 8,
    "turbine.multicast": 64_000_000 / 8,
    gossip: 20_000_000 / 8,
    tpu: 100_000_000 / 8,
    repair: 10_000_000 / 8,
    metrics: 10_000 / 8,
    shreds: 100_000, // ~100k shreds/s max for utilization bar
    mcast: 100_000,
    mcast_new: 100_000,
    turbine_dup: 100_000,
    Total:
      (64_000_000 +
        64_000_000 +
        20_000_000 +
        100_000_000 +
        10_000_000 +
        10_000) /
      8,
  },
  Egress: {
    "turbine.unicast": 1_000_000_000 / 8,
    "turbine.multicast": 1_000_000_000 / 8,
    gossip: 20_000_000 / 8,
    tpu: 1_000_000 / 8,
    repair: 10_000_000 / 8,
    metrics: 10_000 / 8,
    shreds: 100_000,
    mcast: 100_000,
    mcast_new: 100_000,
    turbine_dup: 100_000,
    Total:
      (1_000_000_000 +
        1_000_000_000 +
        20_000_000 +
        1_000_000 +
        10_000_000 +
        10_000 +
        1_000_000_000) /
      8,
  },
};
