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

/** One snapshot in the ring buffer: per-source contested counts. */
interface RaceSnapshot {
  ts: number; // Date.now() ms
  /** per-source [first, second, third] — solo excluded */
  counts: [number, number, number][];
}

const MAX_HISTORY = 3700; // ~1h at 1 update/s

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function formatDelay(us: number): string {
  if (us < 0) return "—";
  if (us >= 1000) return `${(us / 1000).toFixed(1)} ms`;
  return `${us.toFixed(0)} µs`;
}

interface WindowCounts {
  first: number;
  second: number;
  third: number;
}

interface RaceRowProps {
  entry: ShredRaceEntry;
  window: WindowCounts;
}

function RaceRow({ entry, window: win }: RaceRowProps) {
  const total = win.first + win.second + win.third;
  const winRate = total > 0 ? win.first / total : 0;
  const firstColor =
    winRate >= 0.5 ? successColor : winRate > 0 ? "#E5A50A" : failureColor;

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
      <Table.Cell
        align="right"
        style={{ color: firstColor, fontVariantNumeric: "tabular-nums" }}
      >
        {formatCount(win.first)}
      </Table.Cell>
      <Table.Cell
        align="right"
        style={{
          color: secondaryTextColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatCount(win.second)}
      </Table.Cell>
      <Table.Cell
        align="right"
        style={{
          color: secondaryTextColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatCount(win.third)}
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

  // Append a snapshot on every data update.
  useEffect(() => {
    if (!shredRace) return;
    const counts = shredRace.map((e): [number, number, number] => [
      e.first,
      e.second,
      e.third,
    ]);
    historyRef.current.push({ ts: Date.now(), counts });
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.splice(0, historyRef.current.length - MAX_HISTORY);
    }
  }, [shredRace]);

  if (!shredRace) return null;

  // Only show sources that participated in a contested race or are turbine.
  const entries = shredRace.filter((e) => e.total > 0 || e.label === "turbine");
  if (entries.length === 0) return null;

  // Compute windowed deltas.
  const cutoffMs = Date.now() - windowMin * 60 * 1000;
  const history = historyRef.current;
  const current = history.at(-1);

  let baseIdx = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i].ts > cutoffMs) break;
    baseIdx = i;
  }
  const base = history[baseIdx];

  const windowCounts: WindowCounts[] = entries.map((e) => {
    const srcIdx = shredRace.indexOf(e);
    if (!current || !base) return { first: 0, second: 0, third: 0 };
    const [cf0, cs0, ct0] = current.counts[srcIdx] ?? [0, 0, 0];
    const [bf0, bs0, bt0] = base.counts[srcIdx] ?? [0, 0, 0];
    return {
      first: Math.max(0, cf0 - bf0),
      second: Math.max(0, cs0 - bs0),
      third: Math.max(0, ct0 - bt0),
    };
  });

  return (
    <Card style={{ flexGrow: 1 }}>
      <Flex direction="column" height="100%" gap={headerGap}>
        <Flex align="center" justify="between" wrap="wrap" gap="2">
          <Flex align="center" gap="1">
            <Text className={tableStyles.headerText}>Shred Race</Text>
            <Tooltip content="Counts of contested shreds (2+ sources) per placement in the selected window. Solo deliveries (only one source) are excluded.">
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
                1st
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="65px">
                2nd
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="65px">
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
                window={windowCounts[i] ?? { first: 0, second: 0, third: 0 }}
              />
            ))}
          </Table.Body>
        </Table.Root>
      </Flex>
    </Card>
  );
}
