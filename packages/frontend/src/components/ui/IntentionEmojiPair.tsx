type IntentionEmojiPairSize = 'xs' | 'sm' | 'md';

type IntentionEmojiPairProps = {
  parentEmoji?: string | null;
  subEmoji?: string | null;
  size?: IntentionEmojiPairSize;
  className?: string;
  title?: string;
};

const sizeClasses: Record<
  IntentionEmojiPairSize,
  {
    wrapper: string;
    parent: string;
    sub: string;
  }
> = {
  xs: {
    wrapper: 'h-4 w-4',
    parent: 'text-[13px]',
    sub: '-right-1 -top-1 h-3 min-w-3 px-px text-[8px]',
  },
  sm: {
    wrapper: 'h-4 w-4',
    parent: 'text-[15px]',
    sub: '-right-1 -top-1 h-3.5 min-w-3.5 px-px text-[9px]',
  },
  md: {
    wrapper: 'h-6 w-6',
    parent: 'text-xl',
    sub: '-right-1.5 -top-1.5 h-4 min-w-4 px-px text-[10px]',
  },
};

export function IntentionEmojiPair({
  parentEmoji,
  subEmoji,
  size,
  className,
  title,
}: IntentionEmojiPairProps) {
  const resolvedSize = size ?? 'md';
  const classes = sizeClasses[resolvedSize];
  const baseClassName = className ? ` ${className}` : '';

  if (!parentEmoji && !subEmoji) {
    return null;
  }

  if (!parentEmoji || !subEmoji) {
    return (
      <span
        className={`inline-flex items-center justify-center leading-none ${classes.wrapper} ${classes.parent}${baseClassName}`}
        title={title}
      >
        {parentEmoji ?? subEmoji}
      </span>
    );
  }

  return (
    <span
      className={`relative inline-flex items-center justify-center leading-none ${classes.wrapper}${baseClassName}`}
      title={title}
    >
      <span className={classes.parent}>{parentEmoji}</span>
      <span
        className={`absolute ${classes.sub} inline-flex items-center justify-center rounded-full border border-indigo-300/70 bg-slate-950/95 leading-none shadow-sm`}
        aria-hidden="true"
      >
        {subEmoji}
      </span>
    </span>
  );
}
