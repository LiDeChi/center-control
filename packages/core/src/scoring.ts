export function daysSince(date: Date | null, now = new Date()) {
  if (!date) {
    return 365;
  }
  const ms = now.getTime() - date.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function computeActivityScore(input: {
  commitCount7d: number;
  commitCount30d: number;
  lastCommitAt: Date | null;
  dirtyWorkingTree: boolean;
  stars?: number;
}) {
  const recencyDays = daysSince(input.lastCommitAt);
  let recencyScore = 0;
  if (recencyDays <= 1) {
    recencyScore = 30;
  } else if (recencyDays <= 7) {
    recencyScore = 22;
  } else if (recencyDays <= 30) {
    recencyScore = 12;
  } else if (recencyDays <= 90) {
    recencyScore = 4;
  }

  const commitScore = input.commitCount7d * 8 + input.commitCount30d * 2;
  const dirtyScore = input.dirtyWorkingTree ? 6 : 0;
  const starScore = Math.min(10, Math.floor((input.stars || 0) / 25));

  return Math.max(0, Math.min(100, commitScore + recencyScore + dirtyScore + starScore));
}
