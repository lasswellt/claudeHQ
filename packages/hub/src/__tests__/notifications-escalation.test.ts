import { describe, it, expect } from 'vitest';
import {
  computeSeverity,
  severityToNtfyPriority,
  shouldPush,
} from '../notifications/escalation.js';

// CAP-033 / story 013-009: risk-based escalation rules.

describe('computeSeverity', () => {
  describe('critical', () => {
    it('is always urgent regardless of age', () => {
      expect(computeSeverity({ riskLevel: 'critical', ageMs: 0 })).toBe('urgent');
      expect(computeSeverity({ riskLevel: 'critical', ageMs: 60_000 })).toBe('urgent');
    });
  });

  describe('high', () => {
    it('is normal at age 0', () => {
      expect(computeSeverity({ riskLevel: 'high', ageMs: 0 })).toBe('normal');
    });

    it('is normal at exactly 30 seconds (boundary)', () => {
      expect(computeSeverity({ riskLevel: 'high', ageMs: 30_000 })).toBe('normal');
    });

    it('escalates to high after 30 seconds', () => {
      expect(computeSeverity({ riskLevel: 'high', ageMs: 31_000 })).toBe('high');
      expect(computeSeverity({ riskLevel: 'high', ageMs: 120_000 })).toBe('high');
    });
  });

  describe('medium', () => {
    it('is low at age 0', () => {
      expect(computeSeverity({ riskLevel: 'medium', ageMs: 0 })).toBe('low');
    });

    it('is low at exactly 60 seconds (boundary)', () => {
      expect(computeSeverity({ riskLevel: 'medium', ageMs: 60_000 })).toBe('low');
    });

    it('escalates to normal after 60 seconds', () => {
      expect(computeSeverity({ riskLevel: 'medium', ageMs: 61_000 })).toBe('normal');
      expect(computeSeverity({ riskLevel: 'medium', ageMs: 300_000 })).toBe('normal');
    });
  });

  describe('low', () => {
    it('is always badge-only regardless of age', () => {
      expect(computeSeverity({ riskLevel: 'low', ageMs: 0 })).toBe('badge');
      expect(computeSeverity({ riskLevel: 'low', ageMs: 600_000 })).toBe('badge');
    });
  });

  it('clamps negative ages to 0', () => {
    // If the caller passes a negative age (clock skew), we treat it as 0.
    expect(computeSeverity({ riskLevel: 'high', ageMs: -1000 })).toBe('normal');
  });
});

describe('severityToNtfyPriority', () => {
  it('maps every severity to a unique ntfy priority', () => {
    expect(severityToNtfyPriority('urgent')).toBe(5);
    expect(severityToNtfyPriority('high')).toBe(4);
    expect(severityToNtfyPriority('normal')).toBe(3);
    expect(severityToNtfyPriority('low')).toBe(2);
    expect(severityToNtfyPriority('badge')).toBe(1);
  });
});

describe('shouldPush', () => {
  it('pushes for everything except badge', () => {
    expect(shouldPush('urgent')).toBe(true);
    expect(shouldPush('high')).toBe(true);
    expect(shouldPush('normal')).toBe(true);
    expect(shouldPush('low')).toBe(true);
    expect(shouldPush('badge')).toBe(false);
  });
});
