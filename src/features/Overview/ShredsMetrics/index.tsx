import { useAtomValue } from "jotai";
import { liveNetworkMetricsAtom } from "../../../api/atoms";
import Card from "../../../components/Card";
import { Flex, Table, Text, Tooltip } from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import tableStyles from "../../Gossip/table.module.css";
import { useEmaValue } from "../../../hooks/useEma";
import { headerGap } from "../../Gossip/consts";
import type { CSSProperties } from "react";
import styles from "../LiveNetworkMetrics/liveNetworkMetrics.module.css";
import { Bars } from "../../StartupProgress/Firedancer/Bars";
import TileSparkLine from "../SlotPerformance/TileSparkLine";
import { tileChartDarkBackground, failureColor } from "../../../colors";
import { formatBytesAsBits } from "../../../utils";

const chartHeight = 18;
const maxShredsPerSec = 100_000;
const MAX_MCAST_DISPLAY = 5;

// Ingress array indices (see networkProtocols in LiveNetworkMetrics/consts.ts)
const TURBINE_BYTES_IDX = 0; // turbine.unicast bytes
const SHREDS_IDX = 6; // turbine shred count
const MCAST_IDX = 7; // mcast shred count
const MCAST_NEW_IDX = 8; // mcast shreds arriving before turbine
const TURBINE_DUP_IDX = 9; // turbine shreds that were duplicates (smcast dedup)

function formatShredsPerSec(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M /s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k /s`;
  return `${Math.round(value)} /s`;
}

const emaOptions = { halfLifeMs: 1_000 };

function TurbineRow({ ingress }: { ingress: number[] }) {
  const emaShreds = useEmaValue(ingress[SHREDS_IDX] ?? 0, emaOptions);
  const emaBytes = useEmaValue(ingress[TURBINE_BYTES_IDX] ?? 0, emaOptions);
  const formattedBytes = formatBytesAsBits(emaBytes);

  return (
    <Table.Row>
      <Table.RowHeaderCell>turbine</Table.RowHeaderCell>
      <Table.Cell align="right">
        {formatShredsPerSec(emaShreds)}
        <Text size="1" style={{ opacity: 0.6, marginLeft: 4 }}>
          {formattedBytes.value} {formattedBytes.unit}
        </Text>
      </Table.Cell>
      <Table.Cell className={styles.chart}>
        <Flex align="center">
          <Bars value={emaShreds} max={maxShredsPerSec} barWidth={2} />
        </Flex>
      </Table.Cell>
      <Table.Cell className={styles.chart}>
        <TileSparkLine
          value={Math.min(1, emaShreds / maxShredsPerSec)}
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

function McastLeadRow({ ingress }: { ingress: number[] }) {
  const shreds = ingress[SHREDS_IDX] ?? 0;
  const mcastNew = ingress[MCAST_NEW_IDX] ?? 0;
  const total = shreds + mcastNew;
  const pct = total > 0 ? (mcastNew / total) * 100 : 0;
  const emaPct = useEmaValue(pct, emaOptions);

  return (
    <Table.Row>
      <Table.RowHeaderCell>
        <Flex align="center" gap="1">
          mcast lead
          <Tooltip content="% of FEC sets where multicast delivered the shreds before turbine unicast. 100% = all sets arrived first via mcast. Computed over lifetime counters.">
            <InfoCircledIcon style={{ cursor: "help", opacity: 0.6 }} />
          </Tooltip>
        </Flex>
      </Table.RowHeaderCell>
      <Table.Cell align="right">{emaPct.toFixed(1)}%</Table.Cell>
      <Table.Cell className={styles.chart}>
        <Flex align="center">
          <Bars value={emaPct} max={100} barWidth={2} />
        </Flex>
      </Table.Cell>
      <Table.Cell className={styles.chart}>
        <TileSparkLine
          value={Math.min(1, emaPct / 100)}
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

interface McastSrcRowProps {
  label: string;
  shreds: number;
  bytes: number;
  dedup?: number;
  parseFailed?: number;
}

function McastSrcRow({
  label,
  shreds,
  bytes,
  dedup = 0,
  parseFailed = 0,
}: McastSrcRowProps) {
  const emaShreds = useEmaValue(shreds, emaOptions);
  const emaBytes = useEmaValue(bytes, emaOptions);
  const emaDedup = useEmaValue(dedup, emaOptions);
  const emaParseFailed = useEmaValue(parseFailed, emaOptions);
  const formattedBytes = formatBytesAsBits(emaBytes);
  const totalDropped = emaDedup + emaParseFailed;

  return (
    <Table.Row>
      <Table.RowHeaderCell>{label}</Table.RowHeaderCell>
      <Table.Cell align="right">
        <Flex align="center" justify="end" gap="1" wrap="wrap">
          <span>
            {formatShredsPerSec(emaShreds)}
            <Text size="1" style={{ opacity: 0.6, marginLeft: 4 }}>
              {formattedBytes.value} {formattedBytes.unit}
            </Text>
          </span>
          {totalDropped > 0.5 && (
            <Tooltip
              content={`${formatShredsPerSec(emaDedup)} dup/s, ${formatShredsPerSec(emaParseFailed)} parse err/s`}
            >
              <Text
                size="1"
                style={{ color: failureColor, cursor: "help", opacity: 0.9 }}
              >
                {formatShredsPerSec(totalDropped)} dropped
              </Text>
            </Tooltip>
          )}
        </Flex>
      </Table.Cell>
      <Table.Cell className={styles.chart}>
        <Flex align="center">
          <Bars value={emaShreds} max={maxShredsPerSec} barWidth={2} />
        </Flex>
      </Table.Cell>
      <Table.Cell className={styles.chart}>
        <TileSparkLine
          value={Math.min(1, emaShreds / maxShredsPerSec)}
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

function IngressTotalRow({ ingress }: { ingress: number[] }) {
  const turbineShreds = ingress[SHREDS_IDX] ?? 0;
  const mcastShreds = ingress[MCAST_IDX] ?? 0;
  const total = turbineShreds + mcastShreds;
  const emaTotal = useEmaValue(total, emaOptions);

  return (
    <Table.Row>
      <Table.RowHeaderCell>
        <Flex align="center" gap="1">
          ingress
          <Tooltip content="Total shreds/s received (turbine + mcast) before deduplication.">
            <InfoCircledIcon style={{ cursor: "help", opacity: 0.6 }} />
          </Tooltip>
        </Flex>
      </Table.RowHeaderCell>
      <Table.Cell align="right">{formatShredsPerSec(emaTotal)}</Table.Cell>
      <Table.Cell className={styles.chart}>
        <Flex align="center">
          <Bars value={emaTotal} max={maxShredsPerSec} barWidth={2} />
        </Flex>
      </Table.Cell>
      <Table.Cell className={styles.chart}>
        <TileSparkLine
          value={Math.min(1, emaTotal / maxShredsPerSec)}
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

function DedupRow({ ingress }: { ingress: number[] }) {
  const turbineShreds = ingress[SHREDS_IDX] ?? 0;
  const mcastShreds = ingress[MCAST_IDX] ?? 0;
  const turbineDup = ingress[TURBINE_DUP_IDX] ?? 0;
  const unique = Math.max(0, turbineShreds + mcastShreds - turbineDup);
  const emaUnique = useEmaValue(unique, emaOptions);

  return (
    <Table.Row className={styles.totalRow}>
      <Table.RowHeaderCell>
        <Flex align="center" gap="1">
          post-dedup
          <Tooltip content="Net shreds/s after deduplication: (turbine + mcast − duplicates). Unique FEC set data entering the validator.">
            <InfoCircledIcon style={{ cursor: "help", opacity: 0.6 }} />
          </Tooltip>
        </Flex>
      </Table.RowHeaderCell>
      <Table.Cell align="right">{formatShredsPerSec(emaUnique)}</Table.Cell>
      <Table.Cell className={styles.chart}>
        <Flex align="center">
          <Bars value={emaUnique} max={maxShredsPerSec} barWidth={2} />
        </Flex>
      </Table.Cell>
      <Table.Cell className={styles.chart}>
        <TileSparkLine
          value={Math.min(1, emaUnique / maxShredsPerSec)}
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

export default function ShredsMetrics() {
  const liveNetworkMetrics = useAtomValue(liveNetworkMetricsAtom);
  if (!liveNetworkMetrics) return null;

  const mcastSrcs = liveNetworkMetrics.mcast_srcs;
  const hasMcastSrcs = mcastSrcs && mcastSrcs.length > 0;
  const displayedSrcs = hasMcastSrcs
    ? mcastSrcs.slice(0, MAX_MCAST_DISPLAY)
    : undefined;
  const hiddenCount =
    hasMcastSrcs && mcastSrcs.length > MAX_MCAST_DISPLAY
      ? mcastSrcs.length - MAX_MCAST_DISPLAY
      : 0;

  return (
    <Card style={{ flexGrow: 1 }}>
      <Flex direction="column" height="100%" gap={headerGap}>
        <Text className={tableStyles.headerText}>Shreds</Text>
        <Table.Root
          variant="ghost"
          className={tableStyles.root}
          size="1"
          style={{ "--bar-height": `${chartHeight}px` } as CSSProperties}
        >
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell width="60px">
                Source
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
            <TurbineRow ingress={liveNetworkMetrics.ingress} />
            {displayedSrcs
              ? [
                  ...displayedSrcs.map((src) => (
                    <McastSrcRow
                      key={src.label}
                      label={src.grp_label ?? src.label}
                      shreds={src.shreds}
                      bytes={src.bytes}
                      dedup={src.dedup}
                      parseFailed={src.parse_failed}
                    />
                  )),
                  hiddenCount > 0 && (
                    <Table.Row key="more">
                      <Table.Cell colSpan={4}>
                        <Text
                          size="1"
                          style={{ opacity: 0.45, fontStyle: "italic" }}
                        >
                          and {hiddenCount} more source
                          {hiddenCount > 1 ? "s" : ""}…
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ),
                ]
              : [
                  <McastSrcRow
                    key="mcast"
                    label="mcast"
                    shreds={liveNetworkMetrics.ingress[MCAST_IDX] ?? 0}
                    bytes={0}
                  />,
                  <McastLeadRow
                    key="mcast-lead"
                    ingress={liveNetworkMetrics.ingress}
                  />,
                ]}
            <IngressTotalRow ingress={liveNetworkMetrics.ingress} />
            <DedupRow ingress={liveNetworkMetrics.ingress} />
          </Table.Body>
        </Table.Root>
      </Flex>
    </Card>
  );
}
