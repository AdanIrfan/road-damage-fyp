import { createInterface } from "node:readline";

/** Thrown when input ends early or the user presses Ctrl+C. Its message is safe to print. */
export class PromptError extends Error {}

export interface Prompter {
  /** Reads one line. When `hidden`, typed characters are not echoed. */
  ask: (question: string, hidden?: boolean) => Promise<string>;
  close: () => void;
}

/**
 * Prompter for CLI scripts.
 * Interactive terminal: reads keystrokes in raw mode so hidden input (passwords) is never echoed.
 * Piped input (non-TTY): reads lines in order through readline's buffered async iterator.
 */
export function createTerminalPrompter(): Prompter {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, terminal: false });
    const lines = rl[Symbol.asyncIterator]();
    return {
      ask: async (question) => {
        process.stdout.write(question);
        const next = await lines.next();
        process.stdout.write("\n");
        if (next.done === true) {
          throw new PromptError("Input ended before all questions were answered.");
        }
        return next.value;
      },
      close: () => rl.close(),
    };
  }

  const stdin = process.stdin;
  return {
    ask: (question, hidden = false) =>
      new Promise<string>((resolve, reject) => {
        process.stdout.write(question);
        let value = "";
        const finish = (): void => {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
        };
        const onData = (chunk: string): void => {
          for (const char of chunk) {
            if (char === "\r" || char === "\n") {
              finish();
              resolve(value);
              return;
            }
            if (char === "\u0003") {
              finish();
              reject(new PromptError("Cancelled."));
              return;
            }
            if (char === "\u007f" || char === "\b") {
              if (value.length > 0) {
                value = value.slice(0, -1);
                if (!hidden) process.stdout.write("\b \b");
              }
              continue;
            }
            value += char;
            if (!hidden) process.stdout.write(char);
          }
        };
        stdin.setRawMode(true);
        stdin.setEncoding("utf8");
        stdin.resume();
        stdin.on("data", onData);
      }),
    close: () => undefined,
  };
}
