/**
 * The page the person's browser lands on after Slack's "Allow": it says whether AOP is connected
 * and sends them back to AOP, where Settings › Connections › Slack goes on to the test.
 */
export const signInPage = (error: string | null): string => {
  const title = error === null ? "Slack is connected" : "Slack is not connected";
  const body =
    error === null
      ? "AOP now reads your Slack. Close this tab and go back to AOP to test the connection."
      : `${escapeHtml(error)} Go back to AOP settings › Connections › Slack and try again.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · AOP</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f1012;
    color: #e8e8ea; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 420px; padding: 24px; border: 1px solid #2a2b30; border-radius: 12px;
    background: #17181b; }
  h1 { margin: 0 0 8px; font-size: 17px; color: ${error === null ? "#4cc38a" : "#f0574f"}; }
  p { margin: 0; color: #a9aab0; }
</style>
</head>
<body><main data-testid="slack-sign-in-result"><h1>${title}</h1><p>${body}</p></main></body>
</html>`;
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
