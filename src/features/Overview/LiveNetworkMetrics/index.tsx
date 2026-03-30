import { useAtomValue } from "jotai";
import { liveNetworkMetricsAtom } from "../../../api/atoms";
import Card from "../../../components/Card";
import { Flex, Table, Text } from "@radix-ui/themes";
import tableStyles from "../../Gossip/table.module.css";
import { useEmaValue } from "../../../hooks/useEma";
import {
  networkProtocols,
  NETWORK_LINK_MAX_BYTES,
  NETWORK_TOTAL_MAX_BYTES,
  type NetworkMetricsCardType,
} from "./consts";
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
              // In Egress, idx 6 ("shreds" in protocol list) is actually mcast relay bytes out — show it
              if (type === "Egress" && protocol === "shreds") {
                return (
                  <TableRow
                    key="mcast-out"
                    type={type}
                    value={value}
                    label="mcast out"
                    maxOverride={NETWORK_LINK_MAX_BYTES}
                  />
                );
              }
              // shreds/mcast/mcast_new/turbine_dup are shown in the dedicated ShredsMetrics card
              if (
                protocol === "shreds" ||
                protocol === "mcast" ||
                protocol === "mcast_new" ||
                protocol === "turbine_dup"
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
                    label={src.label}
                    maxOverride={NETWORK_LINK_MAX_BYTES}
                  />
                ));
              }
              return <TableRow key={i} type={type} value={value} idx={i} />;
            })}
            <TableRow
              type={type}
              value={totalRaw}
              label="Total"
              maxOverride={NETWORK_TOTAL_MAX_BYTES}
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
