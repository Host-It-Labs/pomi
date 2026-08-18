export type HabitState = 'pending' | 'done' | null;

export function orderIntentionsForHabits<T>(
  intentions: T[],
  getHabitState: (intention: T) => HabitState
): T[] {
  const pendingHabits: T[] = [];
  const rest: T[] = [];

  intentions.forEach(intention => {
    if (getHabitState(intention) === 'pending') {
      pendingHabits.push(intention);
      return;
    }

    rest.push(intention);
  });

  return [...pendingHabits, ...rest];
}
