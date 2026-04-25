import React, { useEffect, useMemo, useState } from 'react';

import type { ResolvedTeamMember } from '@shared/types/team';

import { LiquidGlass } from '../LiquidGlass';

// Public CoinGecko Simple Price endpoint — no auth, free tier is generous
// enough for a polling demo (one call every 30s).
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=solana,jupiter-exchange-solana,bonk,dogwifcoin,raydium&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true';

interface PriceTick {
  symbol: string;
  name: string;
  cgId: string;
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
}

const TRACKED_TOKENS: { cgId: string; symbol: string; name: string }[] = [
  { cgId: 'solana', symbol: 'SOL', name: 'Solana' },
  { cgId: 'jupiter-exchange-solana', symbol: 'JUP', name: 'Jupiter' },
  { cgId: 'raydium', symbol: 'RAY', name: 'Raydium' },
  { cgId: 'bonk', symbol: 'BONK', name: 'Bonk' },
  { cgId: 'dogwifcoin', symbol: 'WIF', name: 'dogwifhat' },
];

export const TRADERS_TEAM_MEMBERS = ['satoshi', 'vitalik', 'hayek', 'taleb'] as const;

export function isTradersTeam(teamName: string | null, members: ResolvedTeamMember[]): boolean {
  if (teamName?.toLowerCase().includes('trader')) return true;
  const names = new Set(members.map((m) => m.name?.toLowerCase()));
  let hits = 0;
  for (const trader of TRADERS_TEAM_MEMBERS) {
    if (names.has(trader)) hits += 1;
  }
  return hits >= 2;
}

function formatUsd(value: number | null | undefined, opts?: { compact?: boolean }): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (opts?.compact) {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  }
  if (value < 0.01) return `$${value.toLocaleString('en-US', { maximumSignificantDigits: 4 })}`;
  if (value < 1) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function changeTone(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'text-[color:var(--ink-3)]';
  return value >= 0 ? 'text-[color:var(--ok)]' : 'text-rose-500';
}

interface MockPosition {
  agent: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  size: number;
  unrealizedPctSeed: number; // multiplier on the live 24h change for synthetic P&L
}

const MOCK_POSITIONS: MockPosition[] = [
  {
    agent: 'satoshi',
    symbol: 'SOL',
    side: 'LONG',
    entry: 142.5,
    size: 18.4,
    unrealizedPctSeed: 1.0,
  },
  {
    agent: 'vitalik',
    symbol: 'JUP',
    side: 'LONG',
    entry: 0.81,
    size: 4200,
    unrealizedPctSeed: 1.2,
  },
  { agent: 'hayek', symbol: 'WIF', side: 'LONG', entry: 1.94, size: 320, unrealizedPctSeed: 0.8 },
  {
    agent: 'hayek',
    symbol: 'BONK',
    side: 'SHORT',
    entry: 0.0000236,
    size: 12_500_000,
    unrealizedPctSeed: -0.6,
  },
];

interface TradeFeedItem {
  id: string;
  agent: string;
  side: 'BUY' | 'SELL';
  symbol: string;
  amount: number;
  price: number;
  timestamp: number;
  txHash: string;
  status: 'confirmed' | 'pending';
}

function shortHash(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function makeSyntheticTrade(prices: Record<string, PriceTick>): TradeFeedItem {
  const tokens = Object.values(prices).filter((p) => p.price);
  const pick = tokens[Math.floor(Math.random() * Math.max(1, tokens.length))];
  const agent = TRADERS_TEAM_MEMBERS[Math.floor(Math.random() * TRADERS_TEAM_MEMBERS.length)];
  return {
    id: `${Date.now()}-${Math.random()}`,
    agent,
    side: Math.random() > 0.5 ? 'BUY' : 'SELL',
    symbol: pick?.symbol ?? 'SOL',
    amount: Math.random() * 50 + 1,
    price: pick?.price ?? 0,
    timestamp: Date.now(),
    txHash: shortHash(),
    status: Math.random() > 0.15 ? 'confirmed' : 'pending',
  };
}

interface TradersDashboardProps {
  members: ResolvedTeamMember[];
}

export const TradersDashboard = ({ members }: TradersDashboardProps): React.JSX.Element => {
  const [pricesByCg, setPricesByCg] = useState<Record<string, PriceTick>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState<TradeFeedItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(COINGECKO_URL);
        if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
        const json = (await res.json()) as Record<
          string,
          { usd?: number; usd_24h_change?: number; usd_24h_vol?: number }
        >;
        if (cancelled) return;
        const next: Record<string, PriceTick> = {};
        for (const t of TRACKED_TOKENS) {
          const row = json[t.cgId];
          next[t.cgId] = {
            cgId: t.cgId,
            symbol: t.symbol,
            name: t.name,
            price: row?.usd ?? null,
            change24h: row?.usd_24h_change ?? null,
            volume24h: row?.usd_24h_vol ?? null,
          };
        }
        setPricesByCg(next);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) timer = setTimeout(tick, 30_000);
    };

    void tick();
    return (): void => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Synthetic trade-feed pulse — one new fill every 6-12s while the panel is open.
  useEffect(() => {
    if (Object.keys(pricesByCg).length === 0) return;
    let cancelled = false;
    const fire = (): void => {
      if (cancelled) return;
      setTrades((prev) => [makeSyntheticTrade(pricesByCg), ...prev].slice(0, 12));
      const wait = 6_000 + Math.random() * 6_000;
      setTimeout(fire, wait);
    };
    const initial = setTimeout(fire, 1_800);
    return (): void => {
      cancelled = true;
      clearTimeout(initial);
    };
  }, [pricesByCg]);

  const sol = pricesByCg['solana'];
  const tickers = TRACKED_TOKENS.filter((t) => t.cgId !== 'solana')
    .map((t) => pricesByCg[t.cgId])
    .filter((tick): tick is PriceTick => Boolean(tick));

  const positions = useMemo(() => {
    const lookup = new Map(Object.values(pricesByCg).map((p) => [p.symbol, p]));
    return MOCK_POSITIONS.map((pos) => {
      const live = lookup.get(pos.symbol);
      const change = (live?.change24h ?? 0) * pos.unrealizedPctSeed;
      const pnlPct = pos.side === 'LONG' ? change : -change;
      const liveValue = (live?.price ?? pos.entry) * pos.size;
      const pnlUsd = (liveValue * pnlPct) / 100;
      return { ...pos, livePrice: live?.price ?? null, pnlPct, pnlUsd };
    });
  }, [pricesByCg]);

  const totalPnl = positions.reduce((acc, p) => acc + (p.pnlUsd || 0), 0);
  const equity = positions.reduce((acc, p) => acc + (p.livePrice ?? p.entry) * p.size, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Hero: SOL + portfolio summary */}
      <LiquidGlass refract radius={26} shadow="lifted" className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.32em] text-[color:var(--ink-3)]">
              Solana Desk · live
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="font-serif text-[44px] leading-none text-[color:var(--ink-1)]">
                {formatUsd(sol?.price)}
              </span>
              <span className={`font-mono text-[14px] ${changeTone(sol?.change24h)}`}>
                {formatPct(sol?.change24h)} 24h
              </span>
            </div>
            <div className="mt-1 text-[12px] text-[color:var(--ink-2)]">
              SOL · vol {formatUsd(sol?.volume24h, { compact: true })}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-right">
            <PortfolioStat label="Equity" value={formatUsd(equity)} />
            <PortfolioStat
              label="Open P&L"
              value={formatUsd(totalPnl)}
              tone={totalPnl >= 0 ? 'pos' : 'neg'}
            />
            <PortfolioStat label="Positions" value={String(positions.length)} />
          </div>
        </div>
        {loading ? (
          <div className="mt-4 text-[11px] text-[color:var(--ink-3)]">Loading prices…</div>
        ) : error ? (
          <div className="mt-4 text-[11px] text-rose-500">
            Price feed unavailable: {error}. Showing last known values.
          </div>
        ) : null}
      </LiquidGlass>

      {/* Ticker strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tickers.map((t) => (
          <LiquidGlass key={t.cgId} radius={20} shadow="soft" className="p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-[color:var(--ink-2)]">
                {t.symbol}
              </span>
              <span className={`font-mono text-[11px] ${changeTone(t.change24h)}`}>
                {formatPct(t.change24h)}
              </span>
            </div>
            <div className="mt-2 font-serif text-[22px] text-[color:var(--ink-1)]">
              {formatUsd(t.price)}
            </div>
            <div className="text-[10px] text-[color:var(--ink-3)]">
              vol {formatUsd(t.volume24h, { compact: true })}
            </div>
          </LiquidGlass>
        ))}
      </div>

      {/* Two-column: positions + trade feed */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <LiquidGlass refract radius={22} shadow="lifted" className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-3)]">
              Open positions
            </span>
            <span className="text-[11px] text-[color:var(--ink-3)]">
              by {members.length || TRADERS_TEAM_MEMBERS.length} agents
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-[color:var(--glass-shade)]">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-white/30 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-3)]">
                  <th className="px-3 py-2">Agent</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2 text-right">Entry</th>
                  <th className="px-3 py-2 text-right">Mark</th>
                  <th className="px-3 py-2 text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr
                    key={`${p.agent}-${p.symbol}-${p.side}`}
                    className="border-t border-[color:var(--glass-shade)]"
                  >
                    <td className="px-3 py-2 font-medium text-[color:var(--ink-1)]">{p.agent}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                          p.side === 'LONG'
                            ? 'bg-emerald-500/15 text-emerald-700'
                            : 'bg-rose-500/15 text-rose-700'
                        }`}
                      >
                        {p.side}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[color:var(--ink-1)]">{p.symbol}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[color:var(--ink-2)]">
                      {p.size.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[color:var(--ink-2)]">
                      {formatUsd(p.entry)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[color:var(--ink-2)]">
                      {formatUsd(p.livePrice)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${changeTone(p.pnlPct)}`}>
                      {formatPct(p.pnlPct)}
                      <div className="text-[10px] opacity-70">{formatUsd(p.pnlUsd)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LiquidGlass>

        <LiquidGlass refract radius={22} shadow="lifted" className="flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-3)]">
              Recent fills
            </span>
            <span
              className="inline-flex items-center gap-1.5 font-mono text-[10px] text-[color:var(--ink-3)]"
              title="Synthetic feed — no real on-chain submission"
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--a-violet)]" />
              live · sim
            </span>
          </div>
          <div className="space-y-1 overflow-auto" style={{ maxHeight: 320 }}>
            {trades.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-[color:var(--ink-3)]">
                Waiting for first fill…
              </div>
            ) : (
              trades.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border border-[color:var(--glass-shade)] bg-white/45 px-3 py-2 text-[11px]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono text-[10px] ${
                          t.side === 'BUY' ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {t.side}
                      </span>
                      <span className="font-mono text-[color:var(--ink-1)]">{t.symbol}</span>
                      <span className="text-[color:var(--ink-3)]">·</span>
                      <span className="text-[color:var(--ink-2)]">{t.agent}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--ink-3)]">
                      tx {t.txHash}… {new Date(t.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular-nums text-[color:var(--ink-1)]">
                      {t.amount.toFixed(2)} @ {formatUsd(t.price)}
                    </div>
                    <div
                      className={`text-[10px] ${
                        t.status === 'confirmed' ? 'text-emerald-700' : 'text-amber-600'
                      }`}
                    >
                      {t.status}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </LiquidGlass>
      </div>

      {/* Strategy / signal card */}
      <LiquidGlass refract radius={22} shadow="lifted" className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-3)]">
              Active signal · satoshi
            </span>
            <div className="mt-2 font-serif text-[20px] leading-snug text-[color:var(--ink-1)]">
              SOL/USDC long — 30m breakout above $148 supply with rising Jupiter route depth.
            </div>
            <div className="mt-2 text-[12px] text-[color:var(--ink-2)]">
              Entry $148.20 · Stop $144.80 · Target $156 · Size 0.6%. Risk auditor (taleb) cleared:
              within 1.2R loss budget.
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-700">
              Cleared by risk
            </span>
            <span className="font-mono text-[10px] text-[color:var(--ink-3)]">
              demo · not financial advice
            </span>
          </div>
        </div>
      </LiquidGlass>
    </div>
  );
};

const PortfolioStat = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg';
}): React.JSX.Element => (
  <div>
    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
      {label}
    </div>
    <div
      className={`mt-1 font-serif text-[22px] ${
        tone === 'pos'
          ? 'text-emerald-600'
          : tone === 'neg'
            ? 'text-rose-500'
            : 'text-[color:var(--ink-1)]'
      }`}
    >
      {value}
    </div>
  </div>
);
