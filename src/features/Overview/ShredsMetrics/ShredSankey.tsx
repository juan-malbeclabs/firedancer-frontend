import { useMemo, useRef, useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { liveNetworkMetricsAtom } from "../../../api/atoms";
import { Sankey } from "../../../sankey";
import AutoSizer from "react-virtualized-auto-sizer";
import Card from "../../../components/Card";
import { Flex, Text } from "@radix-ui/themes";
import tableStyles from "../../Gossip/table.module.css";
import { headerGap } from "../../Gossip/consts";
import { useEmaValue } from "../../../hooks/useEma";
import type { McastSrc } from "../../../api/types";

// Ingress array indices
const TURBINE_BYTES_IDX = 0;
const SHREDS_IDX = 6; /* turbine shred count */
const MCAST_IDX = 7; /* mcast shred count */
const DEDUP_SKIPPED_IDX = 10; /* shreds dropped by smcast as duplicates */
const OKAY_IDX = 15; /* shreds passing FEC resolver as new (okay) */
const COMPLETES_IDX = 16; /* shreds completing a FEC set */
const TXPROC_FEC_SETS_IDX = 17; /* FEC sets forwarded to txproc tile */

const emaOptions = { halfLifeMs: 1_000 };

// Approximate shreds per FEC set for txproc proportioning
const AVG_SHREDS_PER_FEC_SET = 32;

// Node name constants
const NODE_TURBINE_IN = "turbine in";
const NODE_MCAST_RCVR = "mcast receiver"; /* aggregates all multicast sources */
const NODE_SHREDPROC =
  "shredproc"; /* smcast tile — deduplicates turbine + mcast */
const NODE_TURBINE_DEDUP =
  "turbine dedup"; /* turbine-vs-mcast cross-source dups */
const NODE_DEDUP_DROP = "dedup drop"; /* fallback when no per-source data */
const NODE_FORWARDED = "forwarded";
const NODE_TURBINE_FWD = "turbine fwd";
const NODE_MCAST_FWD = "mcast fwd";
const NODE_TXPROC = "DEX Transactions";
const NODE_REPAIR = "repair";
const NODE_LOCAL = "local replay";

function formatShredsPerSec(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M/s`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k/s`;
  return `${Math.round(v)}/s`;
}

function formatMbps(bytes: number): string {
  const mbps = (bytes * 8) / 1_000_000;
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gb/s`;
  return `${mbps.toFixed(1)} Mb/s`;
}

interface PerSrcEmaState {
  prevShreds: number;
  prevDedup: number;
  prevTs: number;
  emaShreds: number;
  emaDedup: number;
}

/** EMA hook for an array of per-source cumulative counters keyed by label. */
function useMcastSrcsEma(
  srcs: McastSrc[] | undefined,
  halfLifeMs: number,
): Map<string, { shreds: number; dedup: number }> {
  const tauMs = halfLifeMs / Math.log(2);
  const stateRef = useRef<Map<string, PerSrcEmaState>>(new Map());
  const [result, setResult] = useState<
    Map<string, { shreds: number; dedup: number }>
  >(new Map());

  useEffect(() => {
    if (!srcs || srcs.length === 0) return;
    const now = performance.now();
    const newResult = new Map<string, { shreds: number; dedup: number }>();

    for (const src of srcs) {
      const state = stateRef.current.get(src.label);
      if (!state) {
        stateRef.current.set(src.label, {
          prevShreds: src.shreds,
          prevDedup: src.dedup,
          prevTs: now,
          emaShreds: 0,
          emaDedup: 0,
        });
        newResult.set(src.label, { shreds: 0, dedup: 0 });
        continue;
      }
      const dtMs = now - state.prevTs;
      const dvShreds = src.shreds - state.prevShreds;
      const dvDedup = src.dedup - state.prevDedup;
      if (dvShreds < 0 || dvDedup < 0) {
        // Counter reset — reinitialize
        stateRef.current.set(src.label, {
          prevShreds: src.shreds,
          prevDedup: src.dedup,
          prevTs: now,
          emaShreds: 0,
          emaDedup: 0,
        });
        newResult.set(src.label, { shreds: 0, dedup: 0 });
        continue;
      }
      const w = -Math.expm1(-dtMs / tauMs);
      const rateShreds = dtMs > 0 ? (dvShreds / dtMs) * 1_000 : state.emaShreds;
      const rateDedup = dtMs > 0 ? (dvDedup / dtMs) * 1_000 : state.emaDedup;
      const emaShreds = state.emaShreds * (1 - w) + rateShreds * w;
      const emaDedup = state.emaDedup * (1 - w) + rateDedup * w;
      stateRef.current.set(src.label, {
        prevShreds: src.shreds,
        prevDedup: src.dedup,
        prevTs: now,
        emaShreds,
        emaDedup,
      });
      newResult.set(src.label, {
        shreds: Math.max(0, emaShreds),
        dedup: Math.max(0, emaDedup),
      });
    }

    setResult(newResult);
  }, [srcs, tauMs]);

  return result;
}

interface SankeyInnerProps {
  turbineShreds: number;
  /** Per-source mcast data when available (IP:Port → shreds/s + dedup/s) */
  mcastSrcs: Array<{ label: string; shreds: number; dedup: number }> | null;
  /** Aggregate fallback when no per-source data */
  mcastShreds: number;
  dedupSkipped: number;
  turbineFwdBytes: number;
  mcastFwdBytes: number;
  /** okay + completes from FEC resolver — each generates a repair/replay notification */
  repairShreds: number;
  /** FEC sets forwarded to txproc tile */
  txprocFecSets: number;
  height: number;
  width: number;
}

function SankeyInner({
  turbineShreds,
  mcastSrcs,
  mcastShreds,
  dedupSkipped,
  turbineFwdBytes,
  mcastFwdBytes,
  repairShreds,
  txprocFecSets,
  height,
  width,
}: SankeyInnerProps) {
  const data = useMemo(() => {
    const hasSrcs = mcastSrcs && mcastSrcs.length > 0;
    const totalMcast = hasSrcs
      ? mcastSrcs.reduce((s, src) => s + src.shreds, 0)
      : mcastShreds;

    const t = Math.max(1, turbineShreds);
    const m = Math.max(1, totalMcast);
    const totalIn = t + m;

    // Per-source race losses (before_credit path in smcast tile)
    const mcastSrcDedupTotal = hasSrcs
      ? mcastSrcs.reduce((s, src) => s + src.dedup, 0)
      : 0;
    // Remaining dedup = after_frag turbine-vs-mcast dups
    const shredprocDedup = Math.max(0, dedupSkipped - mcastSrcDedupTotal);
    // Per-source dups bypass shredproc, so forwarded excludes only after_frag dups
    const forwarded = Math.max(1, totalIn - shredprocDedup);

    const avgShredBytes = 1200;
    const turbineFwdShredsRaw = Math.round(turbineFwdBytes / avgShredBytes);
    const mcastFwdShredsRaw = Math.round(mcastFwdBytes / avgShredBytes);
    const txprocShredsRaw = Math.round(txprocFecSets * AVG_SHREDS_PER_FEC_SET);

    // Cap downstream links so their sum never exceeds forwarded (flow conservation)
    const totalOut =
      turbineFwdShredsRaw + mcastFwdShredsRaw + repairShreds + txprocShredsRaw;
    const scale =
      totalOut > forwarded && totalOut > 0 ? forwarded / totalOut : 1;
    const turbineFwdShreds = Math.round(turbineFwdShredsRaw * scale);
    const mcastFwdShreds = Math.round(mcastFwdShredsRaw * scale);
    const repairShredsScaled = Math.round(repairShreds * scale);
    const txprocShreds = Math.round(txprocShredsRaw * scale);

    const nodes: { id: string; fixedLayer?: number; dropPctLabel?: string }[] =
      [];

    // Column 0: source nodes (pinned to first column)
    {
      const turbineDropPct =
        shredprocDedup > 0
          ? `${(Math.min(shredprocDedup / Math.max(1, t), 1) * 100).toFixed(1)}% drop`
          : undefined;
      nodes.push({
        id: NODE_TURBINE_IN,
        fixedLayer: 0,
        dropPctLabel: turbineDropPct,
      });
    }
    if (hasSrcs) {
      for (const src of mcastSrcs) {
        const total = src.shreds + src.dedup;
        const dropPct =
          src.dedup > 0
            ? `${(Math.min(src.dedup / Math.max(1, total), 1) * 100).toFixed(1)}% drop`
            : undefined;
        nodes.push({ id: src.label, fixedLayer: 0, dropPctLabel: dropPct });
      }
    }

    // Column 1: mcast receiver first (above dedup drops), then dedup drop nodes
    nodes.push({ id: NODE_MCAST_RCVR });
    if (shredprocDedup > 0)
      nodes.push({ id: NODE_TURBINE_DEDUP, fixedLayer: 1 });
    if (hasSrcs) {
      for (const src of mcastSrcs) {
        if (src.dedup > 0)
          nodes.push({ id: `${src.label} dedup`, fixedLayer: 1 });
      }
    } else if (mcastSrcDedupTotal > 0) {
      nodes.push({ id: NODE_DEDUP_DROP, fixedLayer: 1 });
    }

    nodes.push({ id: NODE_SHREDPROC });
    nodes.push({ id: NODE_FORWARDED });
    if (turbineFwdShreds > 0) nodes.push({ id: NODE_TURBINE_FWD });
    if (mcastFwdShreds > 0) nodes.push({ id: NODE_MCAST_FWD });
    if (repairShredsScaled > 0) nodes.push({ id: NODE_REPAIR });
    if (txprocShreds > 0) nodes.push({ id: NODE_TXPROC });

    // Local replay: shreds that pass dedup but aren't attributed to any forwarded output
    const outputSum =
      turbineFwdShreds + mcastFwdShreds + repairShredsScaled + txprocShreds;
    const localShreds = Math.max(0, forwarded - outputSum);
    if (localShreds > 1) nodes.push({ id: NODE_LOCAL });

    // shredprocDedup = turbine-vs-mcast cross-source dups: turbine shreds dropped
    // because mcast already had them. Attributed to turbine in, not mcast receiver.
    const turbineToShredproc = Math.max(1, t - shredprocDedup);
    const links: { source: string; target: string; value: number }[] = [
      {
        source: NODE_TURBINE_IN,
        target: NODE_SHREDPROC,
        value: turbineToShredproc,
      },
    ];
    if (shredprocDedup > 0) {
      links.push({
        source: NODE_TURBINE_IN,
        target: NODE_TURBINE_DEDUP,
        value: Math.min(shredprocDedup, t - 1),
      });
    }

    if (hasSrcs) {
      for (const src of mcastSrcs) {
        // Main flow first (so it sorts above the dedup link in d3Sankey)
        links.push({
          source: src.label,
          target: NODE_MCAST_RCVR,
          value: Math.max(1, src.shreds),
        });
        if (src.dedup > 0) {
          links.push({
            source: src.label,
            target: `${src.label} dedup`,
            value: src.dedup,
          });
        }
      }
    } else if (mcastSrcDedupTotal > 0) {
      links.push({
        source: NODE_MCAST_RCVR,
        target: NODE_DEDUP_DROP,
        value: mcastSrcDedupTotal,
      });
    }
    // mcast receiver → shredproc: full m (cross-source dedup is already on turbine side)
    links.push({
      source: NODE_MCAST_RCVR,
      target: NODE_SHREDPROC,
      value: m,
    });
    links.push({
      source: NODE_SHREDPROC,
      target: NODE_FORWARDED,
      value: forwarded,
    });

    if (turbineFwdShreds > 0) {
      links.push({
        source: NODE_FORWARDED,
        target: NODE_TURBINE_FWD,
        value: turbineFwdShreds,
      });
    }
    if (mcastFwdShreds > 0) {
      links.push({
        source: NODE_FORWARDED,
        target: NODE_MCAST_FWD,
        value: mcastFwdShreds,
      });
    }
    if (repairShredsScaled > 0) {
      links.push({
        source: NODE_FORWARDED,
        target: NODE_REPAIR,
        value: repairShredsScaled,
      });
    }
    if (txprocShreds > 0) {
      links.push({
        source: NODE_FORWARDED,
        target: NODE_TXPROC,
        value: txprocShreds,
      });
    }
    if (localShreds > 1) {
      links.push({
        source: NODE_FORWARDED,
        target: NODE_LOCAL,
        value: localShreds,
      });
    }

    return { nodes, links };
  }, [
    turbineShreds,
    mcastSrcs,
    mcastShreds,
    dedupSkipped,
    turbineFwdBytes,
    mcastFwdBytes,
    repairShreds,
    txprocFecSets,
  ]);

  return (
    <Sankey
      height={height}
      width={width}
      data={data}
      margin={{ top: 10, right: 120, bottom: 10, left: 130 }}
      align="center"
      isInteractive={false}
      nodeThickness={0}
      nodeSpacing={24}
      nodeBorderWidth={0}
      sort="input"
      nodeBorderRadius={0}
      linkOpacity={1}
      enableLinkGradient
      labelPosition="outside"
      labelPadding={14}
      animate={false}
      nodeTooltip={NullComponent}
      linkTooltip={NullComponent}
      valueFormat={(v) => formatShredsPerSec(v)}
    />
  );
}

function NullComponent() {
  return null;
}

export default function ShredSankey() {
  const liveNetworkMetrics = useAtomValue(liveNetworkMetricsAtom);

  const turbineShredsRaw = liveNetworkMetrics?.ingress[SHREDS_IDX] ?? 0;
  const mcastShredsRaw = liveNetworkMetrics?.ingress[MCAST_IDX] ?? 0;
  const dedupSkippedRaw = liveNetworkMetrics?.ingress[DEDUP_SKIPPED_IDX] ?? 0;
  const okayRaw = liveNetworkMetrics?.ingress[OKAY_IDX] ?? 0;
  const completesRaw = liveNetworkMetrics?.ingress[COMPLETES_IDX] ?? 0;
  const txprocFecSetsRaw =
    liveNetworkMetrics?.ingress[TXPROC_FEC_SETS_IDX] ?? 0;
  const turbineFwdBytesRaw = liveNetworkMetrics?.egress[0] ?? 0;
  const mcastFwdBytesRaw =
    (liveNetworkMetrics?.egress[1] ?? 0) + (liveNetworkMetrics?.egress[6] ?? 0);
  const turbineBytesRaw = liveNetworkMetrics?.ingress[TURBINE_BYTES_IDX] ?? 0;

  const turbineShreds = useEmaValue(turbineShredsRaw, emaOptions);
  const mcastShreds = useEmaValue(mcastShredsRaw, emaOptions);
  const dedupSkipped = useEmaValue(dedupSkippedRaw, emaOptions);
  const okay = useEmaValue(okayRaw, emaOptions);
  const completes = useEmaValue(completesRaw, emaOptions);
  const txprocFecSets = useEmaValue(txprocFecSetsRaw, emaOptions);
  const turbineFwdBytes = useEmaValue(turbineFwdBytesRaw, emaOptions);
  const mcastFwdBytes = useEmaValue(mcastFwdBytesRaw, emaOptions);
  const turbineBytes = useEmaValue(turbineBytesRaw, emaOptions);

  // Per-source EMA — used when mcast_srcs is available
  const rawSrcs = liveNetworkMetrics?.mcast_srcs;
  const srcEmaMap = useMcastSrcsEma(rawSrcs, emaOptions.halfLifeMs);

  const mcastSrcs = useMemo(() => {
    if (!rawSrcs || rawSrcs.length === 0) return null;
    return rawSrcs.map((src) => ({
      label: src.label,
      shreds: Math.round(srcEmaMap.get(src.label)?.shreds ?? 0),
      dedup: Math.round(srcEmaMap.get(src.label)?.dedup ?? 0),
    }));
  }, [rawSrcs, srcEmaMap]);

  if (!liveNetworkMetrics) return null;

  const mcastSrcTotal = mcastSrcs
    ? mcastSrcs.reduce((s, src) => s + src.shreds, 0)
    : 0;
  const hasData = turbineShreds > 0 || mcastShreds > 0 || mcastSrcTotal > 0;

  return (
    <Card style={{ flexGrow: 1 }}>
      <Flex direction="column" height="100%" gap={headerGap}>
        <Flex justify="between" align="center">
          <Text className={tableStyles.headerText}>Shred Flow</Text>
          <Flex gap="4">
            <Text size="1" style={{ opacity: 0.6 }}>
              turbine in: {formatMbps(turbineBytes)}
            </Text>
            {mcastFwdBytes > 0 && (
              <Text size="1" style={{ opacity: 0.6 }}>
                mcast out: {formatMbps(mcastFwdBytes)}
              </Text>
            )}
            {turbineFwdBytes > 0 && (
              <Text size="1" style={{ opacity: 0.6 }}>
                turbine fwd: {formatMbps(turbineFwdBytes)}
              </Text>
            )}
          </Flex>
        </Flex>
        {hasData ? (
          <div style={{ flexGrow: 1, minHeight: 180 }}>
            <AutoSizer>
              {({ height, width }) => (
                <SankeyInner
                  turbineShreds={Math.round(turbineShreds)}
                  mcastSrcs={mcastSrcs}
                  mcastShreds={Math.round(mcastShreds)}
                  dedupSkipped={Math.round(dedupSkipped)}
                  turbineFwdBytes={turbineFwdBytes}
                  mcastFwdBytes={mcastFwdBytes}
                  repairShreds={Math.round(okay + completes)}
                  txprocFecSets={Math.round(txprocFecSets)}
                  height={height}
                  width={width}
                />
              )}
            </AutoSizer>
          </div>
        ) : (
          <Flex justify="center" align="center" flexGrow="1">
            <Text size="2" style={{ opacity: 0.5 }}>
              No shred traffic
            </Text>
          </Flex>
        )}
      </Flex>
    </Card>
  );
}
