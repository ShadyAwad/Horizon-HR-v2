import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { BACKGROUND_STYLES } from '../src/lib/appearance-options';
import type { BusinessFixtures } from './business-scenario-fixtures';

const layouts = [
  { width: 1440, preset: 'emerald', theme: 'dark', rtl: false },
  { width: 390, preset: 'warm_sand', theme: 'light', rtl: true },
  { width: 820, preset: 'amethyst', theme: 'dark', rtl: false },
  { width: 1920, preset: 'graphite', theme: 'dark', rtl: false },
  { width: 1440, preset: 'ember', theme: 'light', rtl: false },
  { width: 1920, preset: 'custom', theme: 'light', rtl: false },
] as const;
const protectedStyles = new Set(['plain', 'topographic', 'dots']);
const staticStyles = BACKGROUND_STYLES.filter(style => style.id !== 'dynamic');
const hideSettings = '.stanza-settings-overlay { visibility: hidden !important; }';
const backgroundOnly = `${hideSettings} .stanza-dashboard > :not(.pointer-events-none), [data-stanza-launcher-assembly] { visibility: hidden !important; }`;

export async function verifyBackgroundDesigns(fixture: BusinessFixtures, output?: string) {
  const { chromium } = createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({
    channel: 'msedge', headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    await verifyDesigns(fixture, browser, output);
  } finally {
    await browser.close();
  }
}

async function verifyDesigns(fixture: BusinessFixtures, browser: BusinessFixtures['browser'], output?: string) {
  const baselineCss = process.env.STANZA_BACKGROUND_BASELINE_CSS && await readFile(process.env.STANZA_BACKGROUND_BASELINE_CSS);
  for (const layout of layouts) {
    const context = await browser.newContext({
      viewport: { width: layout.width, height: 1000 }, serviceWorkers: 'block',
      reducedMotion: layout.rtl ? 'reduce' : 'no-preference',
    });
    try {
      await context.addCookies(await fixture.admin.context.cookies());
      await context.addInitScript(({ preset, theme, rtl }: typeof layout) => {
        const frames: Array<{ time: number; phase: number }> = [];
        const testWindow = window as Window & { fluidFrames?: typeof frames };
        testWindow.fluidFrames = frames;
        const uniform = WebGLRenderingContext.prototype.uniform1f;
        const getLocation = WebGLRenderingContext.prototype.getUniformLocation;
        const draw = WebGLRenderingContext.prototype.drawArrays;
        const phases = new WeakMap<WebGLRenderingContext, WebGLUniformLocation>();
        let phase = 0;
        WebGLRenderingContext.prototype.getUniformLocation = function (program, name) {
          const location = getLocation.call(this, program, name);
          if (name === 'phase' && location) phases.set(this, location);
          return location;
        };
        WebGLRenderingContext.prototype.uniform1f = function (location, value) {
          if (phases.get(this) === location) phase = value;
          uniform.call(this, location, value);
        };
        WebGLRenderingContext.prototype.drawArrays = function (mode, first, count) {
          if (phases.has(this)) frames.push({ time: performance.now(), phase });
          draw.call(this, mode, first, count);
        };
        if (sessionStorage.getItem('disableTestWebGL')) {
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, options?: unknown) {
            return id === 'webgl' ? null : getContext.call(this, id, options);
          } as typeof getContext;
        }
        localStorage.setItem('horizon-theme', theme);
        localStorage.setItem('horizon-language', rtl ? 'ar' : 'en');
        localStorage.setItem('stanza-demo-notice-seen', 'true');
        if (!localStorage.getItem('stanza.preferences.v1')) localStorage.setItem('stanza.preferences.v1', JSON.stringify({
          backgroundPreset: preset, customTheme: { accent: '#c56828' }, backgroundIntensity: 'normal',
          tutorialsAutoStart: false, lanyardEnabled: false, interfaceScale: rtl ? 1.2 : 1, fontScale: rtl ? 1.2 : 1,
        }));
      }, layout);
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const options = page.locator('.stanza-appearance-options');
      const layer = page.locator('.stanza-background-pattern');
      const prefix = `${layout.preset}-${layout.width}`;
      const before = new Map<string, { page: Buffer; swatch: Buffer; paint: string[] }>();
      let useBaseline = Boolean(baselineCss);
      if (baselineCss) await page.route('**/assets/index-*.css', (route: any) => useBaseline
        ? route.fulfill({ contentType: 'text/css', body: baselineCss })
        : route.continue());

      for (const version of baselineCss ? ['before', 'after'] : ['after']) {
        useBaseline = version === 'before';
        await page.goto(fixture.base);
        await page.locator('[data-tutorial-target=stanza-launcher]').waitFor();
        if (layout.preset === 'emerald') await fixture.navigate(page, 'Workspace Composer');
        await page.keyboard.press('Control+k');
        const appearance = layout.rtl ? 'فتح المظهر' : 'Open Appearance';
        await page.locator('.stanza-command-palette input').first().fill(appearance);
        await page.locator('.stanza-command-palette [role=option]').filter({ hasText: appearance }).click();
        await options.waitFor();
        const choice = (style: typeof BACKGROUND_STYLES[number]) => options.getByRole('button', { name: layout.rtl ? style.ar : style.en, exact: true });
        let plain: Buffer | undefined;
        for (const style of staticStyles) {
          await choice(style).click();
          await page.waitForFunction((id: string) => document.documentElement.dataset.backgroundStyle === id, style.id);
          if (version === 'after' && !protectedStyles.has(style.id)) {
            const paint = await page.evaluate((id: string) => {
              const dashboard = document.querySelector('.stanza-dashboard')!;
              const actual = getComputedStyle(dashboard.querySelector('.stanza-background-pattern')!);
              const swatch = getComputedStyle(document.querySelector(`.stanza-pattern-preview[data-pattern="${id}"]`)!);
              return { mask: actual.getPropertyValue('--stanza-pattern-mask'), preview: swatch.getPropertyValue('--stanza-pattern-mask'),
                image: actual.backgroundImage, swatchImage: swatch.backgroundImage, animation: actual.animationName,
                pointerEvents: actual.pointerEvents, rootOpacity: getComputedStyle(dashboard).opacity,
                noOverflow: document.documentElement.scrollWidth <= innerWidth + 1 };
            }, style.id);
            assert.match(paint.mask, /^\s*url\(/);
            assert.equal(paint.mask, paint.preview);
            assert.equal(paint.image, paint.swatchImage);
            assert.equal(paint.animation, 'none');
            assert.equal(paint.pointerEvents, 'none');
            assert.equal(paint.rootOpacity, '1');
            assert(paint.noOverflow);
          }

          if (version === 'after' || protectedStyles.has(style.id)) {
            const screenshot = await page.screenshot({ clip: { x: 0, y: 0, width: layout.width, height: 110 }, style: backgroundOnly });
            const pixels = await sharp(screenshot).removeAlpha().raw().toBuffer();
            if (style.id === 'plain') plain = pixels;
            if (protectedStyles.has(style.id) && baselineCss) {
              await page.mouse.move(0, 0);
              const thumbnail = choice(style).locator('.stanza-pattern-preview');
              const paint = await thumbnail.evaluate((el: Element) => {
                const css = getComputedStyle(el);
                return [css.backgroundImage, css.backgroundSize, css.backgroundColor, css.maskImage, css.maskSize, css.opacity];
              });
              await thumbnail.scrollIntoViewIfNeeded();
              const takeSwatch = async (filename?: string) => {
                const image = await thumbnail.screenshot({
                  path: filename, animations: 'disabled',
                  style: '.stanza-pattern-selected { visibility: hidden !important; }',
                });
                return sharp(image).removeAlpha().raw().toBuffer();
              };
              const swatch = await takeSwatch();
              if (version === 'before') {
                before.set(style.id, { page: pixels, swatch, paint });
              }
              else {
                assert(before.get(style.id)?.page.equals(pixels), `${style.id} matches the restored dashboard artwork`);
                assert.deepEqual(paint, before.get(style.id)?.paint, `${style.id} retains its swatch paint and geometry`);
                const expected = before.get(style.id)!.swatch;
                // The mobile overlay can repaint once more after auto-scrolling the swatch.
                assert(expected.equals(swatch) || expected.equals(await takeSwatch(
                  output && path.join(output, `${prefix}-${style.id}-comparison.png`),
                )), `${style.id} matches the restored swatch`);
              }
            }
            if (!protectedStyles.has(style.id)) {
              assert(plain);
              let changed = 0;
              for (let i = 0; i < pixels.length; i += 3) {
                const error = Math.abs(pixels[i] - plain[i]) + Math.abs(pixels[i + 1] - plain[i + 1]) + Math.abs(pixels[i + 2] - plain[i + 2]);
                if (error >= 10) changed++;
              }
              assert(changed > layout.width / 25, `${style.id} visibly paints the shell`);
            }
          }
          if (output && (version === 'after' || layout.preset === 'emerald')) {
            await page.screenshot({ path: path.join(output, `${prefix}-${version}-${style.id}.png`), style: hideSettings });
          }
        }
        if (output && version === 'after') await options.locator('.stanza-pattern-choices').screenshot({ path: path.join(output, `${prefix}-swatches.png`) });
      }

      const normal = await layer.evaluate((element: Element) => Number(getComputedStyle(element).opacity));
      const geometry = await layer.evaluate((element: Element) => getComputedStyle(element).maskSize);
      for (const [id, english, arabic] of [['quiet', 'Quiet', 'هادئ'], ['expressive', 'Expressive', 'بارز']] as const) {
        await options.getByRole('button', { name: layout.rtl ? arabic : english, exact: true }).click();
        await page.waitForFunction((id: string) => document.documentElement.dataset.backgroundIntensity === id, id);
        const opacity = await layer.evaluate((element: Element) => Number(getComputedStyle(element).opacity));
        assert(id === 'quiet' ? opacity < normal : opacity > normal);
        assert.equal(await layer.evaluate((element: Element) => getComputedStyle(element).maskSize), geometry);
        if (output && layout.preset === 'emerald') await page.screenshot({ path: path.join(output, `${prefix}-ambient-${id}.png`), style: hideSettings });
      }
      console.log('PASS designs, theme, swatches, intensity and shell layout', prefix);
      await verifyDynamic(page, options, layout, prefix, output);
    } finally {
      await context.close();
    }
  }
}

async function verifyDynamic(page: any, options: any, layout: typeof layouts[number], prefix: string, output?: string) {
  const canvas = page.locator('.stanza-fluid-canvas');
  const ready = page.locator('.stanza-fluid-canvas[data-fluid-ready]');
  const frames = () => page.evaluate(() => (window as Window & {
    fluidFrames?: Array<{ time: number; phase: number }>;
  }).fluidFrames!);
  const choice = (en: string, ar: string) => options.getByRole('button', { name: layout.rtl ? ar : en, exact: true });
  const capture = (name: string, style = hideSettings) => page.screenshot({
    path: output && path.join(output, `${prefix}-dynamic-${name}.png`), style,
  });
  assert.equal(await canvas.count(), 0);
  assert.equal((await frames()).length, 0);
  await choice('Normal', 'عادي').click();
  await choice('Dynamic', 'ديناميكي').click();
  await ready.waitFor();
  const viewport = await canvas.evaluate((el: HTMLCanvasElement) => ({
    width: el.width, height: el.height, pointerEvents: getComputedStyle(el).pointerEvents,
    noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
  }));
  assert(Math.max(viewport.width, viewport.height) <= 576);
  assert.equal(viewport.pointerEvents, 'none');
  assert(viewport.noOverflow);
  const palette = await canvas.evaluate((el: HTMLCanvasElement) => {
    const gl = el.getContext('webgl')!;
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const colors = getComputedStyle(document.documentElement);
    return ['accent', 'highlight'].map((name, index) => ({
      uniform: Array.from(gl.getUniform(program, gl.getUniformLocation(program, name))),
      hex: colors.getPropertyValue(index === 0 ? '--stanza-accent' : '--stanza-accent-hover').trim(),
    }));
  });
  for (const { uniform, hex } of palette) {
    assert.equal('#' + uniform.map((component: number) => Math.round(component * 255).toString(16).padStart(2, '0')).join(''), hex.toLowerCase());
  }
  const backgroundBefore = await capture('surface-start', backgroundOnly);
  await page.waitForTimeout(850);
  const backgroundAfter = await capture('surface-later', backgroundOnly);
  assert.equal(backgroundBefore.equals(backgroundAfter), layout.rtl, 'fluid pixels only advance without reduced motion');
  if (output) await capture('normal');

  if (layout.preset === 'emerald') {
    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    const metrics = async () => new Map<string, number>((await session.send('Performance.getMetrics')).metrics.map(
      ({ name, value }: { name: string; value: number }) => [name, value],
    ));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    let requests = 0;
    const countRequest = () => requests++;
    page.on('request', countRequest);
    const start = (await frames()).length;
    const before = await metrics();
    await page.waitForTimeout(3000);
    const after = await metrics();
    const sampled = (await frames()).slice(start);
    page.off('request', countRequest);
    const delta = (key: string) => (after.get(key) ?? 0) - (before.get(key) ?? 0);
    const gaps = sampled.slice(1).map((frame: { time: number }, index: number) => frame.time - sampled[index].time).sort((a: number, b: number) => a - b);
    const p95 = gaps[Math.floor(gaps.length * 0.95)];
    assert(sampled.length >= 35 && sampled.length <= 100, 'bounded animation cadence');
    assert.equal(delta('LayoutCount'), 0, 'no idle fluid layout');
    assert.equal(delta('RecalcStyleCount'), 0, 'no idle fluid restyles');
    assert.equal(requests, 0, 'no idle requests');
    console.log('PASS Dynamic idle performance (3s, Edge SwiftShader)', {
      draws: sampled.length, p95GapMs: p95, scriptMs: delta('ScriptDuration') * 1000,
      mainThreadTaskMs: delta('TaskDuration') * 1000, layouts: delta('LayoutCount'),
      styleRecalculations: delta('RecalcStyleCount'), requests,
    });
    await session.detach();

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = (await frames()).length;
    await page.waitForTimeout(250);
    assert.equal((await frames()).length, hidden);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'visibilityState');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);
    assert((await frames()).length > hidden + 2, 'animation resumes when visible');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(120);
    const frozen = (await frames()).length;
    await page.waitForTimeout(250);
    assert.equal((await frames()).length, frozen);
    await ready.waitFor();
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await page.keyboard.press('Control+k');
    await page.locator('.stanza-command-palette input').first().fill('Open Appearance');
    await page.locator('.stanza-command-palette [role=option]').filter({ hasText: 'Open Appearance' }).click();
    const slopes: number[] = [];
    const opacities: number[] = [];
    for (const name of ['Quiet', 'Expressive']) {
      await options.getByRole('button', { name, exact: true }).click();
      const first = (await frames()).at(-1)!;
      await page.waitForTimeout(500);
      const last = (await frames()).at(-1)!;
      slopes.push((last.phase - first.phase) / (last.time - first.time));
      opacities.push(await canvas.evaluate((el: HTMLElement) => Number(getComputedStyle(el.parentElement!).opacity)));
      if (output) await capture(name.toLowerCase());
    }
    assert(slopes[0] > 0 && slopes[1] > slopes[0] * 2, 'intensity adjusts phase speed');
    assert(opacities[0] < opacities[1], 'intensity adjusts visible strength');
  }

  await choice('Plain', 'بسيط').click();
  await canvas.waitFor({ state: 'detached' });
  const stopped = (await frames()).length;
  await page.waitForTimeout(250);
  assert.equal((await frames()).length, stopped, 'switching away stops all draws');
  if (layout.preset === 'emerald') {
    await choice('Dynamic', 'ديناميكي').click();
    await ready.waitFor();
    await page.evaluate(() => sessionStorage.setItem('disableTestWebGL', 'true'));
    await page.reload();
    await canvas.waitFor({ state: 'attached' });
    assert.equal(await ready.count(), 0);
    assert.equal((await frames()).length, 0);
    assert(await canvas.evaluate((el: HTMLElement) => {
      const fallback = getComputedStyle(el.parentElement!, '::before');
      return fallback.visibility === 'visible' && fallback.maskImage.startsWith('url(');
    }), 'persistent Dynamic selection has a static fallback without WebGL');
    await capture('fallback');
  }
  console.log('PASS Dynamic paint, viewport, theme and selection lifecycle', prefix);
}
