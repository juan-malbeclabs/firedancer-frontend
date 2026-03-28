import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { liveNetworkMetricsAtom } from "../../../api/atoms";
import { Sankey } from "../../../sankey";
import AutoSizer from "react-virtualized-auto-sizer";
import Card from "../../../components/Card";
import { Flex, Text } from "@radix-ui/themes";
import tableStyles from "../../Gossip/table.module.css";
import { headerGap } from "../../Gossip/consts";
import { useEmaValue } from "../../../hooks/useEma";

// Ingress array indices
const TURBINE_BYTES_IDX = 0;
const SHREDS_IDX = 6;
const MCAST_IDX = 7;
const TURBINE_DUP_IDX = 9;

const emaOptions = { halfLifeMs: 1_000 };

const enum ShredNode {
  TurbineIn = "turbine in",
  McastIn = "mcast in",
  ShredTile = "shred:tile",
  DupDrop = "dup drop",
  UniqueOut = "unique",
  TurbineFwd = "turbine fwd",
  McastFwd = "mcast fwd",
}

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

interface SankeyInnerProps {
  turbineShreds: number;
  mcastShreds: number;
  turbineDup: number;
  turbineFwdBytes: number;
  mcastFwdBytes: number;
  height: number;
  width: number;
}

function SankeyInner({
  turbineShreds,
  mcastShreds,
  turbineDup,
  turbineFwdBytes,
  mcastFwdBytes,
  height,
  width,
}: SankeyInnerProps) {
  const data = useMemo(() => {
    const uniqueIn = Math.max(1, turbineShreds + mcastShreds - turbineDup);
    const dup = Math.max(0, turbineDup);
    const t = Math.max(1, turbineShreds);
    const m = Math.max(1, mcastShreds);

    // Estimate forwarding shreds from bytes using avg shred size ~1200 bytes
    const avgShredBytes = 1200;
    const turbineFwdShreds = Math.round(turbineFwdBytes / avgShredBytes);
    const mcastFwdShreds = Math.round(mcastFwdBytes / avgShredBytes);
    const localShreds = Math.max(
      1,
      uniqueIn - turbineFwdShreds - mcastFwdShreds,
    );

    const nodes = [
      { id: ShredNode.TurbineIn },
      { id: ShredNode.McastIn },
      { id: ShredNode.ShredTile },
      ...(dup > 0 ? [{ id: ShredNode.DupDrop }] : []),
      { id: ShredNode.UniqueOut },
      ...(turbineFwdShreds > 0 ? [{ id: ShredNode.TurbineFwd }] : []),
      ...(mcastFwdShreds > 0 ? [{ id: ShredNode.McastFwd }] : []),
    ];

    const links = [
      { source: ShredNode.TurbineIn, target: ShredNode.ShredTile, value: t },
      { source: ShredNode.McastIn, target: ShredNode.ShredTile, value: m },
      ...(dup > 0
        ? [
            {
              source: ShredNode.ShredTile,
              target: ShredNode.DupDrop,
              value: dup,
            },
          ]
        : []),
      {
        source: ShredNode.ShredTile,
        target: ShredNode.UniqueOut,
        value: uniqueIn,
      },
      ...(turbineFwdShreds > 0
        ? [
            {
              source: ShredNode.UniqueOut,
              target: ShredNode.TurbineFwd,
              value: turbineFwdShreds,
            },
          ]
        : []),
      ...(mcastFwdShreds > 0
        ? [
            {
              source: ShredNode.UniqueOut,
              target: ShredNode.McastFwd,
              value: mcastFwdShreds,
            },
          ]
        : []),
      ...(localShreds > 0 && (turbineFwdShreds > 0 || mcastFwdShreds > 0)
        ? []
        : []),
    ];

    return { nodes, links };
  }, [turbineShreds, mcastShreds, turbineDup, turbineFwdBytes, mcastFwdBytes]);

  return (
    <Sankey
      height={height}
      width={width}
      data={data}
      margin={{ top: 10, right: 120, bottom: 10, left: 100 }}
      align="center"
      isInteractive={false}
      nodeThickness={0}
      nodeSpacing={40}
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
  const turbineDupRaw = liveNetworkMetrics?.ingress[TURBINE_DUP_IDX] ?? 0;
  const turbineFwdBytesRaw = liveNetworkMetrics?.egress[0] ?? 0;
  const mcastFwdBytesRaw = liveNetworkMetrics?.egress[1] ?? 0;

  // Raw bytes for labels (not used in Sankey flow, just for display)
  const turbineBytesRaw = liveNetworkMetrics?.ingress[TURBINE_BYTES_IDX] ?? 0;

  const turbineShreds = useEmaValue(turbineShredsRaw, emaOptions);
  const mcastShreds = useEmaValue(mcastShredsRaw, emaOptions);
  const turbineDup = useEmaValue(turbineDupRaw, emaOptions);
  const turbineFwdBytes = useEmaValue(turbineFwdBytesRaw, emaOptions);
  const mcastFwdBytes = useEmaValue(mcastFwdBytesRaw, emaOptions);
  const turbineBytes = useEmaValue(turbineBytesRaw, emaOptions);

  if (!liveNetworkMetrics) return null;

  const hasData = turbineShreds > 0 || mcastShreds > 0;

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
                  mcastShreds={Math.round(mcastShreds)}
                  turbineDup={Math.round(turbineDup)}
                  turbineFwdBytes={turbineFwdBytes}
                  mcastFwdBytes={mcastFwdBytes}
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
