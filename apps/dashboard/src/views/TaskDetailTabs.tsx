import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";

export type DetailTab = "specs" | "logs";

/** Task-detail tabs on the kit pill switcher (PLAN §6.6). */
export const TaskDetailTabs = ({
  activeTab,
  onTabChange,
  isWorking,
  showSpecs = true,
}: {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  isWorking: boolean;
  showSpecs?: boolean;
}) => (
  <div
    data-testid="tab-switcher"
    className="flex shrink-0 items-center border-b border-border px-6"
  >
    <Tabs value={activeTab} onValueChange={(tab) => onTabChange(tab as DetailTab)}>
      <TabsList className="h-10 justify-start gap-0.5 rounded-none bg-transparent">
        {showSpecs ? (
          <TabsTrigger
            value="specs"
            data-testid="tab-specs"
            className="h-9 rounded-none border-b-2 border-transparent px-1 text-[13.5px] font-semibold text-text-subtle data-[state=active]:border-running data-[state=active]:bg-transparent data-[state=active]:text-text data-[state=active]:shadow-none"
          >
            Spec
          </TabsTrigger>
        ) : null}
        <TabsTrigger
          value="logs"
          data-testid="tab-logs"
          className="h-9 gap-1.5 rounded-none border-b-2 border-transparent px-1 text-[13.5px] font-semibold text-text-subtle data-[state=active]:border-running data-[state=active]:bg-transparent data-[state=active]:text-text data-[state=active]:shadow-none"
        >
          Logs & runs
          {isWorking ? (
            <span
              data-testid="live-indicator"
              className="aop-running-dot size-1.5 rounded-full bg-running motion-safe:animate-[aop-pulse_2s_ease-in-out_infinite]"
            />
          ) : null}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  </div>
);
