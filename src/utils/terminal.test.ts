import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, writeFileMock, chmodMock, unlinkMock } = vi.hoisted(() => {
  return {
    execFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    chmodMock: vi.fn(),
    unlinkMock: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:fs/promises", () => ({
  writeFile: writeFileMock,
  chmod: chmodMock,
  unlink: unlinkMock,
}));

vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
}));

vi.mock("node:crypto", () => ({
  randomUUID: () => "fixed-uuid",
}));

import { runInDefaultTerminal } from "./terminal";

describe("runInDefaultTerminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeFileMock.mockResolvedValue(undefined);
    chmodMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (error: Error | null) => void) => cb(null));
  });

  it("creates and opens a temporary executable script", async () => {
    await runInDefaultTerminal("echo hello");

    const scriptPath = "/tmp/raycast-artifact-pull-fixed-uuid";
    expect(writeFileMock).toHaveBeenCalledWith(scriptPath, "#!/bin/bash\necho hello\n", "utf8");
    expect(chmodMock).toHaveBeenCalledWith(scriptPath, 0o700);
    expect(execFileMock).toHaveBeenCalledWith("open", [scriptPath], expect.any(Function));
  });

  it("rejects when opening the script fails", async () => {
    execFileMock.mockImplementationOnce((_cmd: string, _args: string[], cb: (error: Error | null) => void) =>
      cb(new Error("open failed")),
    );

    await expect(runInDefaultTerminal("echo hello")).rejects.toThrow("open failed");
  });

  it("removes the temporary script after timeout", async () => {
    vi.useFakeTimers();
    try {
      const runPromise = runInDefaultTerminal("echo hello");
      await runPromise;

      expect(unlinkMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(unlinkMock).toHaveBeenCalledWith("/tmp/raycast-artifact-pull-fixed-uuid");
    } finally {
      vi.useRealTimers();
    }
  });
});
