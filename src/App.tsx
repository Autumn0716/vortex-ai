/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { 
  Bot, 
  Cpu, 
  Database, 
  Globe, 
  Layers, 
  MessageSquare, 
  Zap, 
  ChevronRight,
  Github,
  Terminal,
  Workflow
} from 'lucide-react';
import { FlowingPixels } from './components/FlowingPixels';
import { ChatInterface } from './components/ChatInterface';
import { cn } from './lib/utils';
import { getAgentConfig } from './lib/agent/config';
import { applyThemePreferences } from './lib/theme';

const FeatureCard = ({ icon: Icon, title, description }: { icon: any, title: string, description: string }) => (
  <motion.div 
    whileHover={{ y: -5 }}
    className="glass p-8 rounded-2xl flex flex-col gap-4 group transition-all hover:border-violet-500/50"
  >
    <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:bg-gradient-brand group-hover:text-white transition-colors">
      <Icon size={24} />
    </div>
    <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
    <p className="text-white/60 leading-relaxed">{description}</p>
  </motion.div>
);

export default function App() {
  const [currentView, setCurrentView] = useState<'landing' | 'chat'>('landing');

  useEffect(() => {
    getAgentConfig()
      .then((config) => applyThemePreferences(config))
      .catch(console.error);
  }, []);

  if (currentView === 'chat') {
    return (
      <div className="app-shell relative min-h-screen overflow-hidden">
        {/* Keep the flowing pixels as a subtle background in the chat too */}
        <div className="absolute inset-0 opacity-30 pointer-events-none">
          <FlowingPixels />
        </div>
        <ChatInterface onBack={() => setCurrentView('landing')} />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <FlowingPixels />
      
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 px-6 py-4 flex justify-between items-center glass border-b-0 bg-black/20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-brand rounded-lg flex items-center justify-center">
            <Zap size={18} className="text-white fill-current" />
          </div>
          <span className="text-xl font-bold tracking-tighter">FLOWAGENT</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-white/70">
          <a href="#" className="hover:text-blue-400 transition-colors">Models</a>
          <a href="#" className="hover:text-blue-400 transition-colors">Agents</a>
          <a href="#" className="hover:text-blue-400 transition-colors">Runtime</a>
          <a href="#" className="hover:text-blue-400 transition-colors">Docs</a>
        </div>
        <div className="flex items-center gap-4">
          <button className="px-4 py-2 text-sm font-medium hover:text-blue-400 transition-colors">Login</button>
          <button 
            onClick={() => setCurrentView('chat')}
            className="px-5 py-2 bg-gradient-brand text-white text-sm font-bold rounded-full hover:opacity-90 transition-all shadow-[0_0_20px_rgba(139,92,246,0.3)]"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6 max-w-7xl mx-auto flex flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-mono font-bold mb-8"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
          V1.0 NOW IN BETA
        </motion.div>
        
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-5xl md:text-8xl font-bold tracking-tighter mb-8 leading-[0.9]"
        >
          ORCHESTRATE <br />
          <span className="text-gradient text-glow">INTELLIGENCE</span>
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="text-lg md:text-xl text-white/60 max-w-2xl mb-12"
        >
          The ultimate multi-platform agent orchestration layer. Build, deploy, and scale 
          autonomous agents with LangGraph and persistent memory.
        </motion.p>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="flex flex-col sm:flex-row gap-4"
        >
          <button 
            onClick={() => setCurrentView('chat')}
            className="px-8 py-4 bg-gradient-brand text-white font-bold rounded-full flex items-center gap-2 hover:scale-105 transition-all shadow-[0_0_30px_rgba(139,92,246,0.4)]"
          >
            Build Your Agent <ChevronRight size={20} />
          </button>
          <button className="px-8 py-4 glass rounded-full font-bold flex items-center gap-2 hover:bg-white/10 transition-all">
            <Github size={20} /> View on GitHub
          </button>
        </motion.div>

        {/* Dashboard Preview */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="mt-24 w-full max-w-5xl glass rounded-3xl p-4 shadow-2xl relative"
        >
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-1/2 h-24 bg-violet-500/20 blur-[100px] -z-10"></div>
          <div className="rounded-2xl overflow-hidden border border-white/10 bg-black/40 aspect-video flex">
            {/* Mock Sidebar */}
            <div className="w-16 border-r border-white/10 flex flex-col items-center py-6 gap-6">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400"><Layers size={20} /></div>
              <div className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center text-white/40"><MessageSquare size={20} /></div>
              <div className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center text-white/40"><Workflow size={20} /></div>
              <div className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center text-white/40"><Database size={20} /></div>
            </div>
            {/* Mock Content */}
            <div className="flex-1 flex flex-col bg-[#05050A]">
              {/* Header */}
              <div className="h-16 border-b border-white/10 flex justify-between items-center px-6">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                  <h2 className="text-sm font-semibold tracking-tight">Research Agent</h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">GPT-4o</span>
                </div>
                <div className="flex gap-2">
                  <div className="px-3 py-1.5 rounded-md bg-white/5 text-xs border border-white/10 hover:bg-white/10 transition-colors cursor-pointer">Settings</div>
                  <div className="px-3 py-1.5 rounded-md bg-gradient-brand text-white text-xs font-medium shadow-[0_0_10px_rgba(139,92,246,0.3)] cursor-pointer">Deploy</div>
                </div>
              </div>
              
              {/* Chat/Workflow Area */}
              <div className="flex-1 p-6 flex flex-col gap-6 overflow-hidden relative">
                {/* User Message */}
                <div className="flex gap-4 items-start max-w-2xl mx-auto w-full">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex-shrink-0"></div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm p-4 text-sm text-white/80 leading-relaxed">
                    Analyze the latest trends in autonomous AI agents and summarize the key frameworks being used in 2026.
                  </div>
                </div>
                
                {/* Agent Response */}
                <div className="flex gap-4 items-start max-w-2xl mx-auto w-full">
                  <div className="w-8 h-8 rounded-full bg-gradient-brand flex-shrink-0 flex items-center justify-center">
                    <Bot size={16} className="text-white" />
                  </div>
                  <div className="flex-1 space-y-4">
                    {/* Tool execution step */}
                    <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/5 border border-blue-500/10 rounded-lg p-2 w-fit">
                      <Globe size={14} className="animate-spin-slow" />
                      <span>Searching web for "autonomous AI agent frameworks 2026"...</span>
                    </div>
                    
                    {/* Response content */}
                    <div className="bg-transparent rounded-2xl p-0 text-sm text-white/90 leading-relaxed space-y-3">
                      <p>Based on current trends in 2026, the landscape of autonomous AI agents is dominated by several key frameworks that emphasize persistent memory, multi-agent orchestration, and tool use:</p>
                      <ul className="space-y-2 pl-4 border-l-2 border-violet-500/30">
                        <li><strong className="text-white">LangGraph:</strong> Remains the standard for stateful, multi-actor applications.</li>
                        <li><strong className="text-white">AutoGPT v3:</strong> Highly adopted for general-purpose task execution.</li>
                        <li><strong className="text-white">CrewAI:</strong> Popular for role-playing multi-agent systems.</li>
                      </ul>
                      <div className="flex items-center gap-1 text-violet-400 text-xs mt-2">
                        <span className="w-1.5 h-4 bg-violet-400 animate-pulse"></span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Input Area */}
              <div className="p-4 border-t border-white/10 bg-black/20">
                <div className="max-w-3xl mx-auto relative">
                  <input 
                    type="text" 
                    placeholder="Message Research Agent..." 
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-4 pr-12 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500/50 transition-colors"
                    readOnly
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                    <div className="w-3 h-3 border-t-2 border-r-2 border-white/50 transform rotate-45 -translate-x-0.5"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Features Grid */}
      <section className="py-24 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
            ENGINEERED FOR <span className="text-gradient">SCALE</span>
          </h2>
          <p className="text-white/40">Everything you need to build production-ready AI agents.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <FeatureCard 
            icon={Globe} 
            title="Multi-Platform" 
            description="Connect to OpenAI, Anthropic, Google, and local Ollama instances seamlessly."
          />
          <FeatureCard 
            icon={Workflow} 
            title="LangGraph Core" 
            description="Build complex stateful workflows with the power of LangGraph and LangChain."
          />
          <FeatureCard 
            icon={Database} 
            title="Persistent Memory" 
            description="Long-term memory storage for agents to remember context across sessions."
          />
          <FeatureCard 
            icon={Terminal} 
            title="Agent Runtime" 
            description="A robust runtime environment to execute and monitor your agents in real-time."
          />
          <FeatureCard 
            icon={Layers} 
            title="Channel Integration" 
            description="Interact with your agents via Web, Discord, Slack, or custom API endpoints."
          />
          <FeatureCard 
            icon={Bot} 
            title="Open Source" 
            description="Easily integrate other open-source projects and custom tools into your agents."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-white/10 glass">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-brand rounded flex items-center justify-center">
              <Zap size={14} className="text-white fill-current" />
            </div>
            <span className="font-bold tracking-tighter">FLOWAGENT</span>
          </div>
          <div className="flex gap-8 text-sm text-white/40">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Twitter</a>
            <a href="#" className="hover:text-white transition-colors">Discord</a>
          </div>
          <p className="text-xs text-white/20">© 2026 FlowAgent AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

