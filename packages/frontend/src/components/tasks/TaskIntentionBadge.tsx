import clsx from 'clsx';
import { IntentionEmojiPair } from '../ui/IntentionEmojiPair';

type Props = {
  parentEmoji?: string | null;
  subEmoji?: string | null;
  compact: boolean;
};

export function TaskIntentionBadge({ parentEmoji, subEmoji, compact }: Props) {
  const isLinked = Boolean(parentEmoji || subEmoji);

  return (
    <span
      data-testid="task-intention-badge"
      data-linked={isLinked}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full border transition-colors',
        compact ? 'h-5 min-w-5 px-0.5' : 'h-5 min-w-6 px-1',
        isLinked
          ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-100'
          : 'border-dashed border-slate-600/70 bg-slate-900/30 text-slate-500'
      )}
    >
      {isLinked ? (
        <IntentionEmojiPair
          parentEmoji={parentEmoji}
          subEmoji={subEmoji}
          size="xs"
        />
      ) : (
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 rounded-full border border-current"
        />
      )}
    </span>
  );
}
