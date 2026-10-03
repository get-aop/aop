import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { useRuntimeConfiguration } from "../hooks/runtime-configuration";
import { runtimeChoices } from "./chat/runtime-options";

/**
 * Picks a runtime (AOP settings › Runtimes) for a role. Runtimes the host found not ready are
 * listed but cannot be picked, each with the reason; the one already chosen stays shown even when
 * it is not ready, so the row never claims something the project does not run on.
 */
export const RuntimeSelect = ({
  id,
  value,
  onChange,
  label,
  testId,
  className,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (runtimeId: string) => void;
  label: string;
  testId: string;
  className?: string;
  disabled?: boolean;
}) => {
  const { providers, statuses } = useRuntimeConfiguration();
  const choices = runtimeChoices(providers, statuses);
  const known = choices.some((choice) => choice.id === value);
  return (
    // Keyed on what it shows: Radix keeps the closed trigger's text from the items it first had,
    // so a value or list that arrives later (the host's default, the runtimes) needs a fresh one.
    <Select
      key={`${value}:${choices.length}`}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} data-testid={testId} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {/* Until the runtimes load, and for one that is gone, the id stands in for the name. */}
        {known ? null : (
          <SelectItem value={value}>
            {providers.length === 0 ? value : `${value} (removed)`}
          </SelectItem>
        )}
        {choices.map((choice) => (
          <SelectItem
            key={choice.id}
            value={choice.id}
            disabled={!choice.ready && choice.id !== value}
            data-testid={`${testId}-option-${choice.id}`}
            title={choice.reason ?? undefined}
            description={
              choice.ready ? undefined : (
                <span className="block max-w-72 truncate text-meta text-text-subtle">
                  {choice.reason}
                </span>
              )
            }
          >
            {choice.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/** Under a runtime picker: why the runtime chosen cannot run turns, or nothing when it can. */
export const RuntimeNotReady = ({ runtimeId, testId }: { runtimeId: string; testId: string }) => {
  const { statuses } = useRuntimeConfiguration();
  const status = statuses?.[runtimeId];
  if (!status || status.ready) return null;
  return (
    <p data-testid={testId} className="text-meta break-all text-blocked">
      Not ready: {status.reason}
    </p>
  );
};
