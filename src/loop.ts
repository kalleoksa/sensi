// Fixed-timestep driver: logic at a steady 60Hz, render interpolated by the
// leftover accumulator fraction. Deterministic regardless of display rate.

export const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25; // clamp huge gaps (tab was backgrounded) to avoid spiral
// A frame that throws used to end the animation chain outright (the next frame
// is only requested after step + render), turning any one-off error into a dead
// black window. Log and keep going instead — but give up if every frame fails,
// rather than spinning at 60Hz filling the console.
const MAX_CONSECUTIVE_ERRORS = 60;

export function startLoop(
  step: (dt: number) => void,
  render: (alpha: number) => void,
): void {
  let last = performance.now();
  let acc = 0;
  let errors = 0;
  function tick(now: number): void {
    let frame = (now - last) / 1000;
    last = now;
    if (frame > MAX_FRAME) frame = MAX_FRAME;
    acc += frame;
    try {
      while (acc >= FIXED_DT) {
        step(FIXED_DT);
        acc -= FIXED_DT;
      }
      render(acc / FIXED_DT);
      errors = 0;
    } catch (err) {
      acc = 0; // don't replay the steps that just threw
      errors++;
      console.error(`sensi: frame failed (${errors})`, err);
      if (errors >= MAX_CONSECUTIVE_ERRORS) {
        console.error('sensi: too many consecutive frame errors — stopping the loop');
        return;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
