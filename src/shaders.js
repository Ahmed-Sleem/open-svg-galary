import { ShaderMaterial, DoubleSide } from "../vendor/three.js";

export const planeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// All doodles share a unit quad and are drawn in one instanced batch per SVG.
// Position, wrapping, float, spin, and hover scale are calculated on the GPU.
export const instancedVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aPhase;
  attribute float aBobSpeed;
  attribute float aSpinSpeed;
  attribute float aHover;
  uniform vec2 uPan;
  uniform vec2 uTile;
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  varying float vHover;

  float wrap1(float value, float span) {
    return mod(value + span * 0.5, span) - span * 0.5;
  }

  void main() {
    vUv = uv;
    vSeed = aSeed;
    vHover = aHover;
    float angle = uTime * aSpinSpeed;
    float cs = cos(angle);
    float sn = sin(angle);
    vec2 local = position.xy * (1.0 + aHover * 0.5);
    local = mat2(cs, sn, -sn, cs) * local;
    vec4 world = modelMatrix * instanceMatrix * vec4(local, position.z, 1.0);
    vec4 center = modelMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    vec2 wrapped = vec2(
      wrap1(center.x + uPan.x, uTile.x),
      wrap1(center.y + uPan.y + sin(uTime * aBobSpeed + aPhase) * 0.25, uTile.y)
    );
    // Wrap only the instance center, never individual vertices (which would stretch at tile seams).
    world.xy += wrapped - center.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Shared trigonometric terms keep the liquid-metal highlight, but avoid
// recalculating the same per-pixel wobble separately for every colour channel.
export const chromeFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uMode;
  varying vec2 vUv;
  varying float vSeed;
  varying float vHover;

  vec3 linearToSrgb(vec3 color) {
    vec3 low = color * 12.92;
    vec3 high = 1.055 * pow(max(color, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(high, low, step(color, vec3(0.0031308)));
  }

  void main() {
    vec4 source = texture2D(uMap, vUv);
    if (source.a < 0.01) discard;
    if (uMode > 0.5) {
      // Render untouched source colours. A tiny neutral edge glint keeps
      // black SVG strokes visible against the dark universe without recolouring them.
      float neighbouringAlpha = max(
        max(texture2D(uMap, vUv + vec2(0.014, 0.0)).a, texture2D(uMap, vUv - vec2(0.014, 0.0)).a),
        max(texture2D(uMap, vUv + vec2(0.0, 0.014)).a, texture2D(uMap, vUv - vec2(0.0, 0.014)).a)
      );
      float luminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
      float darkInk = 1.0 - smoothstep(0.015, 0.18, luminance);
      float edgeLight = clamp(neighbouringAlpha - source.a, 0.0, 1.0) * darkInk * 0.78;
      vec3 trueColour = linearToSrgb(source.rgb);
      vec3 edgeColour = mix(vec3(0.68, 0.75, 0.87), trueColour, source.a);
      gl_FragColor = vec4(edgeColour, max(source.a, edgeLight));
      return;
    }
    vec2 p = vUv - 0.5;
    float axis = p.x * 0.8 + p.y * 0.6;
    float radius = length(p);
    float wobble =
      sin(p.y * 9.0 + uTime * 1.1 + vSeed) * 0.09 +
      sin(p.x * 7.0 - uTime * 0.8 + vSeed * 2.0) * 0.09;
    float phase = (axis + radius * 0.55 + wobble) * 22.0 - uTime * 1.4 + vSeed * 6.2831;
    float red = pow(sin(phase + 0.264) * 0.5 + 0.5, 1.4);
    float green = pow(sin(phase) * 0.5 + 0.5, 1.4);
    float blue = pow(sin(phase - 0.264) * 0.5 + 0.5, 1.4);
    vec3 chrome = mix(vec3(0.38, 0.38, 0.44), vec3(1.0), vec3(red, green, blue));
    chrome += vHover * 0.18;
    gl_FragColor = vec4(chrome, source.a * 0.96);
  }
`;

export function chromeMaterial(texture, sharedUniforms = {}) {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uTime: { value: 0 },
      uPan: { value: null },
      uTile: { value: null },
      uMode: { value: 0 },
      ...sharedUniforms,
    },
    vertexShader: instancedVertex,
    fragmentShader: chromeFragment,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

export const dustVertex = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform vec2 uPan;
  uniform vec2 uTile;
  uniform float uTime;
  varying float vAlpha;

  vec2 wrap2(vec2 p, vec2 size) {
    return mod(p + size * 0.5, size) - size * 0.5;
  }

  void main() {
    vec3 pos = position;
    pos.xy = wrap2(pos.xy + uPan, uTile);
    pos.y += sin(uTime * 0.25 + aSeed * 6.2831) * 0.5;
    pos.x += cos(uTime * 0.18 + aSeed * 12.566) * 0.35;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (190.0 / -mv.z);
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.4 + aSeed) + aSeed * 40.0);
    float depthFade = clamp((34.0 + pos.z) / 34.0, 0.2, 1.0);
    vAlpha = twinkle * depthFade;
    gl_Position = projectionMatrix * mv;
  }
`;

export const dustFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    float distanceFromCenter = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.05, distanceFromCenter);
    gl_FragColor = vec4(vec3(0.75, 0.78, 0.92), alpha * vAlpha * 0.35);
  }
`;

export const shootingStarFragment = /* glsl */ `
  uniform float uLife;
  varying vec2 vUv;
  void main() {
    float tail = pow(vUv.x, 2.5);
    float core = smoothstep(0.5, 0.0, abs(vUv.y - 0.5));
    float flight = sin(3.14159 * uLife);
    gl_FragColor = vec4(vec3(0.9, 0.93, 1.0), tail * core * flight * 0.85);
  }
`;
