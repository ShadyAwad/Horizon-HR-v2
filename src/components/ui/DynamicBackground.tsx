import { useEffect, useRef } from 'react';
import { normaliseBackgroundIntensity } from '../../lib/appearance-options';

const motion = {
  quiet: { speed: 0.18, depth: 0.7 },
  normal: { speed: 0.38, depth: 1 },
  expressive: { speed: 0.62, depth: 1.24 },
};
const maxDimension = 576;
const frameInterval = 1000 / 30;
const vertexSource = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;
const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
uniform vec3 accent;
uniform vec3 highlight;
uniform float phase;
uniform float depth;
uniform float aspect;
uniform float lightMode;

float veil(float distance, float width) {
  return 1.0 - smoothstep(0.0, width, abs(distance));
}

void main() {
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float sway = sin(phase);
  float turn = cos(phase * 0.73);

  // Two nested warps bend the cross-section as well as the length of each fold.
  vec2 q = p + depth * vec2(
    0.19 * sin(4.4 * p.y + 2.2 * p.x + phase),
    0.16 * cos(4.9 * p.x - 2.0 * p.y - 0.66 * phase)
  );
  q += depth * vec2(
    0.14 * sin(3.6 * q.y - 2.8 * q.x + turn),
    0.10 * sin(5.3 * q.x + 2.1 * q.y + sway)
  );

  float fold = q.y - 0.21 * q.x + 0.19 * sin(3.9 * q.x + 1.8 * q.y + 0.65 * turn);
  float upper = fold - 0.22 + 0.08 * sway;
  float lower = fold + 0.27 - 0.08 * turn + 0.07 * cos(6.0 * q.x);
  float upperFade = mix(1.0, 0.40, smoothstep(0.18, 0.96, uv.x));
  float lowerFade = smoothstep(0.04, 0.77, uv.x);

  float body = veil(upper, 0.28) * upperFade * 0.48
    + veil(lower, 0.23) * lowerFade * 0.40;
  float sheen = veil(upper + 0.04, 0.072) * upperFade * 0.34
    + veil(lower - 0.045, 0.065) * lowerFade * 0.27;
  float reflected = veil(upper - 0.21 + 0.06 * sin(5.1 * q.x), 0.20)
    * smoothstep(0.30, 0.92, uv.x) * 0.19;
  float alpha = min(0.94, (body + sheen + reflected) * mix(1.0, 0.85, lightMode));
  vec3 tint = mix(accent, highlight, clamp(sheen * 1.8 + reflected * 1.4, 0.0, 1.0));
  gl_FragColor = vec4(tint, alpha);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function createRenderer(gl: WebGLRenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  if (vertex && fragment && program) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
  }
  if (vertex) gl.deleteShader(vertex);
  if (fragment) gl.deleteShader(fragment);
  if (!program || !buffer || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  return {
    accent: gl.getUniformLocation(program, 'accent'),
    highlight: gl.getUniformLocation(program, 'highlight'),
    phase: gl.getUniformLocation(program, 'phase'),
    depth: gl.getUniformLocation(program, 'depth'),
    aspect: gl.getUniformLocation(program, 'aspect'),
    lightMode: gl.getUniformLocation(program, 'lightMode'),
    dispose() {
      gl.useProgram(null);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
    },
  };
}

// Preset and custom theme tokens both supply six-digit hex colors.
function readColor(style: CSSStyleDeclaration, token: string) {
  const hex = style.getPropertyValue(token).trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
}

export default function DynamicBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false,
    });
    if (!gl) return;

    const root = document.documentElement;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let renderer = createRenderer(gl);
    let width = 0;
    let height = 0;
    let phase = 1.4;
    let speed = motion.normal.speed;
    let hasPalette = false;
    let frame = 0;
    let lastDraw = 0;
    let nextDraw = 0;

    function canDraw() {
      return renderer && width && height && hasPalette && document.visibilityState === 'visible';
    }

    function draw() {
      if (!gl || !renderer || !canDraw()) return;
      gl.uniform1f(renderer.phase, phase);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!canvas.hasAttribute('data-fluid-ready')) canvas.setAttribute('data-fluid-ready', '');
    }

    function tick(now: number) {
      frame = 0;
      if (!canDraw() || reduced.matches) return;
      if (now >= nextDraw - 1) {
        if (lastDraw) phase += Math.min(now - lastDraw, 80) * speed / 1000;
        // Keep the trigonometric inputs within mediump range without a phase jump.
        if (phase >= 200 * Math.PI) phase -= 200 * Math.PI;
        draw();
        lastDraw = now;
        nextDraw = Math.max(now, nextDraw) + frameInterval;
      }
      frame = requestAnimationFrame(tick);
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      lastDraw = 0;
      nextDraw = 0;
    }

    function refresh() {
      if (!canDraw()) {
        stop();
        return;
      }
      draw();
      if (reduced.matches) stop();
      else if (!frame) frame = requestAnimationFrame(tick);
    }

    function updatePalette() {
      if (!gl || !renderer) return;
      const style = getComputedStyle(root);
      const accent = readColor(style, '--stanza-accent');
      const highlight = readColor(style, '--stanza-accent-hover');
      hasPalette = Boolean(accent && highlight);
      if (!accent || !highlight) {
        canvas.removeAttribute('data-fluid-ready');
        refresh();
        return;
      }
      const settings = motion[normaliseBackgroundIntensity(root.dataset.backgroundIntensity)];
      speed = settings.speed;
      gl.uniform3fv(renderer.accent, accent);
      gl.uniform3fv(renderer.highlight, highlight);
      gl.uniform1f(renderer.depth, settings.depth);
      gl.uniform1f(renderer.lightMode, root.dataset.theme === 'light' ? 1 : 0);
      refresh();
    }

    function sizeViewport() {
      if (!gl || !renderer || !width || !height) return;
      const scale = Math.min(1, maxDimension / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(renderer.aspect, Math.max(0.72, Math.min(1.85, width / height)));
    }

    function onContextLost(event: Event) {
      event.preventDefault();
      stop();
      renderer = null;
      canvas.removeAttribute('data-fluid-ready');
    }

    function onContextRestored() {
      if (!gl) return;
      renderer = createRenderer(gl);
      sizeViewport();
      updatePalette();
    }

    const resize = new ResizeObserver(([entry]) => {
      ({ width, height } = entry.contentRect);
      sizeViewport();
      refresh();
    });
    resize.observe(canvas);
    const appearance = new MutationObserver(updatePalette);
    appearance.observe(root, {
      attributes: true, attributeFilter: ['data-theme', 'data-background-preset', 'data-background-intensity', 'style'],
    });
    document.addEventListener('visibilitychange', refresh);
    reduced.addEventListener('change', refresh);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    updatePalette();

    return () => {
      stop();
      resize.disconnect();
      appearance.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      reduced.removeEventListener('change', refresh);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      renderer?.dispose();
      canvas.removeAttribute('data-fluid-ready');
    };
  }, []);

  return <canvas ref={canvasRef} className="stanza-fluid-canvas" aria-hidden="true" />;
}
