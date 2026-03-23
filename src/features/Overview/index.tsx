import { Flex } from "@radix-ui/themes";
import TransactionsCard from "./TransactionsCard";
import SlotPerformance from "./SlotPerformance";
import ValidatorsCard from "./ValidatorsCard";
import SlotStatusCard from "./StatusCard";
import EpochCard from "./EpochCard";
import ShredsProgression from "./ShredsProgression";
import LiveNetworkMetrics from "./LiveNetworkMetrics";
import ShredsMetrics from "./ShredsMetrics";
import TxlogCard from "./SlotPerformance/TxlogCard";
import LiveTileMetrics from "./LiveTileMetrics";
import SlotTimeline from "./SlotTimeline";
import { useAtomValue } from "jotai";
import { tilesAtom } from "../../api/atoms";
import {
  tileCountAtom,
  groupedLiveIdlePerTileAtom,
} from "./SlotPerformance/atoms";

export default function Overview() {
  const tiles = useAtomValue(tilesAtom);
  const tileCounts = useAtomValue(tileCountAtom);
  const groupedLiveIdlePerTile = useAtomValue(groupedLiveIdlePerTileAtom);
  const hasTxlog =
    !!tiles?.some((t) => t.kind === "txlog") && tileCounts["txlog"] > 0;

  return (
    <Flex direction="column" gap="4" flexGrow="1">
      <SlotTimeline />
      <Flex gap="16px" align="stretch" wrap="wrap">
        <EpochCard />
        <SlotStatusCard />
        <ValidatorsCard />
        <TransactionsCard />
      </Flex>
      <ShredsProgression />
      <SlotPerformance />
      <LiveNetworkMetrics />
      <Flex wrap="wrap" gap="4">
        <ShredsMetrics />
        {hasTxlog && (
          <TxlogCard
            tileCount={tileCounts["txlog"]}
            liveIdlePerTile={groupedLiveIdlePerTile?.["txlog"]}
          />
        )}
      </Flex>
      <LiveTileMetrics />
    </Flex>
  );
}
