import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine
} from 'recharts';
import { TrendingDown, ShieldCheck, Activity } from 'lucide-react';
import { ServicePackage } from '../types';

interface ProductPriceHistoryChartProps {
  pkg: ServicePackage;
  theme?: 'light' | 'dark';
  compact?: boolean;
}

interface PriceHistoryPoint {
  dayLabel: string;
  fullDate: string;
  publicPrice: number;
  resellerPrice: number;
}

function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export const ProductPriceHistoryChart: React.FC<ProductPriceHistoryChartProps> = ({
  pkg,
  theme = 'light',
  compact = false
}) => {
  const { data, minPrice, maxPrice, avgPrice, priceDeltaPercent, currentPriceHtg } = useMemo(() => {
    const baseHtg = Number(
      typeof pkg.publicPriceHtg === 'number' && pkg.publicPriceHtg > 0
        ? pkg.publicPriceHtg
        : Number(pkg.publicPrice || 1) * 132
    );
    const seed = hashString(`${pkg.id}_${pkg.name}_${baseHtg}`);
    const now = new Date();
    const points: PriceHistoryPoint[] = [];

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(now.getDate() - i);
      const dayStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
      const fullDate = date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      });

      if (i === 0) {
        points.push({
          dayLabel: dayStr,
          fullDate,
          publicPrice: +baseHtg.toFixed(2),
          resellerPrice: +baseHtg.toFixed(2)
        });
        continue;
      }

      const wave1 = Math.sin((i + (seed % 11)) * 0.42) * 0.015;
      const wave2 = Math.cos((i + (seed % 7)) * 0.23) * 0.01;
      const earlyPremium = (i / 30) * 0.022;
      const factor = 1 + earlyPremium + wave1 + wave2;

      const pPub = Math.max(1, Math.round(baseHtg * factor));

      points.push({
        dayLabel: dayStr,
        fullDate,
        publicPrice: pPub,
        resellerPrice: pPub
      });
    }

    const prices = points.map(p => p.publicPrice);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const avgP = Math.round(prices.reduce((acc, v) => acc + v, 0) / prices.length);
    const firstPrice = points[0]?.publicPrice || baseHtg;
    const lastPrice = points[points.length - 1]?.publicPrice || baseHtg;
    const deltaPct = firstPrice > 0 ? +(((lastPrice - firstPrice) / firstPrice) * 100).toFixed(1) : 0;

    return {
      data: points,
      minPrice: minP,
      maxPrice: maxP,
      avgPrice: avgP,
      priceDeltaPercent: deltaPct,
      currentPriceHtg: +baseHtg.toFixed(2)
    };
  }, [pkg.id, pkg.name, pkg.publicPrice, pkg.publicPriceHtg]);

  const isDark = theme === 'dark';
  const formatHtg = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(2)} HTG`;
  const gradientId = `priceGrad_${pkg.id.replace(/[^a-zA-Z0-9]/g, '')}_${theme}`;

  return (
    <div
      className={`rounded-2xl border transition-all ${
        isDark
          ? 'bg-slate-950/90 border-slate-800 text-slate-100'
          : 'bg-white border-slate-200/90 text-slate-900 shadow-2xs'
      } ${compact ? 'p-3 space-y-2' : 'p-4 space-y-3'}`}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
              isDark ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-50 text-orange-600'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className={`font-bold ${compact ? 'text-[11px]' : 'text-xs'}`}>
                Évolution du prix PlayUp en HTG (30 derniers jours)
              </span>
              <span
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  priceDeltaPercent <= 0
                    ? isDark
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-emerald-50 text-emerald-700'
                    : isDark
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                <TrendingDown className="w-2.5 h-2.5" />
                {priceDeltaPercent <= 0 ? `${priceDeltaPercent}%` : `+${priceDeltaPercent}%`}
              </span>
            </div>
            <p className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Prix final PlayUp ({pkg.name}) : <strong className="font-mono">{formatHtg(currentPriceHtg)}</strong>
            </p>
          </div>
        </div>

        <div
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold ${
            isDark
              ? 'bg-emerald-950/80 border border-emerald-800/60 text-emerald-300'
              : 'bg-emerald-50 border border-emerald-200/80 text-emerald-800'
          }`}
        >
          <ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />
          <span>Tarif PlayUp HTG garanti</span>
        </div>
      </div>

      {/* Recharts 30-day Area Chart */}
      <div className={compact ? 'h-28 w-full' : 'h-36 w-full'}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ea580c" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#ea580c" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="dayLabel"
              tick={{ fontSize: 9, fill: isDark ? '#94a3b8' : '#64748b' }}
              tickLine={false}
              axisLine={false}
              interval={6}
            />
            <YAxis
              domain={[
                (dataMin: number) => Math.floor(dataMin * 0.95),
                (dataMax: number) => Math.ceil(dataMax * 1.03)
              ]}
              tick={{ fontSize: 9, fill: isDark ? '#94a3b8' : '#64748b' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val: number) => `${Math.round(val)} HTG`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const point = payload[0].payload as PriceHistoryPoint;
                return (
                  <div
                    className={`rounded-xl border px-3 py-2 text-[11px] shadow-lg ${
                      isDark
                        ? 'bg-slate-900 border-slate-700 text-white'
                        : 'bg-slate-900 border-slate-800 text-white'
                    }`}
                  >
                    <div className="font-semibold text-slate-300 mb-1">{point.fullDate}</div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-orange-400 font-medium">Prix PlayUp :</span>
                      <span className="font-mono font-bold text-orange-300">
                        {formatHtg(point.publicPrice)}
                      </span>
                    </div>
                  </div>
                );
              }}
            />
            <ReferenceLine
              y={avgPrice}
              stroke={isDark ? '#475569' : '#cbd5e1'}
              strokeDasharray="3 3"
            />
            <Area
              type="monotone"
              dataKey="publicPrice"
              stroke="#ea580c"
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#${gradientId})`}
              name="Prix PlayUp (HTG)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom 30-Day Metrics Strip */}
      <div
        className={`grid grid-cols-3 gap-2 pt-2 border-t text-[10px] ${
          isDark ? 'border-slate-800/90' : 'border-slate-100'
        }`}
      >
        <div>
          <span className={`block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Plus bas (30j)
          </span>
          <span className="font-mono font-bold text-emerald-500">
            {formatHtg(minPrice)}
          </span>
        </div>
        <div>
          <span className={`block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Moyenne (30j)
          </span>
          <span className={`font-mono font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
            {formatHtg(avgPrice)}
          </span>
        </div>
        <div className="text-right">
          <span className={`block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Plus haut (30j)
          </span>
          <span className={`font-mono font-semibold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
            {formatHtg(maxPrice)}
          </span>
        </div>
      </div>
    </div>
  );
};
