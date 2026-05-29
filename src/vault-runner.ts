import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { join } from "path";

export type VaultStream = "stdout" | "stderr";
export type VaultRunStatus = "idle" | "running" | "succeeded" | "failed";

export interface VaultRunSpec {
  id: string;
  label: string;
  args: string[];
}

export interface VaultRunStart {
  spec: VaultRunSpec;
  command: string;
  cwd: string;
  startedAt: Date;
}

export interface VaultRunFinish extends VaultRunStart {
  status: Exclude<VaultRunStatus, "idle" | "running">;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  finishedAt: Date;
}

export interface VaultRunEvents {
  onStart: (event: VaultRunStart) => void;
  onOutput: (stream: VaultStream, text: string) => void;
  onFinish: (event: VaultRunFinish) => void;
  onError: (error: Error) => void;
}

export class VaultCommandRunner {
  private child: ChildProcessWithoutNullStreams | null = null;

  get running(): boolean {
    return this.child !== null;
  }

  run(spec: VaultRunSpec, command: string, cwd: string, events: VaultRunEvents): boolean {
    if (this.child) {
      return false;
    }

    const startedAt = new Date();
    const resolvedCommand = command === "vault" ? join(cwd, "master/system/scripts/vault.py") : command;
    events.onStart({ spec, command: resolvedCommand, cwd, startedAt });

    const child = spawn(resolvedCommand, spec.args, {
      cwd,
      env: {
        ...process.env,
        PATH: process.env.PATH
          ? `${process.env.HOME}/.local/bin:${process.env.PATH}`
          : `${process.env.HOME}/.local/bin`,
      },
    });
    this.child = child;

    child.stdout.on("data", (data: Buffer) => events.onOutput("stdout", data.toString()));
    child.stderr.on("data", (data: Buffer) => events.onOutput("stderr", data.toString()));
    child.on("error", (error) => {
      this.child = null;
      events.onError(error);
    });
    child.on("close", (exitCode, signal) => {
      this.child = null;
      events.onFinish({
        spec,
        command: resolvedCommand,
        cwd,
        startedAt,
        status: exitCode === 0 ? "succeeded" : "failed",
        exitCode,
        signal,
        finishedAt: new Date(),
      });
    });

    return true;
  }

  kill(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}
