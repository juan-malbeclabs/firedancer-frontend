import { useAtomValue } from "jotai";
import { liveNetworkMetricsAtom } from "../../../api/atoms";
import Card from "../../../components/Card";
import { Flex, SegmentedControl, Table, Text, Tooltip } from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import tableStyles from "../../Gossip/table.module.css";
import { headerGap } from "../../Gossip/consts";
import {
  secondaryTextColor,
  successColor,
  failureColor,
} from "../../../colors";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { shredRaceEntrySchema } from "../../../api/entities";

type ShredRaceEntry = z.infer<typeof shredRaceEntrySchema>;

const WINDOW_OPTIONS = [5, 15, 30, 60] as const;
type WindowMin = (typeof WINDOW_OPTIONS)[number];

/** One snapshot in the ring buffer. */
interface RaceSnapshot {
  ts: number; // Date.now() ms
  /** per-source cumulative total = first + second + third + solo */
  totals: number[];
}

const MAX_HISTORY = 3700; // ~1h at 1 update/s with headroom

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function formatPct(n: number, total: number): string {
  if (total === 0) return "—";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function formatDelay(us: number): string {
  if (us < 0) return "—";
  if (us >= 1000) return `${(us / 1000).toFixed(1)} ms`;
  return `${us.toFixed(0)} µs`;
}

interface RaceRowProps {
  entry: ShredRaceEntry;
  windowCount: number;
}

function RaceRow({ entry, windowCount }: RaceRowProps) {
  const total = entry.total + entry.solo;
  const firstPct = total > 0 ? (entry.first + entry.solo) / total : 0;
  const pctColor =
    firstPct >= 0.5 ? successColor : firstPct > 0 ? "#E5A50A" : failureColor;

  return (
    <Table.Row>
      <Table.RowHeaderCell
        style={{
          maxWidth: 90,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {entry.label}
      </Table.RowHeaderCell>
      <Table.Cell align="right" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatCount(windowCount)}
      </Table.Cell>
      <Table.Cell
        align="right"
        style={{ color: pctColor, fontVariantNumeric: "tabular-nums" }}
      >
        {formatPct(entry.first + entry.solo, total)}
      </Table.Cell>
      <Table.Cell
        align="right"
        style={{
          color: secondaryTextColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatPct(entry.second, total)}
      </Table.Cell>
      <Table.Cell
        align="right"
        style={{
          color: secondaryTextColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatPct(entry.third, total)}
      </Table.Cell>
      <Table.Cell align="right" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatDelay(entry.delay_p95_us)}
      </Table.Cell>
      <Table.Cell align="right" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatDelay(entry.delay_p99_us)}
      </Table.Cell>
    </Table.Row>
  );
}

export default function ShredRaceCard() {
  const liveNetworkMetrics = useAtomValue(liveNetworkMetricsAtom);
  const [windowMin, setWindowMin] = useState<WindowMin>(5);
  const historyRef = useRef<RaceSnapshot[]>([]);

  const shredRace = liveNetworkMetrics?.shred_race;

  // Append a snapshot every time shred_race data changes.
  useEffect(() => {
    if (!shredRace) return;
    const totals = shredRace.map((e) => e.first + e.second + e.third + e.solo);
    historyRef.current.push({ ts: Date.now(), totals });
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.splice(0, historyRef.current.length - MAX_HISTORY);
    }
  }, [shredRace]);

  if (!shredRace) return null;

  const entries = shredRace.filter(
    (e) => e.total > 0 || e.solo > 0 || e.label === "turbine",
  );
  if (entries.length === 0) return null;

  // Compute windowed deltas.
  const cutoffMs = Date.now() - windowMin * 60 * 1000;
  const history = historyRef.current;
  const current = history.at(-1);

  // Find the last snapshot that is at or before the cutoff.
  let baseIdx = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i].ts > cutoffMs) break;
    baseIdx = i;
  }
  const base = history[baseIdx];

  const windowCounts = entries.map((e, i) => {
    const srcIdx = shredRace.indexOf(e);
    if (!current || !base) return 0;
    return Math.max(
      0,
      (current.totals[srcIdx] ?? 0) - (base.totals[srcIdx] ?? 0),
    );
  });

  return (
    <Card style={{ flexGrow: 1 }}>
      <Flex direction="column" height="100%" gap={headerGap}>
        <Flex align="center" justify="between" wrap="wrap" gap="2">
          <Flex align="center" gap="1">
            <Text className={tableStyles.headerText}>Shred Race</Text>
            <Tooltip content="Which source delivers each shred first? Percentages are cumulative. Count = shreds observed from that source in the selected window.">
              <InfoCircledIcon style={{ cursor: "help", opacity: 0.6 }} />
            </Tooltip>
          </Flex>
          <SegmentedControl.Root
            size="1"
            value={String(windowMin)}
            onValueChange={(v) => setWindowMin(Number(v) as WindowMin)}
          >
            {WINDOW_OPTIONS.map((m) => (
              <SegmentedControl.Item key={m} value={String(m)}>
                {m}m
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </Flex>
        <Table.Root variant="ghost" className={tableStyles.root} size="1">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell width="90px">
                Source
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="65px">
                <Tooltip content="Total shreds received from this source in the selected time window">
                  <Flex
                    align="center"
                    gap="1"
                    justify="end"
                    style={{ cursor: "help" }}
                  >
                    Count
                    <InfoCircledIcon style={{ opacity: 0.5 }} />
                  </Flex>
                </Tooltip>
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="55px">
                1st
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="55px">
                2nd
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="55px">
                3rd+
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="65px">
                <Tooltip content="p95 latency behind first arrival (when not first)">
                  <Flex
                    align="center"
                    gap="1"
                    justify="end"
                    style={{ cursor: "help" }}
                  >
                    p95
                    <InfoCircledIcon style={{ opacity: 0.5 }} />
                  </Flex>
                </Tooltip>
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="65px">
                <Tooltip content="p99 latency behind first arrival (when not first)">
                  <Flex
                    align="center"
                    gap="1"
                    justify="end"
                    style={{ cursor: "help" }}
                  >
                    p99
                    <InfoCircledIcon style={{ opacity: 0.5 }} />
                  </Flex>
                </Tooltip>
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {entries.map((entry, i) => (
              <RaceRow
                key={entry.label}
                entry={entry}
                windowCount={windowCounts[i] ?? 0}
              />
            ))}
          </Table.Body>
        </Table.Root>
      </Flex>
    </Card>
  );
}
