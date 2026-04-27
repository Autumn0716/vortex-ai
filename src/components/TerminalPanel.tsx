import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { getWebContainer } from '../lib/webcontainer';
import { X, Terminal as TerminalIcon } from 'lucide-react';
import {
  WEB_RUNTIME_CAPABILITIES,
  type RuntimeCapabilityProfile,
} from '../lib/runtime-capabilities';

export const TerminalPanel = ({
  onClose,
  runtimeCapabilities = WEB_RUNTIME_CAPABILITIES,
}: {
  onClose: () => void;
  runtimeCapabilities?: RuntimeCapabilityProfile;
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [isBooting, setIsBooting] = useState(true);

  useEffect(() => {
    if (!runtimeCapabilities.sandbox.webContainer) {
      setIsBooting(false);
      return;
    }

    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#05050A',
        foreground: '#ffffff',
        cursor: '#8b5cf6',
        selectionBackground: 'rgba(139, 92, 246, 0.3)',
      },
      fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    
    // Use a small timeout to ensure the DOM is fully rendered before fitting
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch (e) {
        console.warn('Initial terminal fit failed', e);
      }
    }, 10);

    let shellProcess: any;

    const init = async () => {
      term.writeln('\x1b[34m[Vortex OS]\x1b[0m Booting WebContainer sandbox...');
      try {
        const wc = await getWebContainer();
        setIsBooting(false);
        term.writeln('\x1b[32m[Success]\x1b[0m WebContainer booted successfully.');
        term.writeln('\x1b[34m[Vortex OS]\x1b[0m Starting shell environment...\r\n');

        shellProcess = await wc.spawn('jsh', {
          terminal: {
            cols: term.cols,
            rows: term.rows,
          },
        });

        shellProcess.output.pipeTo(
          new WritableStream({
            write(data) {
              term.write(data);
            },
          })
        );

        const input = shellProcess.input.getWriter();
        term.onData((data) => {
          input.write(data);
        });

      } catch (err) {
        term.writeln(`\r\n\x1b[31m[Error]\x1b[0m Failed to boot WebContainer: ${err}`);
        setIsBooting(false);
      }
    };

    init();

    const handleResize = () => {
      try {
        fitAddon.fit();
        if (shellProcess) {
          shellProcess.resize({
            cols: term.cols,
            rows: term.rows,
          });
        }
      } catch (e) {
        // Ignore fit errors when container is hidden or resizing
      }
    };

    window.addEventListener('resize', handleResize);
    
    // Also observe the container itself for size changes
    const resizeObserver = new ResizeObserver(handleResize);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      term.dispose();
      if (shellProcess) {
        shellProcess.kill();
      }
    };
  }, [runtimeCapabilities.sandbox.webContainer]);

  return (
    <div className="flex flex-col h-full bg-[var(--app-bg-modal-side)] border-l border-white/[0.06] w-80 md:w-[400px] flex-shrink-0 z-20" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
      <div className="h-12 border-b border-white/[0.06] flex items-center justify-between px-4 bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <TerminalIcon size={15} strokeWidth={1.5} className="text-gray-500" />
          <div>
            <span className="text-[13px] font-semibold text-gray-900">WebContainer</span>
            <div className="text-[10px] text-gray-500">
              {runtimeCapabilities.sandbox.hostShell
                ? 'Host shell'
                : 'Sandbox'}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/[0.06] text-gray-400 hover:text-gray-600 transition-colors">
          <X size={15} />
        </button>
      </div>
      <div className="flex-1 p-2 relative">
        {!runtimeCapabilities.sandbox.webContainer ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-black/[0.06] bg-white p-6 text-center">
            <div>
              <div className="text-sm font-semibold text-gray-900">Sandbox unavailable</div>
              <div className="mt-2 max-w-[28ch] text-xs leading-6 text-gray-500">
                This runtime has disabled WebContainer execution.
              </div>
            </div>
          </div>
        ) : null}
        {isBooting && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-5 h-5 border-2 border-[#FF2D78] border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs text-gray-500 font-mono">Initializing...</span>
            </div>
          </div>
        )}
        {runtimeCapabilities.sandbox.webContainer ? <div ref={terminalRef} className="w-full h-full" /> : null}
      </div>
    </div>
  );
};
