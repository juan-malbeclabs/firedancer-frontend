import { useAtomValue } from "jotai";
import { liveNetworkMetricsAtom } from "../../../api/atoms";
import Card from "../../../components/Card";
import { Flex, Table, Text } from "@radix-ui/themes";
import tableStyles from "../../Gossip/table.module.css";
import { useEmaValue } from "../../../hooks/useEma";
import {
  networkProtocols,
  NETWORK_LINK_MAX_BYTES,
  type NetworkMetricsCardType,
} from "./consts";

const CEIL_STEPS_MBPS = [100, 200, 500, 1_000, 2_000, 5_000, 10_000];

function dynamicCeiling(bytesPerSec: number): number {
  const mbps = (bytesPerSec * 8) / 1_000_000;
  for (const step of CEIL_STEPS_MBPS) {
    if (mbps <= step) return (step / 8) * 1_000_000;
  }
  return (10_000 / 8) * 1_000_000;
}
import { formatBytesAsBits } from "../../../utils";
import { Bars } from "../../StartupProgress/Firedancer/Bars";
import TileSparkLine from "../SlotPerformance/TileSparkLine";
import { headerGap } from "../../Gossip/consts";
import type { CSSProperties } from "react";
import styles from "./liveNetworkMetrics.module.css";
import { sum } from "lodash";
import { tileChartDarkBackground } from "../../../colors";
import { clientAtom } from "../../../atoms";
import { ClientEnum } from "../../../api/entities";
import { layoutModeAtom } from "../../../api/atoms";
import type { mcastSrcSchema } from "../../../api/entities";
import type { z } from "zod";

type McastSrc = z.infer<typeof mcastSrcSchema>;

const emaOptions = {
  halfLifeMs: 1_000,
};

const chartHeight = 18;

export default function LiveNetworkMetrics() {
  const liveNetworkMetrics = useAtomValue(liveNetworkMetricsAtom);
  if (!liveNetworkMetrics) return;

  return (
    <Flex wrap="wrap" gap="4">
      <NetworkMetricsCard
        metrics={liveNetworkMetrics.ingress}
        type="Ingress"
        mcastSrcs={liveNetworkMetrics.mcast_srcs}
      />
      <NetworkMetricsCard metrics={liveNetworkMetrics.egress} type="Egress" />
    </Flex>
  );
}

interface NetworkMetricsCardProps {
  metrics: number[];
  type: NetworkMetricsCardType;
  mcastSrcs?: McastSrc[];
}

function NetworkMetricsCard({
  metrics,
  type,
  mcastSrcs,
}: NetworkMetricsCardProps) {
  const client = useAtomValue(clientAtom);
  const layoutMode = useAtomValue(layoutModeAtom);
  const isRelayMode = layoutMode === "shred_relay";
  const hasMcastSrcs = type === "Ingress" && mcastSrcs && mcastSrcs.length > 0;

  const totalRaw = isRelayMode
    ? sum(metrics.slice(0, 3)) +
      (metrics[6] ?? 0) /* include mcast relay bytes */
    : type === "Egress"
      ? sum(metrics.slice(0, 7)) /* include mcast relay bytes (idx 6) */
      : sum(metrics.slice(0, 6));

  const emaTotal = useEmaValue(totalRaw, emaOptions);
  const dynMax = dynamicCeiling(emaTotal);

  return (
    <Card style={{ flexGrow: 1 }}>
      <Flex direction="column" height="100%" gap={headerGap}>
        <Text className={tableStyles.headerText}>Network {type}</Text>
        <Table.Root
          variant="ghost"
          className={tableStyles.root}
          size="1"
          style={{ "--bar-height": `${chartHeight}px` } as CSSProperties}
        >
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell width="60px">
                Protocol
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right" width="80px">
                Current
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell
                minWidth={{
                  xl: "250px",
                  lg: "160px",
                  md: "100px",
                  initial: "60px",
                }}
              >
                Utilization
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell
                align="right"
                width={{
                  xl: "240px",
                  lg: "200px",
                  md: "100px",
                  initial: "200px",
                }}
              >
                History (1m)
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {metrics.map((value, i) => {
              const protocol = networkProtocols[i];
              // Skip indices beyond the known protocol list (e.g. dedup counters, FEC stats)
              if (!protocol) return null;
              if (
                client === ClientEnum.Frankendancer &&
                !isRelayMode &&
                (protocol === "gossip" || protocol === "repair")
              ) {
                return;
              }
              // In Egress, idx 0 ("turbine in" in protocol list) is actually turbine unicast bytes out
              if (type === "Egress" && protocol === "turbine in") {
                return (
                  <TableRow
                    key="turbine-unicast"
                    type={type}
                    value={value}
                    label="turbine"
                    maxOverride={dynMax}
                  />
                );
              }
              // In Egress, idx 6 ("shreds" in protocol list) is actually mcast relay bytes out — show it
              if (type === "Egress" && protocol === "shreds") {
                return (
                  <TableRow
                    key="mcast-out"
                    type={type}
                    value={value}
                    label="relay out"
                    maxOverride={dynMax}
                  />
                );
              }
              // shreds/mcast/mcast_new/turbine_dup/dedup_skipped are shown in the dedicated ShredsMetrics card
              if (
                protocol === "shreds" ||
                protocol === "mcast" ||
                protocol === "mcast_new" ||
                protocol === "turbine_dup" ||
                protocol === "dedup_skipped"
              ) {
                return null;
              }
              // tpu/repair/metrics don't apply in relay mode
              if (
                isRelayMode &&
                (protocol === "tpu" ||
                  protocol === "repair" ||
                  protocol === "metrics")
              ) {
                return null;
              }
              // Replace the single turbine.multicast row with per-source rows when available
              if (protocol === "turbine.multicast" && hasMcastSrcs) {
                return mcastSrcs.map((src) => (
                  <TableRow
                    key={src.label}
                    type={type}
                    value={src.bytes}
                    label={src.grp_label ?? src.label}
                    maxOverride={dynMax}
                  />
                ));
              }
              return (
                <TableRow
                  key={i}
                  type={type}
                  value={value}
                  idx={i}
                  maxOverride={dynMax}
                />
              );
            })}
            <TableRow
              type={type}
              value={totalRaw}
              label="Total"
              maxOverride={dynMax}
              className={styles.totalRow}
            />
          </Table.Body>
        </Table.Root>
      </Flex>
    </Card>
  );
}

interface TableRowProps {
  type: NetworkMetricsCardType;
  value: number;
  idx?: number;
  label?: string;
  maxOverride?: number;
}

function formatShredsPerSec(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M /s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k /s`;
  return `${Math.round(value)} /s`;
}

function TableRow({
  type,
  value,
  idx,
  label,
  maxOverride,
  ...props
}: TableRowProps & Table.RootProps) {
  const emaValue = useEmaValue(value, emaOptions);
  const rowLabel = label ?? networkProtocols[idx ?? -1];
  const isShreds = rowLabel === "shreds" || rowLabel === "mcast";
  const maxValue = maxOverride ?? NETWORK_LINK_MAX_BYTES;

  let displayValue: string;
  if (isShreds) {
    displayValue = formatShredsPerSec(emaValue);
  } else {
    const fmt = formatBytesAsBits(emaValue);
    displayValue = `${fmt.value} ${fmt.unit}`;
  }

  return (
    <Table.Row {...props}>
      <Table.RowHeaderCell>{rowLabel}</Table.RowHeaderCell>
      <Table.Cell align="right">{displayValue}</Table.Cell>
      <Table.Cell className={styles.chart}>
        <Flex align="center">
          <Bars value={emaValue} max={maxValue} barWidth={2} />
        </Flex>
      </Table.Cell>
      <Table.Cell className={styles.chart}>
        <TileSparkLine
          value={Math.min(1, emaValue / maxValue)}
          background={tileChartDarkBackground}
          windowMs={60_000}
          height={chartHeight}
          updateIntervalMs={500}
          tickMs={1_000}
        />
      </Table.Cell>
    </Table.Row>
  );
}
