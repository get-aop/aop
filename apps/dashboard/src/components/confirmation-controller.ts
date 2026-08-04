export interface ConfirmationRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Wider panel for long / high-risk warnings. */
  large?: boolean;
  resolve: (confirmed: boolean) => void;
}

export const createConfirmationController = (
  show: (request: ConfirmationRequest | null) => void,
) => {
  let pending: ConfirmationRequest | null = null;
  return {
    request: (request: ConfirmationRequest) => {
      pending?.resolve(false);
      pending = request;
      show(request);
    },
    settle: (confirmed: boolean) => {
      pending?.resolve(confirmed);
      pending = null;
      show(null);
    },
    dispose: () => {
      pending?.resolve(false);
      pending = null;
    },
  };
};
