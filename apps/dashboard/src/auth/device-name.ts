/** A name the host owner will recognise in the device list, e.g. "Chrome on macOS". */
export const defaultDeviceName = (userAgent: string = navigator.userAgent): string => {
  if (/Electron\//.test(userAgent)) return `AOP Desktop on ${osName(userAgent)}`;
  return `${browserName(userAgent)} on ${osName(userAgent)}`;
};

const osName = (userAgent: string): string => {
  if (/Windows/.test(userAgent)) return "Windows";
  if (/iPhone|iPad/.test(userAgent)) return "iOS";
  if (/Android/.test(userAgent)) return "Android";
  if (/Mac OS X|Macintosh/.test(userAgent)) return "macOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return "an unknown system";
};

// Order matters: Edge and Chrome both say "Chrome", and Chrome also says "Safari".
const browserName = (userAgent: string): string => {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "Browser";
};
