export function focusInput(input: HTMLInputElement | null): void {
  if (!input || document.activeElement === input) return;
  input.focus();
  input.select();
}
