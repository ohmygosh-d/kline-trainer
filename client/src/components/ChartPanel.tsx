import { forwardRef } from 'react';

export const ChartPanel = forwardRef<HTMLDivElement>((_props, ref) => {
  return (
    <div ref={ref} className="flex-1 relative bg-slate-50 rounded-lg overflow-hidden border border-slate-200">
      <div className="absolute inset-0 flex flex-col">
        <div className="flex-1 relative">
          <canvas id="kline-canvas" className="absolute inset-0" />
          <canvas id="crosshair" className="absolute inset-0 pointer-events-none" />
        </div>
        <div className="h-16 relative border-t border-slate-200">
          <canvas id="vol-canvas" className="absolute inset-0" />
        </div>
        <div className="h-20 relative border-t border-slate-200">
          <canvas id="macd-canvas" className="absolute inset-0" />
          <canvas id="kdj-canvas" className="absolute inset-0" />
          <canvas id="rsi-canvas" className="absolute inset-0" />
        </div>
      </div>
    </div>
  );
});
ChartPanel.displayName = 'ChartPanel';
