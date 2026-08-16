/**
 * wallet.ts — 游戏化钱包系统
 * 10万初始、破产<1k、暴富≥1亿
 */

export class Wallet {
  balance = 100000;
  bankruptCount = 0;
  fortuneCount = 0;
  totalSessions = 0;
  INITIAL = 100000;
  BANKRUPT_THRESHOLD = 1000;
  FORTUNE_THRESHOLD = 100_000_000;

  load(state: { balance: number; bankrupt_count: number; fortune_count: number; total_sessions: number }) {
    this.balance = state.balance ?? this.INITIAL;
    this.bankruptCount = state.bankrupt_count ?? 0;
    this.fortuneCount = state.fortune_count ?? 0;
    this.totalSessions = state.total_sessions ?? 0;
  }

  reset() {
    this.balance = this.INITIAL;
    this.bankruptCount = 0;
    this.fortuneCount = 0;
    this.totalSessions = 0;
  }

  settle(finalEquity: number): 'bankrupt' | 'fortune' | null {
    this.balance = finalEquity;
    this.totalSessions++;
    if (this.balance < this.BANKRUPT_THRESHOLD) {
      this.bankruptCount++;
      this.balance = this.INITIAL;
      return 'bankrupt';
    }
    if (this.balance >= this.FORTUNE_THRESHOLD) {
      this.fortuneCount++;
      this.balance = this.INITIAL;
      return 'fortune';
    }
    return null;
  }

  getStatus(): 'active' | 'bankrupt' | 'fortune' {
    if (this.balance < this.BANKRUPT_THRESHOLD * 5) return 'bankrupt';
    if (this.balance >= this.FORTUNE_THRESHOLD * 0.5) return 'fortune';
    return 'active';
  }

  toJSON() {
    return {
      balance: this.balance,
      bankrupt_count: this.bankruptCount,
      fortune_count: this.fortuneCount,
      total_sessions: this.totalSessions,
    };
  }
}

export const wallet = new Wallet();
