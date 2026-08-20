import { forwardRef } from 'react';

export const ChartPanel = forwardRef<HTMLDivElement>((_props, ref) => {
  return (
    <div ref={ref} className="flex-1 min-h-0 relative bg-slate-50 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      <div className="absolute inset-0 flex flex-col">
        {/* 主图 K线 —— flex-1 填满剩余高度（经过验证的可靠结构） */}
        <div className="flex-1 min-h-0 relative">
          <canvas id="kline-canvas" className="absolute inset-0 w-full h-full" />
          <canvas id="crosshair" className="absolute inset-0 w-full h-full pointer-events-none" />
        </div>
        {/* 成交量 */}
        <div data-row="vol" className="h-[68px] flex-shrink-0 relative border-t border-slate-200">
          <canvas id="vol-canvas" className="absolute inset-0 w-full h-full" />
        </div>
        {/* MACD */}
        <div data-row="macd" className="h-[68px] flex-shrink-0 relative border-t border-slate-200">
          <canvas id="macd-canvas" className="absolute inset-0 w-full h-full" />
        </div>
        {/* KDJ */}
        <div data-row="kdj" className="h-[68px] flex-shrink-0 relative border-t border-slate-200">
          <canvas id="kdj-canvas" className="absolute inset-0 w-full h-full" />
        </div>
        {/* RSI */}
        <div data-row="rsi" className="h-[68px] flex-shrink-0 relative border-t border-slate-200">
          <canvas id="rsi-canvas" className="absolute inset-0 w-full h-full" />
        </div>
      </div>
    </div>
  );
});
ChartPanel.displayName = 'ChartPanel';
