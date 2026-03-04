import { execFile } from "node:child_process";
import { chmod, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export async function runInDefaultTerminal(command: string): Promise<void> {
  const scriptPath = join(tmpdir(), `raycast-artifact-pull-${randomUUID()}`);
  const script = `#!/bin/bash\n${command}\n`;
  await writeFile(scriptPath, script, "utf8");
  await chmod(scriptPath, 0o700);
  await new Promise<void>((resolve, reject) => {
    execFile("open", [scriptPath], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  setTimeout(() => {
    void unlink(scriptPath);
  }, 60_000);
}
