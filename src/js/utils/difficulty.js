export const GRADE_COLORS = {
  Easy: '#4CAF50',
  Normal: '#2196F3',
  Hard: '#FF9800',
  Expert: '#F44336',
  Master: '#9C27B0',
};

export function getDifficultyColor(level) {
  const grade = level?.difficulty?.grade;
  if (grade && GRADE_COLORS[grade]) return GRADE_COLORS[grade];

  const size = Math.max(level?.cols ?? 0, level?.rows ?? 0);
  if (size <= 4) return GRADE_COLORS.Easy;
  if (size <= 5) return GRADE_COLORS.Normal;
  if (size <= 6) return GRADE_COLORS.Hard;
  if (size <= 7) return GRADE_COLORS.Expert;
  return GRADE_COLORS.Master;
}
