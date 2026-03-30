import { Flex, Badge } from "@radix-ui/themes";
import TransactionsCard from "./TransactionsCard";
import SlotPerformance from "./SlotPerformance";
import ValidatorsCard from "./ValidatorsCard";
import SlotStatusCard from "./StatusCard";
import EpochCard from "./EpochCard";
import ShredsProgression from "./ShredsProgression";
import LiveNetworkMetrics from "./LiveNetworkMetrics";
import ShredsMetrics from "./ShredsMetrics";
import ShredSankey from "./ShredsMetrics/ShredSankey";
import ShredRaceCard from "./ShredsMetrics/ShredRaceCard";
import ShredRaceHistoryCard from "./ShredsMetrics/ShredRaceHistoryCard";
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

function ShredsRow({
  hasTxlog,
  tileCounts,
  groupedLiveIdlePerTile,
}: {
  hasTxlog: boolean;
  tileCounts: Record<string, number>;
  groupedLiveIdlePerTile: Record<string, number[]> | undefined;
}) {
  return (
    <Flex wrap="wrap" gap="4">
      <Flex style={{ flexBasis: "calc(50% - 8px)", flexGrow: 1 }}>
        <ShredsMetrics />
      </Flex>
      <Flex style={{ flexBasis: "calc(50% - 8px)", flexGrow: 1 }}>
        <ShredRaceCard />
      </Flex>
      {hasTxlog && (
        <Flex style={{ flexBasis: "calc(50% - 8px)", flexGrow: 1 }}>
          <TxlogCard
            tileCount={tileCounts["dexf"]}
            liveIdlePerTile={groupedLiveIdlePerTile?.["dexf"]}
          />
        </Flex>
      )}
    </Flex>
  );
}

export default function Overview() {
  const tiles = useAtomValue(tilesAtom);
  const tileCounts = useAtomValue(tileCountAtom);
  const groupedLiveIdlePerTile = useAtomValue(groupedLiveIdlePerTileAtom);
  const layoutMode = useAtomValue(layoutModeAtom);
  const isRelayMode = layoutMode === "shred_relay";
  const hasTxlog =
    !!tiles?.some((t) => t.kind === "dexf") && tileCounts["dexf"] > 0;

  if (isRelayMode) {
    return (
      <Flex direction="column" gap="4" flexGrow="1">
        <Flex>
          <Badge color="orange" variant="soft" radius="full">
            Shred Relay Mode
          </Badge>
        </Flex>
        <ShredsRow
          hasTxlog={hasTxlog}
          tileCounts={tileCounts}
          groupedLiveIdlePerTile={groupedLiveIdlePerTile}
        />
        <LiveTileMetrics />
        <ShredRaceHistoryCard />
        <ShredSankey />
        <LiveNetworkMetrics />
      </Flex>
    );
  }

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
      <ShredSankey />
      <ShredRaceHistoryCard />
      <ShredsRow
        hasTxlog={hasTxlog}
        tileCounts={tileCounts}
        groupedLiveIdlePerTile={groupedLiveIdlePerTile}
      />
      <LiveTileMetrics />
    </Flex>
  );
}
