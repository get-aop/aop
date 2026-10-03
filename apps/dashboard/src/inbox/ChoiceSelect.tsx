import { cn } from "@/lib/cn";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

/** A select over plain choices, where `null` is "none" (Radix keeps "" for itself). */
export const ChoiceSelect = ({
  value,
  options,
  onChange,
  label,
  testId,
  none,
  className,
}: {
  value: string | null;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string | null) => void;
  label: string;
  testId: string;
  /** The "none" choice's words; without it, a choice is required. */
  none?: string;
  className?: string;
}) => (
  <Select
    // "" shows the placeholder: a required choice not made yet reads as its label.
    value={value ?? (none ? NONE : "")}
    onValueChange={(next) => onChange(next === NONE ? null : next)}
  >
    <SelectTrigger
      aria-label={label}
      data-testid={testId}
      className={cn("h-8 text-[13px]", className)}
    >
      <SelectValue placeholder={label} />
    </SelectTrigger>
    <SelectContent>
      {none ? <SelectItem value={NONE}>{none}</SelectItem> : null}
      {options.map((option) => (
        <SelectItem
          key={option.value}
          value={option.value}
          data-testid={`${testId}-${option.value}`}
        >
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const NONE = "__none__";
