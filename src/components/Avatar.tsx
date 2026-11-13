import { Bird, Circle, Clover, Flame, PawPrint, Sparkles, Target, Trophy, Zap } from 'lucide-react';

/**
 * Spieler-Avatar: bekannte Symbole werden als Icon gezeichnet, damit die Darstellung nicht
 * davon abhängt, ob das Gerät einen Emoji-Font hat (auf Linux-Rechnern oft Kästchen).
 */
const ICONS: Record<string, typeof Target> = {
  '🎯': Target,
  '🔥': Flame,
  '⚡': Zap,
  '🏆': Trophy,
  '🦅': Bird,
  '🐺': PawPrint,
  '🍀': Clover,
  '🎱': Circle,
  '🧊': Circle,
  '🎪': Sparkles,
  target: Target,
  flame: Flame,
  zap: Zap,
  trophy: Trophy,
  bird: Bird,
  paw: PawPrint,
  clover: Clover,
  circle: Circle,
  sparkles: Sparkles,
};

export function Avatar({ value, className = 'h-5 w-5' }: { value?: string | null; className?: string }) {
  const key = (value ?? '').trim();
  const Icon = ICONS[key] ?? ICONS['🎯'];
  if (key && !ICONS[key] && key.length <= 2) {
    return <span className={className}>{key}</span>;
  }
  return <Icon className={className} aria-hidden />;
}
