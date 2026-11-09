export type Ring = 'single' | 'double' | 'triple' | 'bull' | 'bullseye';

export interface User {
  id: number;
  email: string;
  displayName: string;
  avatar: string;
}

export interface Player {
  id: number;
  name: string;
  avatar: string;
  is_guest?: boolean;
  owner_id?: number | null;
  matches?: number;
}

export interface CheckoutThrow {
  label: string;
  ring: Ring;
  number: number;
}

export interface CheckoutRoute {
  label: string;
  throws: CheckoutThrow[];
  darts: number;
}

export interface PlayerState {
  matchPlayerId: number;
  playerId: number;
  name: string;
  avatar: string;
  position: number;
  remaining: number;
  entered: boolean;
  legsWon: number;
  visitsThisLeg: number;
  pointsThisLeg: number;
  dartsThisLeg: number;
  checkoutSuggestion: CheckoutRoute[] | null;
}

export interface Visit {
  id: number;
  matchPlayerId: number;
  legIndex: number;
  score: number;
  remainingAfter: number;
  bust: boolean;
  checkout: boolean;
  endedEarly: boolean;
  source: string;
  darts: Array<{ id: number; ring: Ring; number: number; points: number; source: string }>;
}

export interface MatchState {
  match: {
    id: number;
    name: string;
    startScore: number;
    doubleIn: boolean;
    doubleOut: boolean;
    bestOf: number;
    mode: string;
    status: string;
    winnerPlayerId: number | null;
  };
  players: PlayerState[];
  currentMatchPlayerId: number | null;
  currentLegIndex: number;
  legs: Array<{ legIndex: number; winnerMatchPlayerId: number; dartsThrown: number }>;
  visits: Visit[];
  lastVisit: Visit | null;
  finished: boolean;
}

export interface MatchSummary {
  id: number;
  name: string;
  start_score: number;
  double_in: boolean;
  double_out: boolean;
  best_of: number;
  mode: string;
  status: string;
  created_at: string;
  finished_at: string | null;
  winner_player_id: number | null;
  players: Array<{ playerId: number; name: string; avatar: string }>;
  legs_played: string;
}

export interface PlayerStats {
  playerId: number;
  name: string;
  avatar: string;
  matches: number;
  matchesWon: number;
  legs: number;
  legsWon: number;
  visits: number;
  darts: number;
  points: number;
  bestVisit: number;
  count180: number;
  count140: number;
  count100: number;
  doubleHits: number;
  doubleAttempts: number;
  checkouts: number;
  checkoutAttempts: number;
  busts: number;
  fields: Record<string, number>;
  numbers: Record<string, number>;
  average: number;
  first9Average: number;
  doubleQuote: number;
  checkoutQuote: number;
}

export interface RankingEntry {
  playerId: number;
  name: string;
  avatar: string;
  elo: number;
  wins: number;
  losses: number;
  matches: number;
  average: number;
  doubleQuote: number;
  legsWon: number;
}

export function dartLabel(ring: Ring, number: number): string {
  if (ring === 'bull') return '25';
  if (ring === 'bullseye') return 'Bull';
  if (ring === 'triple') return `T${number}`;
  if (ring === 'double') return `D${number}`;
  return `S${number}`;
}
