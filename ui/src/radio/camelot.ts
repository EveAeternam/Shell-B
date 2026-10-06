/**
 * Camelot Wheel Harmonic Mixing System
 *
 * Major keys: 1B..12B
 * Minor keys: 1A..12A
 */

// Western pitch class: 0=C, 1=C#, 2=D, 3=D#, 4=E, 5=F, 6=F#, 7=G, 8=G#, 9=A, 10=A#, 11=B
const MAJOR_CAMELOT: Record<number, number> = {
  0: 8,   // C
  1: 3,   // C# / Db
  2: 10,  // D
  3: 5,   // D# / Eb
  4: 12,  // E
  5: 7,   // F
  6: 2,   // F# / Gb
  7: 9,   // G
  8: 4,   // G# / Ab
  9: 11,  // A
  10: 6,  // A# / Bb
  11: 1,  // B
};

const MINOR_CAMELOT: Record<number, number> = {
  0: 5,   // Cm
  1: 12,  // C#m / Dbm
  2: 7,   // Dm
  3: 2,   // D#m / Ebm
  4: 9,   // Em
  5: 4,   // Fm
  6: 11,  // F#m / Gbm
  7: 6,   // Gm
  8: 1,   // G#m / Abm
  9: 8,   // Am
  10: 3,  // A#m / Bbm
  11: 10, // Bm
};

export interface CamelotCode {
  number: number;
  letter: 'A' | 'B';
  code: string;
  name: string;
}

export function getCamelotCode(tonic: number, mode: string): CamelotCode {
  const normMode = mode.toLowerCase();
  const isMajor = normMode.includes('major') || normMode === 'lydian' || normMode === 'mixolydian';
  const tonicMod = ((tonic % 12) + 12) % 12;

  const number = isMajor ? (MAJOR_CAMELOT[tonicMod] ?? 8) : (MINOR_CAMELOT[tonicMod] ?? 8);
  const letter: 'A' | 'B' = isMajor ? 'B' : 'A';
  const code = `${number}${letter}`;

  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const name = `${NOTE_NAMES[tonicMod]} ${isMajor ? 'Major' : 'Minor'}`;

  return { number, letter, code, name };
}

export interface HarmonicRelationship {
  compatible: boolean;
  score: number; // 0..100
  badge: string;
  subtext: string;
  color: string;
}

export function evaluateHarmonicMix(keyA: CamelotCode, keyB: CamelotCode): HarmonicRelationship {
  if (keyA.code === keyB.code) {
    return {
      compatible: true,
      score: 100,
      badge: 'Exact Key Match',
      subtext: 'Flawless harmonic alignment (0 semitone delta)',
      color: '#10b981', // emerald-500
    };
  }

  // Same number, opposite letter: Relative Major/Minor swap (e.g. 8A <-> 8B)
  if (keyA.number === keyB.number && keyA.letter !== keyB.letter) {
    return {
      compatible: true,
      score: 95,
      badge: 'Relative Pivot',
      subtext: `Seamless ${keyA.letter === 'A' ? 'minor-to-major brightening' : 'major-to-minor darkening'}`,
      color: '#06b6d4', // cyan-500
    };
  }

  // Adjacent numbers, same letter: +1 Energy Boost or -1 Warmth
  if (keyA.letter === keyB.letter) {
    const nextUp = (keyA.number % 12) + 1;
    const nextDown = ((keyA.number - 2 + 12) % 12) + 1;

    if (keyB.number === nextUp) {
      return {
        compatible: true,
        score: 90,
        badge: 'Energy Boost (+1)',
        subtext: 'Fifth up harmonic lift: increases floor momentum',
        color: '#8b5cf6', // violet-500
      };
    }
    if (keyB.number === nextDown) {
      return {
        compatible: true,
        score: 90,
        badge: 'Harmonic Warmth (-1)',
        subtext: 'Fourth down grounding: smooth calming transition',
        color: '#3b82f6', // blue-500
      };
    }
  }

  // +2 Energy Jump
  if (keyA.letter === keyB.letter) {
    const jump2 = ((keyA.number + 1) % 12) + 1;
    if (keyB.number === jump2) {
      return {
        compatible: true,
        score: 75,
        badge: 'Key Lift (+2)',
        subtext: 'Whole step upward modulation: high drama shift',
        color: '#f59e0b', // amber-500
      };
    }
  }

  return {
    compatible: false,
    score: 45,
    badge: 'Key Shift',
    subtext: 'Harmonic clash risk: recommend filter sweep or echo mix',
    color: '#ef4444', // red-500
  };
}
