import type { ProjectColor, ProjectIcon } from "@aop/common";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { ProjectTile } from "./ProjectTile";
import { PROJECT_COLORS, PROJECT_ICONS, type ProjectAppearance } from "./project-appearance";

export interface AppearanceChoice {
  icon: ProjectIcon | null;
  color: ProjectColor | null;
}

/**
 * A project's name box with its tile at the start: the tile opens a small picker of icons and
 * colours. "Letter" and "Auto" put back the fallback, the name's first letter on the id's hue.
 */
export const NameAndIconInput = ({
  appearance,
  onPick,
  pickerTestId,
  className,
  ...input
}: ComponentProps<typeof Input> & {
  appearance: ProjectAppearance;
  onPick: (choice: AppearanceChoice) => void;
  pickerTestId: string;
}) => (
  <div className={cn("relative", className)}>
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={pickerTestId}
          aria-label="Choose an icon and colour"
          title="Choose an icon and colour"
          className="absolute top-1/2 left-1 z-10 grid size-7 -translate-y-1/2 place-items-center rounded-md hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ProjectTile project={appearance} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" data-testid="project-appearance-picker" className="w-64 p-3">
        <AppearancePicker appearance={appearance} onPick={onPick} />
      </PopoverContent>
    </Popover>
    <Input {...input} className="pl-10" />
  </div>
);

const AppearancePicker = ({
  appearance,
  onPick,
}: {
  appearance: ProjectAppearance;
  onPick: (choice: AppearanceChoice) => void;
}) => {
  const { icon, color } = appearance;
  const letter = appearance.name.trim().charAt(0) || "?";
  return (
    <div className="flex flex-col gap-3">
      <PickerGroup title="Icon">
        <div className="grid grid-cols-7 gap-1">
          <OptionButton
            testId="project-icon-option-letter"
            label="First letter"
            selected={icon === null}
            onClick={() => onPick({ icon: null, color })}
          >
            <span className="text-[12px] font-semibold uppercase">{letter}</span>
          </OptionButton>
          {Object.entries(PROJECT_ICONS).map(([key, { glyph: Glyph, label }]) => (
            <OptionButton
              key={key}
              testId={`project-icon-option-${key}`}
              label={label}
              selected={icon === key}
              onClick={() => onPick({ icon: key as ProjectIcon, color })}
            >
              <Glyph className="size-4" />
            </OptionButton>
          ))}
        </div>
      </PickerGroup>
      <PickerGroup title="Colour">
        <div className="grid grid-cols-9 gap-1">
          <OptionButton
            testId="project-color-option-auto"
            label="Automatic colour"
            selected={color === null}
            onClick={() => onPick({ icon, color: null })}
          >
            <AutoSwatch />
          </OptionButton>
          {Object.entries(PROJECT_COLORS).map(([key, { hue, label }]) => (
            <OptionButton
              key={key}
              testId={`project-color-option-${key}`}
              label={label}
              selected={color === key}
              onClick={() => onPick({ icon, color: key as ProjectColor })}
            >
              <Swatch hue={hue} />
            </OptionButton>
          ))}
        </div>
      </PickerGroup>
    </div>
  );
};

const PickerGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
    <legend className="mb-1.5 p-0 text-[12px] text-text-subtle">{title}</legend>
    {children}
  </fieldset>
);

const OptionButton = ({
  testId,
  label,
  selected,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    data-testid={testId}
    aria-label={label}
    aria-pressed={selected}
    title={label}
    onClick={onClick}
    className={cn(
      "grid size-7 place-items-center rounded-md text-text-muted hover:bg-hover hover:text-text",
      selected && "bg-active text-text ring-1 ring-border-strong",
    )}
  >
    {children}
  </button>
);

// Brighter than the tile itself, so eight dark tiles do not read as one colour in the picker.
const swatchColor = (hue: number): string => `hsl(${hue} 45% 55%)`;

const Swatch = ({ hue }: { hue: number }) => (
  <span
    className="size-4 rounded-full ring-1 ring-white/20"
    style={{ background: swatchColor(hue) }}
  />
);

// Every hue at once: "Auto" is whichever one the project's id lands on, not one more colour.
const AUTO_SWATCH = `conic-gradient(${Object.values(PROJECT_COLORS)
  .map(({ hue }) => swatchColor(hue))
  .join(", ")}, ${swatchColor(PROJECT_COLORS.blue.hue)})`;

const AutoSwatch = () => (
  <span className="size-4 rounded-full ring-1 ring-white/20" style={{ background: AUTO_SWATCH }} />
);
