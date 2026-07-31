export interface TabRowClassification {
  multiRow: boolean;
  bottomRow: boolean[];
}

export function classifyTabRows(
  tops: readonly number[],
  tolerance = 1
): TabRowClassification {
  if (tops.length === 0) {
    return { multiRow: false, bottomRow: [] };
  }

  const topRow = Math.min(...tops);
  const bottomRow = Math.max(...tops);
  const multiRow = bottomRow - topRow > tolerance;

  return {
    multiRow,
    bottomRow: tops.map((top) => multiRow && Math.abs(top - bottomRow) <= tolerance),
  };
}
