import React from 'react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('FlowAgent render error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error, errorInfo } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="app-shell flex min-h-screen items-center justify-center bg-[#05050A] px-6 py-10 text-white">
        <div className="w-full max-w-4xl rounded-3xl border border-rose-500/20 bg-white/5 p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-rose-300/80">
                Frontend Runtime Error
              </div>
              <h1 className="mt-2 text-2xl font-semibold text-white">页面渲染失败</h1>
              <p className="mt-2 text-sm leading-6 text-white/70">
                FlowAgent 前端在渲染阶段抛出了异常。下面是原始错误信息和组件堆栈。
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
            >
              刷新页面
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
                Error
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-rose-100">
                {error.name}: {error.message}
                {error.stack ? `\n\n${error.stack}` : ''}
              </pre>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
                Component Stack
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-white/75">
                {errorInfo?.componentStack?.trim() || 'No component stack available.'}
              </pre>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
