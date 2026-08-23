import clsx from 'clsx';

interface AppLogoProps {
  className?: string;
  priority?: boolean;
}

export function AppLogo({ className, priority = false }: AppLogoProps) {
  return (
    <img
      src="/pomi-icon.png"
      alt="Pomi"
      width="200"
      height="200"
      decoding={priority ? 'sync' : 'async'}
      loading={priority ? 'eager' : 'lazy'}
      className={clsx('block object-cover', className)}
    />
  );
}
