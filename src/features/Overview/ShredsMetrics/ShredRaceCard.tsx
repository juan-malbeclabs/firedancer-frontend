import { useAtomValue } from "jotai";
import { liveNetworkMetricsAtom } from "../../../api/atoms";
import Card from "../../../components/Card";
import { Flex, Table, Text, Tooltip } from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import tableStyles from "../../Gossip/table.module.css";
import { headerGap } from "../../Gossip/consts";
import {
  secondaryTextColor,
  successColor,
  failureColor,
} from "../../../colors";
import type { z } from "zod";
import type { shredRaceEntrySchema } from "../../../api/entities";

type ShredRaceEntry = z.infer<typeof shredRaceEntrySchema>;

function formatPct(n: number, total: number): string {
  if (total === 0) return "—";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function formatDelay(us: number): string {
  if (us < 0) return "—";
  if (us >= 1000) return `${(us / 1000).toFixed(1)} ms`;
  return `${us.toFixed(0)} µs`;
}

function RaceRow({ entry }: { entry: ShredRaceEntry }) {
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
  if (!liveNetworkMetrics?.shred_race) return null;

  const entries = liveNetworkMetrics.shred_race.filter(
    (e) => e.total > 0 || e.solo > 0 || e.label === "turbine",
  );
  if (entries.length === 0) return null;

  return (
    <Card style={{ flexGrow: 1 }}>
      <Flex direction="column" height="100%" gap={headerGap}>
        <Flex align="center" gap="1">
          <Text className={tableStyles.headerText}>Shred Race</Text>
          <Tooltip content="Which source delivers each shred first? Counters are cumulative since process start. Delay = time behind first arrival for non-first deliveries.">
            <InfoCircledIcon style={{ cursor: "help", opacity: 0.6 }} />
          </Tooltip>
        </Flex>
        <Table.Root variant="ghost" className={tableStyles.root} size="1">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell width="90px">
                Source
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="60px">
                1st
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="60px">
                2nd
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="60px">
                3rd+
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="70px">
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
              <Table.ColumnHeaderCell align="right" width="70px">
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
            {entries.map((entry) => (
              <RaceRow key={entry.label} entry={entry} />
            ))}
          </Table.Body>
        </Table.Root>
      </Flex>
    </Card>
  );
}
