import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { getWebContainer } from '../lib/webcontainer';
import { X, Terminal as TerminalIcon } from 'lucide-react';

export const TerminalPanel = ({ onClose }: { onClose: () => void }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [isBooting, setIsBooting] = useState(true);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#05050A',
        foreground: '#ffffff',
        cursor: '#8b5cf6',
        selectionBackground: 'rgba(139, 92, 246, 0.3)',
      },
      fontFamily: '"JetBrains Mono", monospace',
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
      term.writeln('\x1b[34m[FlowAgent OS]\x1b[0m Booting WebContainer sandbox...');
      try {
        const wc = await getWebContainer();
        setIsBooting(false);
        term.writeln('\x1b[32m[Success]\x1b[0m WebContainer booted successfully.');
        term.writeln('\x1b[34m[FlowAgent OS]\x1b[0m Starting shell environment...\r\n');

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
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#05050A] border-l border-white/10 w-80 md:w-[400px] flex-shrink-0 shadow-2xl z-20">
      <div className="h-14 border-b border-white/10 flex items-center justify-between px-4 bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <TerminalIcon size={16} className="text-blue-400" />
          <span className="text-sm font-semibold tracking-tight">WebContainer Sandbox</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 p-2 relative">
        {isBooting && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#05050A]/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs text-blue-400 font-mono">Initializing Sandbox...</span>
            </div>
          </div>
        )}
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  );
};
