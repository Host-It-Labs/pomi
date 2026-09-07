export function toggleInputFocus(input: HTMLInputElement | null): void {
  if (!input) return;
  if (document.activeElement === input) {
    input.blur();
  } else {
    input.focus();
    input.select();
  }
}
