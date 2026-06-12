// Fixed-timestep driver: logic at a steady 60Hz, render interpolated by the
// leftover accumulator fraction. Deterministic regardless of display rate.

export const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25; // clamp huge gaps (tab was backgrounded) to avoid spiral

export function startLoop(
  step: (dt: number) => void,
  render: (alpha: number) => void,
): void {
  let last = performance.now();
  let acc = 0;
  function tick(now: number): void {
    let frame = (now - last) / 1000;
    last = now;
    if (frame > MAX_FRAME) frame = MAX_FRAME;
    acc += frame;
    while (acc >= FIXED_DT) {
      step(FIXED_DT);
      acc -= FIXED_DT;
    }
    render(acc / FIXED_DT);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
