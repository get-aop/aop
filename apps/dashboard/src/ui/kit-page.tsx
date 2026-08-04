import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui/alert-dialog";
import { Attachment } from "@/ui/attachment";
import { Badge } from "@/ui/badge";
import { Bubble } from "@/ui/bubble";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Chip } from "@/ui/chip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import { Input } from "@/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { Kbd } from "@/ui/kbd";
import { Label } from "@/ui/label";
import { Marker, MarkerIcon, MarkerSeparator } from "@/ui/marker";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/ui/message";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Progress } from "@/ui/progress";
import { RuntimeProviderIcon } from "@/ui/provider-icon";
import { ScrollArea } from "@/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Separator } from "@/ui/separator";
import { Skeleton } from "@/ui/skeleton";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Textarea } from "@/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-3 border-b border-border pb-8">
    <h2 className="text-[13px] font-semibold text-text">{title}</h2>
    {children}
  </section>
);

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2">{children}</div>
);

/** Dev-only kitchen sink: every kit component × variant, against the concept. */
export const KitPage = () => {
  const [progress, setProgress] = useState(40);

  return (
    <TooltipProvider>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 overflow-y-auto p-8 text-text">
        <h1 className="text-[15px] font-semibold">Graphite kit</h1>

        <Section title="Button">
          <Row>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button size="sm">Small</Button>
            <Button size="icon">+</Button>
            <Button size="icon-sm">+</Button>
          </Row>
        </Section>

        <Section title="Chip (every variant — the only pill)">
          <Row>
            <Chip variant="filter">All</Chip>
            <Chip variant="filter" on>
              aop-mono
            </Chip>
            <Chip variant="filter">+3</Chip>
          </Row>
          <Row>
            <Chip variant="ghost">Opus 4.8</Chip>
            <Chip variant="ghost" on>
              High effort
            </Chip>
            <Chip variant="ghost">Fast</Chip>
          </Row>
          <Row>
            <Chip variant="git">⎇ main</Chip>
            <Chip variant="git">+12 −3</Chip>
            <Chip variant="git">Tasks (2)</Chip>
          </Row>
          <Row>
            <Chip variant="step" data-state="done">
              ✓ Implement
            </Chip>
            <Chip variant="step" data-state="active">
              ● Code review
            </Chip>
            <Chip variant="step">Test</Chip>
            <Chip variant="step" data-state="legacy">
              7 steps
            </Chip>
          </Row>
          <Row>
            <Chip variant="mini">🔨 opus</Chip>
            <Chip variant="mini">🧪 gpt</Chip>
          </Row>
        </Section>

        <Section title="Badge">
          <Row>
            <Badge variant="done">Done</Badge>
            <Badge variant="working">Working</Badge>
            <Badge variant="blocked">Blocked</Badge>
            <Badge variant="ready">Ready</Badge>
            <Badge variant="draft">Draft</Badge>
            <Badge variant="count">4</Badge>
            <Badge variant="tag">Legacy</Badge>
            <Badge variant="tag">git·main</Badge>
          </Row>
        </Section>

        <Section title="Provider icons">
          <Row>
            {["pi", "claude-code", "codex-cli", "grok", "open-code"].map((r) => (
              <span key={r} className="flex items-center gap-1.5 text-[12px] text-text-muted">
                <RuntimeProviderIcon runtime={r} className="size-4" /> {r}
              </span>
            ))}
          </Row>
        </Section>

        <Section title="Fields">
          <Field>
            <FieldLabel htmlFor="kit-name">Workflow name</FieldLabel>
            <Input id="kit-name" placeholder="Ship it" />
            <FieldDescription>Shown in the picker and rail.</FieldDescription>
          </Field>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search sessions" />
            <InputGroupAddon align="inline-end">
              <Kbd>⌘K</Kbd>
            </InputGroupAddon>
          </InputGroup>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kit-notes">Notes</Label>
            <Textarea id="kit-notes" placeholder="Textarea" />
          </div>
        </Section>

        <Section title="Select · menus · popovers">
          <Row>
            <Select defaultValue="high">
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Effort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  Menu <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Rename</DropdownMenuItem>
                <DropdownMenuItem>Pin</DropdownMenuItem>
                <DropdownMenuItem>Settle</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="sm">
                  Command popover
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0">
                <Command>
                  <CommandInput placeholder="Pick a repo" />
                  <CommandList>
                    <CommandEmpty>No repos</CommandEmpty>
                    <CommandGroup>
                      <CommandItem>aop-mono</CommandItem>
                      <CommandItem>pi</CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  ?
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tooltip (300ms)</TooltipContent>
            </Tooltip>
          </Row>
        </Section>

        <Section title="Dialogs">
          <Row>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm">
                  Dialog
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[512px]">
                <DialogHeader>
                  <DialogTitle>Settings</DialogTitle>
                  <DialogDescription>Dialog chrome on the overlay surface.</DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete session?</AlertDialogTitle>
                  <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="secondary" size="sm" onClick={() => toast("Session settled")}>
              Toast
            </Button>
          </Row>
        </Section>

        <Section title="Toggles">
          <Row>
            <Switch defaultChecked />
            <Checkbox defaultChecked />
            <ToggleGroup type="single" defaultValue="a">
              <ToggleGroupItem value="a">Approval required</ToggleGroupItem>
              <ToggleGroupItem value="b">Auto-accept</ToggleGroupItem>
            </ToggleGroup>
          </Row>
        </Section>

        <Section title="Tabs · progress · skeleton · separator">
          <Tabs defaultValue="diff" className="w-80">
            <TabsList>
              <TabsTrigger value="diff">Diff</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="checks">Checks</TabsTrigger>
              <TabsTrigger value="log">Log</TabsTrigger>
            </TabsList>
            <TabsContent value="diff">Diff pane</TabsContent>
          </Tabs>
          <Row>
            <Progress value={progress} className="w-48" />
            <Button variant="ghost" size="sm" onClick={() => setProgress((p) => (p + 10) % 100)}>
              +10
            </Button>
            <Spinner />
            <Skeleton className="h-6 w-32" />
          </Row>
          <Separator />
          <Collapsible>
            <CollapsibleTrigger className="text-[13px] text-text-muted">
              Settled · 12
            </CollapsibleTrigger>
            <CollapsibleContent className="text-[12px] text-text-subtle">
              Old session rows…
            </CollapsibleContent>
          </Collapsible>
        </Section>

        <Section title="Thread (conversation suite)">
          <div className="flex h-72 flex-col rounded-card border border-border">
            <ScrollArea className="min-h-0 flex-1 p-4">
              <div className="flex flex-col gap-2">
                <MarkerSeparator>Today</MarkerSeparator>
                <Bubble>Implement the graphite sidebar.</Bubble>
                <Attachment name="mock.png" kind="image" state="done" className="ml-auto" />
                <Message>
                  <MessageHeader runtime="claude-code" model="opus-4.8" time="14:02" />
                  <MessageContent>
                    Sidebar rebuilt on the kit. Scope chips filter the flat thread list.
                  </MessageContent>
                  <MessageFooter>
                    <Button variant="ghost" size="icon-sm">
                      ⧉
                    </Button>
                  </MessageFooter>
                </Message>
                <Marker>
                  <MarkerIcon>✓</MarkerIcon> Implement passed · Code review started · 14:06
                </Marker>
                <Marker>
                  <MarkerIcon streaming /> Running tests…
                </Marker>
                <Attachment name="report.pdf" state="uploading" progress={62} />
                <Attachment name="shot.png" kind="image" state="error" onRetry={() => {}} />
              </div>
            </ScrollArea>
          </div>
        </Section>

        <Section title="Empty">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No sessions</EmptyTitle>
              <EmptyDescription>Start a new session with ⌘N.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Section>
      </div>
    </TooltipProvider>
  );
};
