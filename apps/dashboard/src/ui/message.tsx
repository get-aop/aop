import { cn } from "@/lib/cn";
import { RuntimeProviderIcon } from "@/ui/provider-icon";

/** Assistant turns (PLAN §5.2). Compose: Message > MessageHeader + MessageContent + MessageFooter. */
function Message({ className, ...props }: React.ComponentProps<"article">) {
  return (
    <article
      data-slot="message"
      className={cn("group flex flex-col gap-1.5 py-3", className)}
      {...props}
    />
  );
}

interface MessageHeaderProps extends React.ComponentProps<"div"> {
  runtime?: string;
  model?: string;
  time?: string;
}

/** 12px subtle: provider mark + model label + time (sans, never mono). */
function MessageHeader({
  runtime,
  model,
  time,
  className,
  children,
  ...props
}: MessageHeaderProps) {
  return (
    <div
      data-slot="message-header"
      className={cn("flex items-center gap-1.5 text-[12px] text-text-subtle", className)}
      {...props}
    >
      {runtime ? <RuntimeProviderIcon runtime={runtime} className="size-[13px]" /> : null}
      {model ? <span className="font-medium">{model}</span> : null}
      {time ? <span>{time}</span> : null}
      {children}
    </div>
  );
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn("min-w-0 text-[14px] leading-relaxed text-text", className)}
      {...props}
    />
  );
}

/** Hover-revealed ghost icon buttons (copy · retry fresh). */
function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        "flex items-center gap-1 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

export { Message, MessageContent, MessageFooter, MessageHeader };
