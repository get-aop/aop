import { describe, expect, test } from "bun:test";
import {
  bashSingleQuote,
  decodeWslOutput,
  formatExecHost,
  listDesktopWslDistros,
  parseExecHost,
  parseWslListVerbose,
  resolveWindowsExecHost,
  shellJoin,
  wslBashScriptArgv,
  wslRunnerArgv,
} from "./wsl";

describe("Electron WSL host support", () => {
  test("decodes UTF-8 and UTF-16LE output", () => {
    const text = "Ubuntu Running 2";
    const utf16 = Buffer.from(`\ufeff${text}`, "utf16le");

    expect(decodeWslOutput(Buffer.from(text))).toBe(text);
    expect(decodeWslOutput(utf16)).toBe(text);
  });

  test("parses WSL2 distros without relying on localized headers", () => {
    const text = [
      "  NAME            STATE           VERSION",
      "* Ubuntu          Running         2",
      "  Debian          Stopped         2",
      "  docker-desktop  Stopped         2",
      "  Legacy          Running         1",
    ].join("\n");

    expect(parseWslListVerbose(text)).toEqual([
      { name: "Ubuntu", isDefault: true, running: true, version: 2 },
      { name: "Debian", isDefault: false, running: false, version: 2 },
    ]);
  });

  test("quotes commands crossing the WSL command-line boundary", () => {
    expect(bashSingleQuote("it's")).toBe("'it'\\''s'");
    expect(shellJoin("gh", ["auth", "status"])).toBe("'gh' 'auth' 'status'");

    const encoded = wslBashScriptArgv("Ubuntu", 'runtime="$HOME/aop"');
    expect(encoded.slice(0, 5)).toEqual(["-d", "Ubuntu", "--", "bash", "-lc"]);
    expect(encoded[5]).not.toContain("$HOME");
    expect(encoded[5]).toContain("base64 -d | bash");
  });

  test("adds common Linux user bins while dropping Windows environment values", () => {
    const argv = wslRunnerArgv("Ubuntu", {
      program: "pi",
      args: ["--version"],
      env: { PATH: "C:\\Windows" },
    });

    expect(argv[5]).toContain("$HOME/.opencode/bin");
    expect(argv[5]).toContain("$HOME/.npm-global/bin");
    expect(argv[5]).not.toContain("C:\\Windows");
    expect(argv[5]).toEndWith("exec 'pi' '--version'");
  });

  test("keeps a selected distro or chooses the default", () => {
    const distros = [
      { name: "Ubuntu", isDefault: true, running: true, version: 2 },
      { name: "Debian", isDefault: false, running: false, version: 2 },
    ];

    expect(resolveWindowsExecHost({ kind: "wsl", distro: "Debian" }, distros)).toEqual({
      kind: "wsl",
      distro: "Debian",
    });
    expect(resolveWindowsExecHost({ kind: "native" }, distros)).toEqual({
      kind: "wsl",
      distro: "Ubuntu",
    });
    expect(resolveWindowsExecHost({ kind: "native" }, [])).toBeNull();
    expect(formatExecHost(parseExecHost("wsl:Ubuntu"))).toBe("wsl:Ubuntu");
    expect(formatExecHost(parseExecHost("wsl:"))).toBe("native");
  });

  test("probes WSL only on Windows", async () => {
    let calls = 0;
    const list = async () => {
      calls += 1;
      return [{ name: "Ubuntu", isDefault: true, running: true, version: 2 }];
    };

    await expect(listDesktopWslDistros("unix", list)).resolves.toEqual([]);
    await expect(listDesktopWslDistros("windows", list)).resolves.toHaveLength(1);
    expect(calls).toBe(1);
  });
});
