import type { Plan, PlanId } from '@/types';

/**
 * Plans and pricing are data, editable at runtime (Settings → Billing reads
 * these, and the API can override them from the `kv` table without a deploy).
 */
export const PLANS: Plan[] = [
  {
    id: 'free', name: 'Free', priceMonthly: 0, priceYearly: 0, currency: 'USD',
    creditsMonthly: 120, seats: 1, concurrentJobs: 1, watermark: true, priority: 0,
    maxResolution: '720p',
    features: ['120 credits / month','Built-in Studio Engine included','1 project at a time','720p exports with watermark','Community support']
  },
  {
    id: 'creator', name: 'Creator', priceMonthly: 24, priceYearly: 240, currency: 'USD',
    creditsMonthly: 1500, seats: 1, concurrentJobs: 2, watermark: false, priority: 1,
    maxResolution: '1080p', highlight: false,
    features: ['1,500 credits / month','No watermark','1080p exports','All AI stages','2 concurrent generations','20 project versions','Email support']
  },
  {
    id: 'pro', name: 'Pro', priceMonthly: 79, priceYearly: 790, currency: 'USD',
    creditsMonthly: 6000, seats: 3, concurrentJobs: 4, watermark: false, priority: 2,
    maxResolution: '4k', highlight: true,
    features: ['6,000 credits / month','4K exports','Automation engine with review gates','Unlimited project versions','4 concurrent generations','Priority queue','Bring your own API keys','Chat support']
  },
  {
    id: 'studio', name: 'Studio', priceMonthly: 249, priceYearly: 2490, currency: 'USD',
    creditsMonthly: 22000, seats: 10, concurrentJobs: 8, watermark: false, priority: 3,
    maxResolution: '4k',
    features: ['22,000 credits / month','10 seats, shared asset library','Team review gates','ProRes / stem exports','8 concurrent generations','Dedicated queue','S3-compatible storage','SSO-ready','Priority support']
  },
  {
    id: 'enterprise', name: 'Enterprise', priceMonthly: -1, priceYearly: -1, currency: 'USD',
    creditsMonthly: 100000, seats: 999, concurrentJobs: 32, watermark: false, priority: 4,
    maxResolution: '4k',
    features: ['Volume credits & invoicing','Self-hosted / VPC deployment','Custom provider adapters','On-prem ComfyUI + local models','Audit logs & retention policy','SLA and named engineer']
  }
];

export const planById = (id: PlanId | string): Plan => PLANS.find(p => p.id === id) ?? PLANS[0];

export interface CostRule { kind: string; label: string; base: number; perUnit: string; multiplier?: (q: Record<string, any>) => number }
/** Credit pricing independent of any vendor — the router converts provider cost into these. */
export const COST_RULES: CostRule[] = [
  { kind: 'text', label: 'Text generation', base: 1, perUnit: 'request' },
  { kind: 'image', label: 'Image generation', base: 3, perUnit: 'image', multiplier: q => (q.resolution === '4k' ? 2.2 : q.resolution === '1440p' ? 1.6 : 1) },
  { kind: 'video', label: 'Video generation', base: 12, perUnit: '5s clip', multiplier: q => Math.max(0.5, (q.durationSec ?? 5) / 5) * (q.resolution === '1080p' ? 1.5 : 1) },
  { kind: 'voice', label: 'Voice generation', base: 1, perUnit: 'line' },
  { kind: 'music', label: 'Music generation', base: 6, perUnit: 'track' },
  { kind: 'sfx', label: 'Sound effects', base: 2, perUnit: 'cue' },
  { kind: 'upscale', label: 'Upscaling', base: 1, perUnit: 'image' },
  { kind: 'export', label: 'Export render', base: 0, perUnit: 'render' }
];

export function baseCredits(kind: string, q: Record<string, any> = {}): number {
  const rule = COST_RULES.find(r => r.kind === kind);
  if (!rule) return 0;
  return Math.max(0, Math.round(rule.base * (rule.multiplier ? rule.multiplier(q) : 1) * 100) / 100);
}
