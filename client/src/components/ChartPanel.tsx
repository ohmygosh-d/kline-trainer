import { forwardRef } from 'react';

export const ChartPanel = forwardRef<HTMLDivElement>((_props, ref) => {
  return (
    <div ref={ref} data-chart-panel="1" className="flex-1 min-h-0 relative bg-white rounded-xl overflow-hidden border border-slate-100 shadow-sm">
      <div data-chart-inner="1" className="absolute inset-0 flex flex-col">
        {/* 主图 K线 */}
        <div className="flex-1 min-h-0 relative">
          <canvas id="kline-canvas" className="absolute inset-0 w-full h-full" />
          <canvas id="crosshair" className="absolute inset-0 w-full h-full pointer-events-none" />
        </div>
        {/* 成交量 */}
        <div data-row="vol" className="h-[88px] flex-shrink-0 relative border-t border-slate-100">
          <canvas id="vol-canvas" className="absolute inset-0 w-full h-full" />
        </div>
        {/* MACD */}
        <div data-row="macd" className="h-[88px] flex-shrink-0 relative border-t border-slate-100">
          <canvas id="macd-canvas" className="absolute inset-0 w-full h-full" />
        </div>
        {/* KDJ / RSI 占位（默认隐藏，由指标设置控制） */}
        <div data-row="kdj" className="h-[88px] flex-shrink-0 relative border-t border-slate-100 hidden">
          <canvas id="kdj-canvas" className="absolute inset-0 w-full h-full" />
        </div>
        <div data-row="rsi" className="h-[88px] flex-shrink-0 relative border-t border-slate-100 hidden">
          <canvas id="rsi-canvas" className="absolute inset-0 w-full h-full" />
        </div>
      </div>
    </div>
  );
});
ChartPanel.displayName = 'ChartPanel';
