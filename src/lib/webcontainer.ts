import { WebContainer } from '@webcontainer/api';

let webcontainerInstance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;

export interface SandboxRunResult {
  command: string;
  exitCode: number;
  output: string;
}

function resolveSnippetCommand(language: string, code: string) {
  const normalized = language.trim().toLowerCase();

  if (['bash', 'sh', 'shell', 'zsh'].includes(normalized)) {
    return {
      command: 'sh',
      args: ['-lc', code],
      prettyCommand: 'sh -lc "<inline-script>"',
    };
  }

  if (['javascript', 'js', 'node', 'typescript', 'ts'].includes(normalized)) {
    return {
      command: 'node',
      args: ['--input-type=module', '-e', code],
      prettyCommand: 'node --input-type=module -e "<inline-script>"',
    };
  }

  throw new Error(
    `Unsupported sandbox language "${language}". Vortex currently supports javascript/typescript and bash/sh.`,
  );
}

export async function getWebContainer() {
  if (!webcontainerInstance) {
    if (!bootPromise) {
      bootPromise = WebContainer.boot();
    }
    webcontainerInstance = await bootPromise;
  }
  return webcontainerInstance;
}

export async function runSnippetInSandbox(options: {
  code: string;
  language: string;
}): Promise<SandboxRunResult> {
  const { code, language } = options;
  const wc = await getWebContainer();
  const { command, args, prettyCommand } = resolveSnippetCommand(language, code);
  const process = await wc.spawn(command, args, { output: true });

  let output = '';
  const outputReader = process.output.pipeTo(
    new WritableStream({
      write(chunk) {
        output += chunk;
      },
    }),
  );

  const exitCode = await process.exit;
  await outputReader.catch(() => undefined);

  return {
    command: prettyCommand,
    exitCode,
    output: output.trim(),
  };
}
