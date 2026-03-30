import { useAtomValue } from "jotai";
import { liveNetworkMetricsAtom } from "../../../api/atoms";
import Card from "../../../components/Card";
import { Flex, Text } from "@radix-ui/themes";
import tableStyles from "../../Gossip/table.module.css";
import { headerGap } from "../../Gossip/consts";
import { useEffect, useRef, useState, useMemo } from "react";
import { useMeasure } from "react-use";
import { successColor } from "../../../colors";

// ── constants ─────────────────────────────────────────────────────────────────

const MAX_BUCKETS = 300;
const CHART_H = 200;
const ML = 38; // left margin for y-axis labels
const MR = 8;
const MT = 4;
const MB = 18; // bottom margin for x-axis labels
const GAP = 5; // gap between top and bottom panels
const TOP_FRAC = 0.75;

// Source color palette: turbine first (green), then mcast sources
const SOURCE_COLORS = [
  successColor, // turbine → green
  "#4D9DE0", // blue
  "#E1BC29", // yellow
  "#E15554", // red
  "#7768AE", // purple
  "#F18F01", // orange
  "#1CE7C2", // teal
  "#C3423F", // dark red
];
const srcColor = (i: number) => SOURCE_COLORS[i % SOURCE_COLORS.length];

// ── types ─────────────────────────────────────────────────────────────────────

interface Bucket {
  ts: number;
  sources: Record<string, number>; // label → first-arrival delta for this bucket
  totalFirst: number;
  totalContested: number; // first + second + third across all sources
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ShredRaceHistoryCard() {
  const liveNetworkMetrics = useAtomValue(liveNetworkMetricsAtom);
  const shredRace = liveNetworkMetrics?.shred_race;

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [sourceLabels, setSourceLabels] = useState<string[]>([]);
  const prevRef = useRef<Record<
    string,
    { first: number; second: number; third: number }
  > | null>(null);

  // Append a bucket on every shred_race update (~1/s from server).
  useEffect(() => {
    if (!shredRace || shredRace.length === 0) return;

    setSourceLabels(shredRace.map((e) => e.label));

    const prev = prevRef.current;
    if (prev) {
      const sources: Record<string, number> = {};
      let totalFirst = 0;
      let totalContested = 0;
      for (const e of shredRace) {
        const p = prev[e.label] ?? { first: 0, second: 0, third: 0 };
        const fd = Math.max(0, e.first - p.first);
        const sd = Math.max(0, e.second - p.second);
        const td = Math.max(0, e.third - p.third);
        sources[e.label] = fd;
        totalFirst += fd;
        totalContested += fd + sd + td;
      }
      setBuckets((prev) => {
        const next = [
          ...prev,
          { ts: Date.now(), sources, totalFirst, totalContested },
        ];
        return next.length > MAX_BUCKETS + 10
          ? next.slice(-(MAX_BUCKETS + 10))
          : next;
      });
    }

    prevRef.current = Object.fromEntries(
      shredRace.map((e) => [
        e.label,
        { first: e.first, second: e.second, third: e.third },
      ]),
    );
  }, [shredRace]);

  const [svgRef, { width }] = useMeasure<SVGSVGElement>();

  // Derived geometry
  const visible = buckets.slice(-MAX_BUCKETS);
  const N = visible.length;
  const W = Math.max(1, (width || 600) - ML - MR);
  const innerH = CHART_H - MT - MB;
  const topH = Math.round((innerH - GAP) * TOP_FRAC);
  const botH = innerH - GAP - topH;
  const topY = MT;
  const botY = MT + topH + GAP;
  const barW = W / MAX_BUCKETS;

  // X position for visible bucket index i (right-aligned: newest at right edge)
  const xOf = (i: number) => ML + (MAX_BUCKETS - N + i) * barW;

  // ── stacked fractions ──────────────────────────────────────────────────────
  // stacked[j][i] = cumulative fraction at top of source i in bucket j
  const stacked = useMemo(
    () =>
      visible.map((b) => {
        if (b.totalFirst === 0) return sourceLabels.map(() => 0);
        let cum = 0;
        return sourceLabels.map((label) => {
          cum += (b.sources[label] ?? 0) / b.totalFirst;
          return cum;
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, sourceLabels],
  );

  // ── step-polygon paths for each source ────────────────────────────────────
  const polygons = useMemo(() => {
    if (N === 0) return [];
    const xFn = (i: number) => ML + (MAX_BUCKETS - N + i) * barW;

    return sourceLabels.map((_, si) => {
      const pts: string[] = [];
      // top edge left → right
      for (let j = 0; j < N; j++) {
        const x0 = xFn(j);
        const yTop = topY + topH * (1 - (stacked[j]?.[si] ?? 0));
        pts.push(`${x0.toFixed(1)},${yTop.toFixed(1)}`);
        pts.push(`${(x0 + barW).toFixed(1)},${yTop.toFixed(1)}`);
      }
      // bottom edge right → left
      for (let j = N - 1; j >= 0; j--) {
        const x0 = xFn(j);
        const bot = si > 0 ? (stacked[j]?.[si - 1] ?? 0) : 0;
        const yBot = topY + topH * (1 - bot);
        pts.push(`${(x0 + barW).toFixed(1)},${yBot.toFixed(1)}`);
        pts.push(`${x0.toFixed(1)},${yBot.toFixed(1)}`);
      }
      return { pts: pts.join(" "), color: srcColor(si) };
    });
  }, [N, sourceLabels, stacked, barW, topY, topH]);

  // ── volume / contested ─────────────────────────────────────────────────────
  const maxC = useMemo(
    () => Math.max(1, ...visible.map((b) => b.totalContested)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets],
  );

  const contestedLine = useMemo(() => {
    if (N < 2) return null;
    const xFn = (i: number) => ML + (MAX_BUCKETS - N + i) * barW + barW / 2;
    return visible
      .map(
        (b, i) =>
          `${xFn(i).toFixed(1)},${(botY + botH - (botH * b.totalContested) / maxC).toFixed(1)}`,
      )
      .join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, N, barW, botY, botH, maxC]);

  if (
    !shredRace ||
    shredRace.filter((e) => e.total > 0 || e.label === "turbine").length === 0
  )
    return null;

  const X_TICKS = [300, 240, 180, 120, 60, 0] as const;

  return (
    <Card style={{ width: "100%" }}>
      <Flex direction="column" gap={headerGap}>
        {/* ── Header + legend ── */}
        <Flex justify="between" align="center" wrap="wrap" gap="2">
          <Text className={tableStyles.headerText}>Shred Race · 5m</Text>
          <Flex gap="3" wrap="wrap">
            {sourceLabels.map((label, i) => (
              <Flex key={label} align="center" gap="1">
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    backgroundColor: srcColor(i),
                    flexShrink: 0,
                  }}
                />
                <Text
                  size="1"
                  style={{ opacity: 0.75, fontFamily: "monospace" }}
                >
                  {label}
                </Text>
              </Flex>
            ))}
          </Flex>
        </Flex>

        {/* ── SVG chart ── */}
        <svg
          ref={svgRef}
          width="100%"
          height={CHART_H}
          style={{ display: "block" }}
        >
          {/* vertical borders */}
          <line
            x1={ML}
            y1={topY}
            x2={ML}
            y2={botY + botH}
            stroke="rgba(255,255,255,0.1)"
          />
          <line
            x1={ML + W}
            y1={topY}
            x2={ML + W}
            y2={botY + botH}
            stroke="rgba(255,255,255,0.1)"
          />

          {/* ─── top panel ─── */}
          <rect
            x={ML}
            y={topY}
            width={W}
            height={topH}
            fill="rgba(255,255,255,0.025)"
          />
          {/* grid lines */}
          <line
            x1={ML}
            y1={topY}
            x2={ML + W}
            y2={topY}
            stroke="rgba(255,255,255,0.1)"
          />
          <line
            x1={ML}
            y1={topY + topH / 2}
            x2={ML + W}
            y2={topY + topH / 2}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="3 3"
          />
          <line
            x1={ML}
            y1={topY + topH}
            x2={ML + W}
            y2={topY + topH}
            stroke="rgba(255,255,255,0.1)"
          />
          {/* y-axis labels */}
          <text
            x={ML - 4}
            y={topY + 4}
            textAnchor="end"
            fontSize={9}
            fill="rgba(255,255,255,0.35)"
          >
            100%
          </text>
          <text
            x={ML - 4}
            y={topY + topH / 2 + 4}
            textAnchor="end"
            fontSize={9}
            fill="rgba(255,255,255,0.35)"
          >
            50%
          </text>
          <text
            x={ML - 4}
            y={topY + topH + 1}
            textAnchor="end"
            fontSize={9}
            fill="rgba(255,255,255,0.35)"
          >
            0%
          </text>

          {/* stacked area polygons */}
          {polygons.map(({ pts, color }, i) => (
            <polygon key={i} points={pts} fill={color} fillOpacity={0.82} />
          ))}

          {/* ─── bottom panel ─── */}
          <rect
            x={ML}
            y={botY}
            width={W}
            height={botH}
            fill="rgba(255,255,255,0.025)"
          />
          <line
            x1={ML}
            y1={botY + botH}
            x2={ML + W}
            y2={botY + botH}
            stroke="rgba(255,255,255,0.1)"
          />
          {/* y-axis max label */}
          <text
            x={ML - 4}
            y={botY + 4}
            textAnchor="end"
            fontSize={9}
            fill="rgba(255,255,255,0.35)"
          >
            {fmtCount(maxC)}
          </text>

          {/* volume bars (total first arrivals per bucket) */}
          {visible.map((b, i) => {
            if (b.totalFirst === 0) return null;
            const x = xOf(i);
            const h = (botH * b.totalFirst) / maxC;
            return (
              <rect
                key={i}
                x={x + 0.5}
                y={botY + botH - h}
                width={Math.max(0.5, barW - 1)}
                height={h}
                fill="rgba(255,255,255,0.32)"
              />
            );
          })}

          {/* total contested line */}
          {contestedLine && (
            <polyline
              points={contestedLine}
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          )}

          {/* ─── x-axis tick labels ─── */}
          {X_TICKS.map((sAgo) => {
            const slot = MAX_BUCKETS - 1 - sAgo;
            const x = ML + (slot + 0.5) * barW;
            const label = sAgo === 0 ? "now" : `-${sAgo / 60}m`;
            return (
              <text
                key={sAgo}
                x={x.toFixed(1)}
                y={CHART_H - 4}
                textAnchor="middle"
                fontSize={9}
                fill="rgba(255,255,255,0.3)"
              >
                {label}
              </text>
            );
          })}
        </svg>

        {/* ── Bottom legend ── */}
        <Flex gap="4" align="center">
          <Flex align="center" gap="1">
            <div
              style={{
                width: 14,
                height: 6,
                backgroundColor: "rgba(255,255,255,0.32)",
                borderRadius: 1,
              }}
            />
            <Text size="1" style={{ opacity: 0.45 }}>
              1st arrivals
            </Text>
          </Flex>
          <Flex align="center" gap="1">
            <svg width="14" height="10">
              <polyline
                points="0,9 7,3 14,6"
                fill="none"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth={1.5}
              />
            </svg>
            <Text size="1" style={{ opacity: 0.45 }}>
              total contested
            </Text>
          </Flex>
        </Flex>
      </Flex>
    </Card>
  );
}
