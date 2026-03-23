import { Box, Flex, Text } from "@radix-ui/themes";
import Card from "../../../components/Card";
import styles from "./tileCard.module.css";
import txlogStyles from "./txlogCard.module.css";
import TileSparkLine from "./TileSparkLine";
import { useAtomValue } from "jotai";
import TileBusy from "./TileBusy";
import { selectedSlotAtom } from "./atoms";
import TileSparkLineExpandedContainer from "./TileSparkLineExpandedContainer";
import { useMeasure } from "react-use";
import type React from "react";
import { useLastDefinedValue, useTileSparkline } from "./useTileSparkline";
import { liveTilePrimaryMetricAtom } from "../../../api/atoms";
import { useSlotQueryResponseDetailed } from "../../../hooks/useSlotQuery";
import type { TilePrimaryMetric } from "../../../api/types";

interface TxlogCardProps {
  tileCount: number;
  liveIdlePerTile?: number[];
  queryIdlePerTile?: number[][];
}

interface StatPillProps {
  label: string;
  metricType: keyof TilePrimaryMetric;
  isError?: boolean;
}

function StatPill({ label, metricType, isError = false }: StatPillProps) {
  const slot = useAtomValue(selectedSlotAtom);
  const showLive = !slot;
  const primaryMetric = useAtomValue(liveTilePrimaryMetricAtom);
  const query = useSlotQueryResponseDetailed(showLive ? undefined : slot);

  const value = showLive
    ? primaryMetric?.tile_primary_metric?.[metricType]
    : query.response?.tile_primary_metric?.[metricType];

  const display =
    value === undefined || value === -1 ? "-" : value.toLocaleString();

  const hasError = isError && value !== undefined && value > 0;

  return (
    <div className={txlogStyles.pill}>
      <Text className={txlogStyles.pillLabel}>{label}</Text>
      <Text
        className={txlogStyles.pillValue}
        style={hasError ? { color: "var(--red-9)" } : undefined}
      >
        {display}
      </Text>
    </div>
  );
}

export default function TxlogCard({
  tileCount,
  liveIdlePerTile,
  queryIdlePerTile,
}: TxlogCardProps) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();

  const selectedSlot = useAtomValue(selectedSlotAtom);
  const isLive = selectedSlot === undefined;

  const {
    avgBusy: currentAvgBusy,
    aggQueryBusyPerTs,
    tileCountArr,
    liveBusyPerTile,
    busy,
  } = useTileSparkline({
    isLive,
    tileCount,
    liveIdlePerTile,
    queryIdlePerTile,
  });
  const avgBusy = useLastDefinedValue(currentAvgBusy);

  const header = (
    <Flex direction="column" gap="1">
      <Flex justify="between" align="center" gap="1">
        <Text className={styles.header}>Tx Processor</Text>
        <StatPill label="Txns" metricType="txproc_txns" />
      </Flex>
      <Flex gap="1" wrap="wrap">
        <StatPill label="Batches" metricType="txproc_batches" />
        <StatPill label="DEX" metricType="txproc_dex_txns" />
        <StatPill label="Votes↷" metricType="txproc_votes_skipped" />
        <StatPill label="Parse err" metricType="txproc_parse_errors" isError />
        <StatPill label="Write err" metricType="txproc_write_errors" isError />
        <StatPill label="Truncated" metricType="txproc_truncated" isError />
      </Flex>
    </Flex>
  );

  return (
    <Flex ref={ref} style={{ flexGrow: 1 }}>
      <Card className={styles.fullWidth}>
        <Flex direction="column" justify="between" height="100%" gap="1">
          {header}
          <Box flexGrow="1" />
          <TileSparkLine value={avgBusy} queryBusy={aggQueryBusyPerTs} />
          <TileSparkLineExpandedContainer
            tileCountArr={tileCountArr}
            liveBusyPerTile={liveBusyPerTile}
            queryIdlePerTile={queryIdlePerTile}
            width={width}
            header={header}
            isExpanded={false}
            setIsExpanded={() => {}}
          >
            <div className={styles.tileContainer}>
              {tileCountArr.map((_, i) => {
                const tileBusy = busy?.[i];
                if (tileBusy === undefined) {
                  return (
                    <div
                      key={i}
                      className={styles.tile}
                      style={{ background: "gray" }}
                    />
                  );
                }
                return (
                  <div
                    key={i}
                    className={styles.tile}
                    style={
                      {
                        "--busy": `${tileBusy * 100}%`,
                      } as React.CSSProperties
                    }
                  />
                );
              })}
            </div>
            <TileBusy busy={avgBusy} />
          </TileSparkLineExpandedContainer>
        </Flex>
      </Card>
    </Flex>
  );
}
