import { ReactNode } from 'react';

interface KeyboardKeyProps {
  children: ReactNode;
}

export const KeyboardKey = ({ children }: KeyboardKeyProps) => {
  return (
    <span className="inline-flex items-center justify-center px-2 py-1 text-sm font-medium text-gray-800 bg-gray-200 border border-gray-300 rounded shadow min-w-8">
      {children}
    </span>
  );
};
