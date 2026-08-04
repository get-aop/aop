import type { RuntimeConfigurationProvider } from "@aop/common";
import { CheckIcon, ChevronDownIcon, StarIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/cn";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { RuntimeProviderIcon } from "@/ui/provider-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { isRunnableRuntimeConfiguration } from "../../runtime-configuration-selection";
import { getModelLabel, getRuntimeUi, modelOptionsFor } from "./sessions-runtime";

const MODEL_FAVORITES_STORAGE_KEY = "aop:composer-model-favorites:v1";

interface ComposerModelPickerProps {
  runtime: string;
  runtimeConfigurationId?: string | null;
  runtimeConfigurations: RuntimeConfigurationProvider[];
  model: string;
  label: string;
  compact?: boolean;
  onModelChange?: (model: string, runtimeConfigurationId?: string) => void;
}

interface ModelPickerProvider {
  id: string;
  configurationId: string | null;
  name: string;
  runtime: string;
  models: Array<{ model: string; label: string }>;
}

interface ModelPickerItem {
  key: string;
  model: string;
  label: string;
  provider: ModelPickerProvider;
}

interface ModelFavorite {
  provider: string;
  model: string;
}

/**
 * THE model picker — provider tabs + Favorites tab (default when favorites
 * exist), search, favorites-first, star toggles, localStorage persistence.
 * UX identical to the pre-refactor picker, re-hosted on Popover+Command (§7.5).
 */
export const ComposerModelPicker = (props: ComposerModelPickerProps) => {
  const providers = useMemo(() => modelPickerProviders(props), [props]);
  const activeProviderId =
    providers.find((provider) => provider.id === props.runtimeConfigurationId)?.id ??
    providers.find((provider) => provider.runtime === props.runtime)?.id ??
    providers[0]?.id ??
    "";
  const [storedFavorites, setStoredFavorites] = useLocalStorage<ModelFavorite[]>(
    MODEL_FAVORITES_STORAGE_KEY,
    [],
  );
  const favorites = Array.isArray(storedFavorites) ? storedFavorites : [];
  const favoriteKeys = useMemo(
    () => new Set(favorites.map((favorite) => modelKey(favorite.provider, favorite.model))),
    [favorites],
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | "favorites">(() =>
    favorites.length > 0 ? "favorites" : activeProviderId,
  );

  useEffect(() => {
    if (selectedProviderId === "favorites" && favorites.length > 0) return;
    if (providers.some((provider) => provider.id === selectedProviderId)) return;
    setSelectedProviderId(activeProviderId);
  }, [activeProviderId, favorites.length, providers, selectedProviderId]);

  const allModels = useMemo(
    () =>
      providers.flatMap((provider) =>
        provider.models.map((option) => ({
          key: modelKey(provider.id, option.model),
          model: option.model,
          label: option.label,
          provider,
        })),
      ),
    [providers],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    const visible = normalizedQuery
      ? allModels.filter((item) =>
          `${item.label} ${item.model} ${item.provider.name} ${item.provider.runtime}`
            .toLowerCase()
            .includes(normalizedQuery),
        )
      : allModels.filter((item) =>
          selectedProviderId === "favorites"
            ? favoriteKeys.has(item.key)
            : item.provider.id === selectedProviderId,
        );
    return visible.toSorted((left, right) => {
      const favoriteDelta =
        Number(favoriteKeys.has(right.key)) - Number(favoriteKeys.has(left.key));
      return favoriteDelta || left.label.localeCompare(right.label);
    });
  }, [allModels, favoriteKeys, normalizedQuery, selectedProviderId]);
  const activeKey = modelKey(activeProviderId, props.model);

  const selectModel = (item: ModelPickerItem) => {
    props.onModelChange?.(item.model, item.provider.configurationId ?? undefined);
    setOpen(false);
    setQuery("");
  };

  const toggleFavorite = (item: ModelPickerItem) => {
    setStoredFavorites((current) => {
      const safeCurrent = Array.isArray(current) ? current : [];
      const exists = safeCurrent.some(
        (favorite) => favorite.provider === item.provider.id && favorite.model === item.model,
      );
      return exists
        ? safeCurrent.filter(
            (favorite) => favorite.provider !== item.provider.id || favorite.model !== item.model,
          )
        : [...safeCurrent, { provider: item.provider.id, model: item.model }];
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="composer-runtime-config"
          aria-label="Model"
          className={cn(
            "flex h-7 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-2 text-[12.5px] font-medium text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text",
            props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56",
          )}
        >
          <RuntimeProviderIcon runtime={props.runtime} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 overflow-hidden truncate text-left">{props.label}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div
          data-testid="model-picker-content"
          data-model-picker-content="true"
          className="flex max-h-96 w-100 flex-row overflow-hidden rounded-menu border border-border-strong bg-overlay text-text shadow-2"
        >
          {normalizedQuery ? null : (
            <ModelPickerSidebar
              providers={providers}
              selectedProviderId={selectedProviderId}
              onSelectProvider={setSelectedProviderId}
            />
          )}
          <Command shouldFilter={false} className="min-h-0 flex-1 bg-transparent">
            <div className="border-b border-border">
              <CommandInput placeholder="Search models..." value={query} onValueChange={setQuery} />
            </div>
            <CommandList
              data-testid="model-picker-model-list"
              className="max-h-80 overflow-y-auto overscroll-y-contain"
            >
              <CommandEmpty>No models found</CommandEmpty>
              {filteredModels.map((item) => (
                <ModelListRow
                  key={item.key}
                  item={item}
                  selected={item.key === activeKey}
                  favorite={favoriteKeys.has(item.key)}
                  onSelect={() => selectModel(item)}
                  onToggleFavorite={() => toggleFavorite(item)}
                />
              ))}
            </CommandList>
          </Command>
        </div>
      </PopoverContent>
    </Popover>
  );
};

const ModelPickerSidebar = ({
  providers,
  selectedProviderId,
  onSelectProvider,
}: {
  providers: ModelPickerProvider[];
  selectedProviderId: string | "favorites";
  onSelectProvider: (providerId: string | "favorites") => void;
}) => (
  <div
    className="w-12 shrink-0 overflow-hidden border-r border-border bg-raised/50"
    data-testid="model-picker-sidebar"
    data-model-picker-sidebar="true"
  >
    <div className="h-full overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="relative flex min-h-full flex-col gap-1 px-1 pb-1 pt-0.5">
        <div className="mb-1 border-b border-border pb-1">
          <ProviderRailButton
            label="Favorites"
            selected={selectedProviderId === "favorites"}
            onClick={() => onSelectProvider("favorites")}
          >
            <StarIcon className="size-5 shrink-0 fill-current" aria-hidden="true" />
          </ProviderRailButton>
        </div>
        {providers.map((provider) => (
          <ProviderRailButton
            key={provider.id}
            label={provider.name}
            selected={selectedProviderId === provider.id}
            onClick={() => onSelectProvider(provider.id)}
          >
            <RuntimeProviderIcon runtime={provider.runtime} className="size-5" />
          </ProviderRailButton>
        ))}
      </div>
    </div>
  </div>
);

const ProviderRailButton = ({
  label,
  selected,
  onClick,
  children,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <div className="relative w-full">
    {selected ? (
      <span className="pointer-events-none absolute -right-1 top-1/2 z-10 h-5 w-0.75 -translate-y-1/2 rounded-l-full bg-text" />
    ) : null}
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={selected}
          data-model-picker-provider={label === "Favorites" ? "favorites" : label}
          onClick={onClick}
          className="relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded-row text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  </div>
);

const ModelListRow = ({
  item,
  selected,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  item: ModelPickerItem;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) => (
  <CommandItem
    value={item.key}
    keywords={[item.label, item.model, item.provider.name, item.provider.runtime]}
    onSelect={onSelect}
    className="group flex w-full items-center gap-3 px-2 py-2.5"
  >
    <div className="min-w-0 flex-1 text-left">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 truncate text-[12.5px] font-medium leading-snug">{item.label}</div>
        {selected ? <CheckIcon className="size-3.5 shrink-0 text-running" /> : null}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <RuntimeProviderIcon runtime={item.provider.runtime} className="size-3 shrink-0" />
        <span className="truncate text-[11.5px] leading-snug text-text-subtle">
          {item.provider.name}
        </span>
      </div>
    </div>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "-mr-1 grid size-6 shrink-0 place-items-center rounded text-text-subtle opacity-0 transition-[color,opacity] duration-[120ms] hover:bg-hover hover:text-text group-hover:opacity-100",
            favorite && "text-favorite opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        >
          <StarIcon className={cn("size-3.5", favorite && "fill-current")} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {favorite ? "Remove from favorites" : "Add to favorites"}
      </TooltipContent>
    </Tooltip>
  </CommandItem>
);

const modelKey = (provider: string, model: string) => `${provider}:${model}`;

const modelPickerProviders = (props: ComposerModelPickerProps): ModelPickerProvider[] => {
  const configured = props.runtimeConfigurations
    .filter(isRunnableRuntimeConfiguration)
    .map((provider) => ({
      id: provider.id,
      configurationId: provider.id,
      name: provider.name,
      runtime: provider.driver,
      models: provider.models.map((model) => ({
        model: model.model,
        label: model.description.trim() || getModelLabel(model.model),
      })),
    }));
  if (configured.length > 0) return configured;
  return [
    {
      id: props.runtime,
      configurationId: null,
      name: getRuntimeUi(props.runtime).label,
      runtime: props.runtime,
      models: modelOptionsFor(props.runtime).map((model) => ({
        model,
        label: getModelLabel(model),
      })),
    },
  ];
};
