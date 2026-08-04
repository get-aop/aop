import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Wider panel for long / high-risk warnings. */
  large?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Kit confirm modal — replaces the legacy ConfirmDialog (PLAN §5.1 AlertDialog). */
export const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  large = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => (
  <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
    <AlertDialogContent className={large ? "w-[520px]" : "w-[512px]"}>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{message}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="confirm-dialog-cancel">{cancelLabel}</AlertDialogCancel>
        <AlertDialogAction
          data-testid="confirm-dialog-confirm"
          className={
            destructive
              ? "border border-blocked/30 bg-blocked/10 text-blocked hover:bg-blocked/15"
              : undefined
          }
          onClick={onConfirm}
        >
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export type { ConfirmDialogProps, ReactNode };
