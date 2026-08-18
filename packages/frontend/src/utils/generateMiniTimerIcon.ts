export function generateMiniTimerIcon(
  progress: number,
  color = '#6366f1',
  minutesLeft: number = 0,
  isPaused: boolean = false
): Uint8Array {
  const size = 32;
  const center = size / 2;
  const circleRadius = 14; // Slightly smaller for inner black circle
  const arcRadius = 13; // Slightly larger for outer progress arc
  const lineWidth = 5;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array();

  // Draw black filled circle as background
  ctx.beginPath();
  ctx.arc(center, center, circleRadius, 0, 2 * Math.PI);
  ctx.fillStyle = 'black';
  ctx.fill();

  // Progress arc (outside the black circle)
  ctx.beginPath();
  ctx.arc(
    center,
    center,
    arcRadius,
    -Math.PI / 2,
    -Math.PI / 2 + 2 * Math.PI * progress,
    false
  );
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round'; // Smooth, rounded ends
  ctx.stroke();

  // Draw white text or pause icon
  ctx.fillStyle = 'white';

  if (isPaused) {
    // Draw pause icon (two vertical lines)
    const barWidth = 4;
    const barHeight = 14;
    const spacing = 5;
    const barX1 = center - spacing + barWidth;
    const barX2 = center + spacing - barWidth;
    const barY = center - barHeight / 2;

    // Left bar
    ctx.fillRect(barX1 - barWidth, barY, barWidth, barHeight);
    // Right bar
    ctx.fillRect(barX2, barY, barWidth, barHeight);
  } else {
    // Draw minutes left as text
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(minutesLeft), center, center);
  }

  // Convert canvas to Uint8Array
  const dataUrl = canvas.toDataURL('image/png');
  const byteString = atob(dataUrl.split(',')[1]);
  const byteArray = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    byteArray[i] = byteString.charCodeAt(i);
  }
  return byteArray;
}
