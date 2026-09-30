import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const createBinDir = async (commands: Record<string, string>): Promise<string> => {
  const binDir = await mkdtemp(join(tmpdir(), "aop-install-preflight-bin-"));

  for (const [name, content] of Object.entries(commands)) {
    const path = join(binDir, name);
    await writeFile(path, content);
    await chmod(path, 0o755);
  }

  return binDir;
};

export const unameStub = (os = "Darwin", arch = "arm64"): string => `#!/bin/sh
if [ "$1" = "-s" ]; then
  echo ${os}
else
  echo ${arch}
fi
`;

export const successStub = (): string => `#!/bin/sh
exit 0
`;

export const ghStub = ({ authenticated }: { authenticated: boolean }): string => `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  ${authenticated ? "exit 0" : "exit 1"}
fi
exit 0
`;
