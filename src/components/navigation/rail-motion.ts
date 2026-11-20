const ease = 'cubic-bezier(.35,.04,.18,1)';

export function illuminateFingerprint(anchor: HTMLElement | null, duration: number) {
  if (!anchor) return [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return Array.from(anchor.querySelectorAll('svg path:not([data-light-segment])')).map((path, index) => {
    const segment = path.cloneNode(false) as SVGPathElement;
    segment.setAttribute('pathLength', '100');
    segment.setAttribute('aria-hidden', 'true');
    segment.setAttribute('stroke', 'color-mix(in srgb,var(--stanza-accent) 62%,white)');
    segment.setAttribute('stroke-dasharray', reduced ? '100 100' : '24 100');
    segment.style.filter = 'drop-shadow(0 0 1.6px var(--stanza-accent))';
    path.parentNode?.appendChild(segment);
    const animation = segment.animate(reduced ? [{opacity:.75},{opacity:0}] : [
      {strokeDashoffset:'18',opacity:1},
      {offset:.42,strokeDashoffset:'-48',opacity:.8},
      {offset:.78,strokeDashoffset:'-75',opacity:.2},
      {strokeDashoffset:'-99',opacity:0},
    ], {duration:reduced ? 90 : duration-index*8, delay:reduced ? 0 : index*8, fill:'both'});
    const release = () => segment.remove();
    animation.finished.then(release,release);
    segment.dataset.lightSegment = '';
    return animation;
  });
}

export function unfoldRail(rail: HTMLElement, heading: HTMLElement | null, previousHeading: DOMRect | undefined,
  mode: 'rail' | 'launcher', entering: boolean, reduced: boolean, previous: Animation[]) {
  const opening = mode === 'rail';
  const folded = 'inset(0 0 calc(100% - 44px) 0 round 17px)';
  const expanded = 'inset(0 round 17px)';
  const paint = getComputedStyle(rail);
  const gap = parseFloat(paint.marginInlineStart);
  const span = rail.offsetWidth + 2 * gap;
  const hiddenMargin = gap - span;
  const startMargin = entering ? hiddenMargin : parseFloat(paint.marginInlineEnd);
  const clip = entering ? folded : paint.clipPath === 'none' ? expanded : paint.clipPath;
  const track = rail.querySelector<HTMLElement>('.stanza-rail-scroll');
  const opacity = entering ? 0 : track ? Number(getComputedStyle(track).opacity) : 1;
  const headerOffset = heading ? parseFloat(getComputedStyle(heading).marginInlineStart) : 0;
  previous.forEach(animation => animation.cancel());
  const duration = reduced ? 85 : opening ? 700 : 690;
  const timing: KeyframeAnimationOptions = {duration, easing:ease, fill:'both'};
  if (reduced) return [rail.animate([{opacity:opening ? .65 : 1},{opacity:opening ? 1 : .65}],timing)];
  const animations = [
    rail.animate([{clipPath:clip},{clipPath:opening ? expanded : folded}],timing),
    rail.animate([{marginInlineEnd:startMargin+'px'},{marginInlineEnd:(opening ? gap : hiddenMargin)+'px'}],timing),
  ];
  if (heading) {
    // The launcher header reserves a logo slot independently of the rail column.
    const rtl = getComputedStyle(rail).direction === 'rtl';
    const rect = heading.getBoundingClientRect();
    const start = entering && previousHeading
      ? (rtl ? rect.right - previousHeading.right : previousHeading.left - rect.left) : headerOffset;
    const slot = parseFloat(getComputedStyle(document.documentElement).fontSize) * 5.25;
    animations.push(heading.animate([{marginInlineStart:start+'px'},{marginInlineStart:(opening ? 0 : slot)+'px'}],timing));
  }
  if (track) animations.push(track.animate(opening ? [
    {opacity,transform:'translateY(-4px)'},{offset:.2,opacity:Math.max(.08,opacity)},
    {opacity:1,transform:'none'},
  ] : [{opacity},{offset:.53,opacity:.15},{opacity:0}],timing));
  return animations;
}
