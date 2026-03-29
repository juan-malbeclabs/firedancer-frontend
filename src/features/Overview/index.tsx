import { Flex } from "@radix-ui/themes";
import TransactionsCard from "./TransactionsCard";
import SlotPerformance from "./SlotPerformance";
import ValidatorsCard from "./ValidatorsCard";
import SlotStatusCard from "./StatusCard";
import EpochCard from "./EpochCard";
import ShredsProgression from "./ShredsProgression";
import LiveNetworkMetrics from "./LiveNetworkMetrics";
import ShredsMetrics from "./ShredsMetrics";
import ShredSankey from "./ShredsMetrics/ShredSankey";
import TxlogCard from "./SlotPerformance/TxlogCard";
import LiveTileMetrics from "./LiveTileMetrics";
import SlotTimeline from "./SlotTimeline";
import { useAtomValue } from "jotai";
import { tilesAtom } from "../../api/atoms";
import {
  tileCountAtom,
  groupedLiveIdlePerTileAtom,
} from "./SlotPerformance/atoms";
import { layoutModeAtom } from "../../api/atoms";

export default function Overview() {
  const tiles = useAtomValue(tilesAtom);
  const tileCounts = useAtomValue(tileCountAtom);
  const groupedLiveIdlePerTile = useAtomValue(groupedLiveIdlePerTileAtom);
  const layoutMode = useAtomValue(layoutModeAtom);
  const isRelayMode = layoutMode === "shred_relay";
  const hasTxlog =
    !!tiles?.some((t) => t.kind === "dexfilter") && tileCounts["dexfilter"] > 0;

  return (
    <Flex direction="column" gap="4" flexGrow="1">
      {!isRelayMode && <SlotTimeline />}
      {!isRelayMode && (
        <Flex gap="16px" align="stretch" wrap="wrap">
          <EpochCard />
          <SlotStatusCard />
          <ValidatorsCard />
          <TransactionsCard />
        </Flex>
      )}
      {!isRelayMode && <ShredsProgression />}
      {!isRelayMode && <SlotPerformance />}
      <LiveNetworkMetrics />
      <ShredSankey />
      <Flex wrap="wrap" gap="4">
        <Flex style={{ flexBasis: "calc(50% - 8px)", flexGrow: 1 }}>
          <ShredsMetrics />
        </Flex>
        {hasTxlog && (
          <Flex style={{ flexBasis: "calc(50% - 8px)", flexGrow: 1 }}>
            <TxlogCard
              tileCount={tileCounts["dexfilter"]}
              liveIdlePerTile={groupedLiveIdlePerTile?.["dexfilter"]}
            />
          </Flex>
        )}
      </Flex>
      <LiveTileMetrics />
    </Flex>
  );
}
