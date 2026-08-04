import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { type ConfirmationRequest, createConfirmationController } from "./confirmation-controller";

let showConfirmation: ((request: ConfirmationRequest) => void) | null = null;

export const requestConfirmation = (
  options: Omit<ConfirmationRequest, "resolve">,
): Promise<boolean> =>
  new Promise((resolve) => {
    if (!showConfirmation) {
      resolve(false);
      return;
    }
    showConfirmation({ ...options, resolve });
  });

export const ConfirmationHost = () => {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const controllerRef = useRef<ReturnType<typeof createConfirmationController> | null>(null);
  const controller = controllerRef.current ?? createConfirmationController(setRequest);
  controllerRef.current = controller;
  useEffect(() => {
    showConfirmation = controller.request;
    return () => {
      controller.dispose();
      showConfirmation = null;
    };
  }, [controller]);
  const settle = (confirmed: boolean) => {
    controllerRef.current?.settle(confirmed);
  };
  if (!request) return null;
  return (
    <ConfirmDialog
      open
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      destructive={request.destructive}
      large={request.large}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
};
