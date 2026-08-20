/** Attach as onMouseMove={spotlightMove} on any element with className including "spotlight". */
export const spotlightMove = (e) => {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--sx", `${e.clientX - rect.left}px`);
  el.style.setProperty("--sy", `${e.clientY - rect.top}px`);
};
