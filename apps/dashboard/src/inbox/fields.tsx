import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import { Checkbox } from "@/ui/checkbox";
import { Switch } from "@/ui/switch";

/** A label above its control; the control gets the id the label points at. */
export const LabeledField = ({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}) => {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-[12px] text-text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
};

/** A checkbox with its words beside it. */
export const TickRow = ({
  testId,
  checked,
  onChange,
  children,
}: {
  testId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) => {
  const id = useId();
  return (
    <div className="flex items-start gap-2 text-[12.5px] text-text">
      <Checkbox
        id={id}
        data-testid={testId}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <label htmlFor={id}>{children}</label>
    </div>
  );
};

/** A switch at the end of its line of words. */
export const SwitchRow = ({
  testId,
  checked,
  onChange,
  children,
}: {
  testId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) => {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px] text-text">
      <label htmlFor={id}>{children}</label>
      <Switch id={id} data-testid={testId} checked={checked} onCheckedChange={onChange} />
    </div>
  );
};
