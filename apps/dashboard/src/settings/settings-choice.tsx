import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Switch } from "@/ui/switch";

export interface ChoiceOption {
  value: string;
  label: string;
  sub?: string;
}

/** A radio group of a few labelled choices, each with a line under it. */
export const ChoiceGroup = ({
  name,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: ChoiceOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) => (
  <fieldset data-testid={`choice-${name}`} disabled={disabled} className="flex flex-col gap-1.5">
    <legend className="mb-1 text-[12px] font-medium text-text">{label}</legend>
    {options.map((option) => (
      <label
        key={option.value}
        className={cn(
          "flex cursor-pointer items-start gap-2 rounded-row px-2 py-1.5 hover:bg-hover",
          disabled && "cursor-default opacity-70 hover:bg-transparent",
        )}
      >
        <input
          type="radio"
          name={name}
          value={option.value}
          data-testid={`choice-${name}-${option.value}`}
          checked={value === option.value}
          disabled={disabled}
          onChange={() => onChange(option.value)}
          className="mt-0.5 accent-[var(--color-running)]"
        />
        <span className="flex flex-col">
          <span className="text-[12.5px] text-text">{option.label}</span>
          {option.sub ? <span className="text-[11.5px] text-text-subtle">{option.sub}</span> : null}
        </span>
      </label>
    ))}
  </fieldset>
);

/** A switch with its label and a line under it. */
export const ToggleRow = ({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <div className="flex items-start gap-4">
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="block text-[12px] font-medium text-text">
        {label}
      </label>
      <p className="mt-0.5 text-[11.5px] text-text-subtle">{description}</p>
    </div>
    <Switch
      id={id}
      data-testid={id}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
  </div>
);
