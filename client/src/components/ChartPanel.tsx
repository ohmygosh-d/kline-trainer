import { forwardRef } from 'react';

export const ChartPanel = forwardRef<HTMLDivElement>((_props, ref) => {
  return (
    <div ref={ref} className="flex-1 relative bg-slate-50 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      <div className="absolute inset-0 flex flex-col">
        {/* 主图 K线 */}
        <div className="flex-1 relative min-h-0">
          <canvas id="kline-canvas" className="absolute inset-0" />
          <canvas id="crosshair" className="absolute inset-0 pointer-events-none" />
        </div>
        {/* 成交量 */}
        <div data-row="vol" className="h-[68px] relative border-t border-slate-200 bg-slate-50/60">
          <canvas id="vol-canvas" className="absolute inset-0" />
        </div>
        {/* MACD */}
        <div data-row="macd" className="h-[68px] relative border-t border-slate-200 bg-slate-50/60">
          <canvas id="macd-canvas" className="absolute inset-0" />
        </div>
        {/* KDJ */}
        <div data-row="kdj" className="h-[68px] relative border-t border-slate-200 bg-slate-50/60">
          <canvas id="kdj-canvas" className="absolute inset-0" />
        </div>
        {/* RSI */}
        <div data-row="rsi" className="h-[68px] relative border-t border-slate-200 bg-slate-50/60">
          <canvas id="rsi-canvas" className="absolute inset-0" />
        </div>
      </div>
    </div>
  );
});
ChartPanel.displayName = 'ChartPanel';
