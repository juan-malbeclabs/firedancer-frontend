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
const NODE_DEDUP_DROP = "dedup drop";
const NODE_FORWARDED = "forwarded";
const NODE_TURBINE_FWD = "turbine fwd";
const NODE_MCAST_FWD = "mcast fwd";
const NODE_TXPROC = "txproc";
const NODE_REPAIR = "repair";

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
  prevValue: number;
  prevTs: number;
  ema: number;
}

/** EMA hook for an array of per-source cumulative counters keyed by label. */
function useMcastSrcsEma(
  srcs: McastSrc[] | undefined,
  halfLifeMs: number,
): Map<string, number> {
  const tauMs = halfLifeMs / Math.log(2);
  const stateRef = useRef<Map<string, PerSrcEmaState>>(new Map());
  const [result, setResult] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!srcs || srcs.length === 0) return;
    const now = performance.now();
    const newResult = new Map<string, number>();

    for (const src of srcs) {
      const state = stateRef.current.get(src.label);
      if (!state) {
        stateRef.current.set(src.label, {
          prevValue: src.shreds,
          prevTs: now,
          ema: 0,
        });
        newResult.set(src.label, 0);
        continue;
      }
      const dtMs = now - state.prevTs;
      const dv = src.shreds - state.prevValue;
      if (dv < 0) {
        // Counter reset — reinitialize
        stateRef.current.set(src.label, {
          prevValue: src.shreds,
          prevTs: now,
          ema: 0,
        });
        newResult.set(src.label, 0);
        continue;
      }
      const rate = dtMs > 0 ? (dv / dtMs) * 1_000 : state.ema;
      const w = -Math.expm1(-dtMs / tauMs);
      const ema = state.ema * (1 - w) + rate * w;
      stateRef.current.set(src.label, {
        prevValue: src.shreds,
        prevTs: now,
        ema,
      });
      newResult.set(src.label, Math.max(0, ema));
    }

    setResult(newResult);
  }, [srcs, tauMs]);

  return result;
}

interface SankeyInnerProps {
  turbineShreds: number;
  /** Per-source mcast data when available (IP:Port → shreds/s) */
  mcastSrcs: Array<{ label: string; shreds: number }> | null;
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
    const dedup = Math.max(0, dedupSkipped);
    const forwarded = Math.max(1, totalIn - dedup);

    const avgShredBytes = 1200;
    const turbineFwdShreds = Math.round(turbineFwdBytes / avgShredBytes);
    const mcastFwdShreds = Math.round(mcastFwdBytes / avgShredBytes);
    const txprocShreds = Math.round(txprocFecSets * AVG_SHREDS_PER_FEC_SET);

    const nodes: { id: string }[] = [{ id: NODE_TURBINE_IN }];

    if (hasSrcs) {
      for (const src of mcastSrcs) {
        nodes.push({ id: src.label });
      }
    }
    nodes.push({ id: NODE_MCAST_RCVR });
    nodes.push({ id: NODE_SHREDPROC });
    if (dedup > 0) nodes.push({ id: NODE_DEDUP_DROP });
    nodes.push({ id: NODE_FORWARDED });
    if (turbineFwdShreds > 0) nodes.push({ id: NODE_TURBINE_FWD });
    if (mcastFwdShreds > 0) nodes.push({ id: NODE_MCAST_FWD });
    if (repairShreds > 0) nodes.push({ id: NODE_REPAIR });
    if (txprocShreds > 0) nodes.push({ id: NODE_TXPROC });

    const links: { source: string; target: string; value: number }[] = [
      { source: NODE_TURBINE_IN, target: NODE_SHREDPROC, value: t },
    ];

    if (hasSrcs) {
      for (const src of mcastSrcs) {
        links.push({
          source: src.label,
          target: NODE_MCAST_RCVR,
          value: Math.max(1, src.shreds),
        });
      }
    }
    links.push({ source: NODE_MCAST_RCVR, target: NODE_SHREDPROC, value: m });

    if (dedup > 0) {
      links.push({
        source: NODE_SHREDPROC,
        target: NODE_DEDUP_DROP,
        value: dedup,
      });
    }
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
    if (repairShreds > 0) {
      links.push({
        source: NODE_FORWARDED,
        target: NODE_REPAIR,
        value: repairShreds,
      });
    }
    if (txprocShreds > 0) {
      links.push({
        source: NODE_FORWARDED,
        target: NODE_TXPROC,
        value: txprocShreds,
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
      shreds: Math.round(srcEmaMap.get(src.label) ?? 0),
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
