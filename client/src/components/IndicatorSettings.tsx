import { useState, useEffect } from 'react';
import type { ChartOptions, MALine } from '../lib/chart';

interface Props {
  options: ChartOptions;
  onChange: (opts: ChartOptions) => void;
  onClose: () => void;
}

const PRESET_COLORS = ['#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#10b981', '#ec4899', '#6366f1', '#14b8a6'];

function Section({ title, enabled, onToggle, children }: { title: string; enabled: boolean; onToggle: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
        <span className="font-semibold text-slate-700">{title}</span>
        <label className="inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => onToggle(e.target.checked)} className="sr-only peer" />
          <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-pink-500 relative" />
        </label>
      </div>
      {enabled && <div className="p-4 space-y-3">{children}</div>}
    </div>
  );
}

function MAListEditor({ label, lines, onChange }: { label: string; lines: MALine[]; onChange: (lines: MALine[]) => void }) {
  const update = (i: number, patch: Partial<MALine>) => {
    const next = lines.map((m, idx) => idx === i ? { ...m, ...patch } : m);
    onChange(next);
  };
  const remove = (i: number) => onChange(lines.filter((_, idx) => idx !== i));
  const add = () => {
    const color = PRESET_COLORS[lines.length % PRESET_COLORS.length];
    onChange([...lines, { period: 20, color, width: 1.2 }]);
  };
  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-400">{label}</div>
      {lines.map((m, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-slate-500 w-6">{i + 1}</span>
          <div className="flex-1">
            <label className="text-[10px] text-slate-400 block">周期</label>
            <input
              type="number" min={1} max={300} value={m.period}
              onChange={e => update(i, { period: parseInt(e.target.value || '1', 10) })}
              className="w-full px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none focus:border-pink-400"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-400 block">颜色</label>
            <div className="flex items-center gap-1">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => update(i, { color: c })}
                  className={`w-5 h-5 rounded-full border-2 ${m.color === c ? 'border-slate-800' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="w-16">
            <label className="text-[10px] text-slate-400 block">粗细</label>
            <input
              type="number" min={0.5} max={4} step={0.1} value={m.width}
              onChange={e => update(i, { width: parseFloat(e.target.value || '1') })}
              className="w-full px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none focus:border-pink-400"
            />
          </div>
          <button onClick={() => remove(i)} className="text-xs text-red-400 hover:text-red-600 px-1">删除</button>
        </div>
      ))}
      <button onClick={add} className="text-xs px-3 py-1.5 rounded-lg bg-pink-500 text-white hover:bg-pink-600 transition">添加线</button>
    </div>
  );
}

function NumberInput({ label, value, onChange, min = 1, max = 300 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      <input
        type="number" min={min} max={max} value={value}
        onChange={e => onChange(parseInt(e.target.value || '1', 10))}
        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:border-pink-400"
      />
    </div>
  );
}

export function IndicatorSettings({ options, onChange, onClose }: Props) {
  const [opts, setOpts] = useState<ChartOptions>(JSON.parse(JSON.stringify(options)));
  const patch = (p: Partial<ChartOptions>) => setOpts(prev => ({ ...prev, ...p }));

  // ESC 关闭
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const apply = () => {
    onChange(opts);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col m-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">K线设置</h3>
          <button onClick={onClose} className="text-sm px-3 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">关闭</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {/* 主图指标 */}
          <Section title="MA 均线" enabled={opts.showMA} onToggle={v => patch({ showMA: v })}>
            <MAListEditor label="MA 线列表" lines={opts.ma} onChange={ma => patch({ ma })} />
          </Section>
          <Section title="EMA 均线" enabled={opts.showEMA} onToggle={v => patch({ showEMA: v })}>
            <MAListEditor label="EMA 线列表" lines={opts.ema} onChange={ema => patch({ ema })} />
          </Section>
          <Section title="BOLL 布林带" enabled={opts.showBOLL} onToggle={v => patch({ showBOLL: v })}>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="周期" value={opts.boll.period} onChange={v => patch({ boll: { ...opts.boll, period: v } })} />
              <NumberInput label="倍数" value={opts.boll.mult} onChange={v => patch({ boll: { ...opts.boll, mult: v } })} max={10} />
            </div>
          </Section>

          {/* 副图指标 */}
          <Section title="VOL 成交量" enabled={opts.showVol} onToggle={v => patch({ showVol: v })}>
            <div>
              <label className="text-xs text-slate-500 block mb-1">均量周期（逗号分隔）</label>
              <input
                type="text" value={opts.volMA.join(',')}
                onChange={e => {
                  const arr = e.target.value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
                  patch({ volMA: arr });
                }}
                className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:border-pink-400"
              />
            </div>
          </Section>
          <Section title="MACD" enabled={opts.showMACD} onToggle={v => patch({ showMACD: v })}>
            <div className="grid grid-cols-3 gap-3">
              <NumberInput label="快线" value={opts.macd.fast} onChange={v => patch({ macd: { ...opts.macd, fast: v } })} />
              <NumberInput label="慢线" value={opts.macd.slow} onChange={v => patch({ macd: { ...opts.macd, slow: v } })} />
              <NumberInput label="信号" value={opts.macd.signal} onChange={v => patch({ macd: { ...opts.macd, signal: v } })} />
            </div>
          </Section>
          <Section title="KDJ" enabled={opts.showKDJ} onToggle={v => patch({ showKDJ: v })}>
            <NumberInput label="N 周期" value={opts.kdj.n} onChange={v => patch({ kdj: { ...opts.kdj, n: v } })} />
          </Section>
          <Section title="RSI" enabled={opts.showRSI} onToggle={v => patch({ showRSI: v })}>
            <NumberInput label="周期" value={opts.rsi.period} onChange={v => patch({ rsi: { ...opts.rsi, period: v } })} />
          </Section>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-5 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition">取消</button>
          <button onClick={apply} className="px-5 py-2 rounded-xl bg-pink-500 text-white font-semibold hover:bg-pink-600 transition">确定</button>
        </div>
      </div>
    </div>
  );
}
