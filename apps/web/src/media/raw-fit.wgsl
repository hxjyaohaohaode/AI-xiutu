struct Geometry {
  // Original width/height and display width/height.
  size: vec4<u32>,
  // Integer average factor, reduced axis length, Lanczos coefficient count.
  y: vec4<u32>,
  x: vec4<u32>,
}

@group(0) @binding(0) var<storage, read> sourceCodes: array<u32>;
@group(0) @binding(1) var<storage, read> normalized: array<f32>;
@group(0) @binding(2) var<uniform> geo: Geometry;
@group(0) @binding(3) var<storage, read> grade: array<f32>;
@group(0) @binding(4) var<storage, read_write> vertical: array<vec2<u32>>;
@group(0) @binding(5) var<storage, read_write> horizontal: array<vec2<u32>>;
@group(0) @binding(6) var<storage, read> yKernel: array<i32>;
@group(0) @binding(7) var<storage, read> xKernel: array<i32>;
@group(0) @binding(8) var<storage, read_write> output: array<vec2<u32>>;
@group(0) @binding(9) var<storage, read> display: array<vec2<u32>>;

// The versioned recipe is compiled by raw-fit-parameters.ts. Keep the region
// and curve order of the scene-linear reference engine.
const curveOffset = 16u;
const curveStride = 32u;
const regionOffset = 144u;
const regionStride = 20u;

fn sample(index: u32) -> f32 {
  let word = sourceCodes[index / 2u];
  let code = (word >> ((index % 2u) * 16u)) & 65535u;
  return normalized[code];
}

fn luma(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

fn adjust(source: vec3<f32>, offset: u32) -> vec3<f32> {
  var rgb = source * vec3(grade[offset], grade[offset + 1u], grade[offset + 2u]);
  let shadows = grade[offset + 3u];
  let highlights = grade[offset + 4u];
  let contrast = grade[offset + 5u];
  let saturation = grade[offset + 6u];
  if (shadows != 0.0 || highlights != 0.0 || contrast != 0.0 || saturation != 1.0) {
    let signedY = luma(rgb);
    let y = max(signedY, 0.0);
    let highlight = y / (y + 0.18);
    var gain = exp2(shadows * (1.0 - highlight) + highlights * highlight);
    if (y > 0.0 && contrast != 0.0) {
      gain *= pow(y / 0.18, contrast);
    }
    if (saturation != 1.0) {
      rgb = vec3(signedY) + (rgb - vec3(signedY)) * saturation;
    }
    rgb *= gain;
  }
  return rgb;
}

fn curveGain(value: f32, channel: u32) -> f32 {
  let count = u32(grade[8u + channel]);
  if (value <= 0.0 || count == 0u) {
    return 1.0;
  }
  let stop = log2(value / 0.18);
  let first = curveOffset + channel * curveStride;
  if (stop <= grade[first]) {
    return exp2(grade[first + 1u]);
  }
  for (var index = 1u; index < count; index++) {
    let right = first + index * 2u;
    if (stop <= grade[right]) {
      let left = right - 2u;
      let fraction = (stop - grade[left]) / (grade[right] - grade[left]);
      return exp2(mix(grade[left + 1u], grade[right + 1u], fraction));
    }
  }
  return exp2(grade[first + (count - 1u) * 2u + 1u]);
}

fn maskWeight(point: vec2<f32>, offset: u32) -> f32 {
  let kind = u32(grade[offset]);
  let delta = point - vec2(grade[offset + 4u], grade[offset + 5u]);
  let axis = vec2(grade[offset + 6u], grade[offset + 7u]);
  var weight = 0.0;
  if (kind == 1u) {
    weight = clamp(dot(delta, axis), 0.0, 1.0);
    if (grade[offset + 3u] != 0.0) {
      weight = smoothstep(0.0, 1.0, weight);
    }
  } else {
    let rotated = vec2(dot(delta, axis), dot(delta, vec2(grade[offset + 8u], grade[offset + 9u])));
    var distance = length(rotated);
    if (kind == 3u) {
      distance = max(abs(rotated.x), abs(rotated.y));
    }
    if (kind == 4u) {
      distance = abs(rotated.x) + abs(rotated.y);
    }
    let feather = grade[offset + 10u];
    if (feather > 0.0) {
      weight = smoothstep(0.0, 1.0, (1.0 - distance) / feather);
    } else {
      weight = select(0.0, 1.0, distance < 1.0);
    }
  }
  if (grade[offset + 2u] != 0.0) {
    weight = 1.0 - weight;
  }
  return weight * grade[offset + 1u];
}

fn develop(source: vec3<f32>, point: vec2<f32>) -> vec3<u32> {
  var rgb = adjust(source, 0u);
  rgb *= curveGain(luma(rgb), 0u);
  rgb *= vec3(curveGain(rgb.r, 1u), curveGain(rgb.g, 2u), curveGain(rgb.b, 3u));
  for (var index = 0u; index < u32(grade[12u]); index++) {
    let offset = regionOffset + index * regionStride;
    let weight = maskWeight(point, offset);
    if (weight > 0.0) {
      rgb = mix(rgb, adjust(rgb, offset + 12u), weight);
    }
  }
  if (grade[7u] != 0.0) {
    rgb /= 1.0 + max(0.0, luma(rgb));
  }
  rgb = clamp(rgb, vec3(0.0), vec3(1.0));
  let encoded = select(
    1.055 * pow(rgb, vec3(1.0 / 2.4)) - 0.055,
    12.92 * rgb,
    rgb <= vec3(0.0031308),
  );
  return vec3<u32>(round(encoded * 65535.0));
}

fn pack(rgb: vec3<u32>) -> vec2<u32> {
  return vec2(rgb.r | (rgb.g << 16u), rgb.b);
}

fn unpack(value: vec2<u32>) -> vec3<i32> {
  return vec3<i32>(vec3(value.x & 65535u, value.x >> 16u, value.y));
}

fn roundedQ12(sum: vec3<i32>) -> vec3<i32> {
  return clamp((sum + vec3(2048)) >> vec3(12u), vec3(0), vec3(65535));
}

@compute @workgroup_size(16, 8)
fn developRows(@builtin(global_invocation_id) pos: vec3<u32>) {
  if (pos.x >= geo.size.x || pos.y >= geo.y.y) { return; }
  let count = geo.y.x;
  var sum = vec3<u32>(0u);
  for (var dy = 0u; dy < count; dy++) {
    let y = min(pos.y * count + dy, geo.size.y - 1u);
    let index = (y * geo.size.x + pos.x) * 3u;
    let original = vec3(sample(index), sample(index + 1u), sample(index + 2u));
    let point = (vec2<f32>(vec2(pos.x, y)) + 0.5) / vec2<f32>(geo.size.xy);
    sum += develop(original, point);
  }
  vertical[pos.y * geo.size.x + pos.x] = pack((sum + vec3(count / 2u)) / count);
}

@compute @workgroup_size(16, 8)
fn reduceRows(@builtin(global_invocation_id) pos: vec3<u32>) {
  if (pos.x >= geo.x.y || pos.y >= geo.size.w) { return; }
  let table = pos.y * (geo.y.z + 1u);
  let first = yKernel[table];
  let count = geo.x.x;
  var total = vec3<i32>(0);
  for (var dx = 0u; dx < count; dx++) {
    let x = min(pos.x * count + dx, geo.size.x - 1u);
    var sum = vec3<i32>(0);
    for (var tap = 0u; tap < geo.y.z; tap++) {
      let y = u32(clamp(first + i32(tap), 0, i32(geo.y.y) - 1));
      sum += unpack(vertical[y * geo.size.x + x]) * yKernel[table + tap + 1u];
    }
    total += roundedQ12(sum);
  }
  horizontal[pos.y * geo.x.y + pos.x] = pack(vec3<u32>((total + vec3(i32(count / 2u))) / i32(count)));
}

@compute @workgroup_size(16, 8)
fn reduceColumns(@builtin(global_invocation_id) pos: vec3<u32>) {
  if (pos.x >= geo.size.z || pos.y >= geo.size.w) { return; }
  let table = pos.x * (geo.x.z + 1u);
  let first = xKernel[table];
  var sum = vec3<i32>(0);
  for (var tap = 0u; tap < geo.x.z; tap++) {
    let x = u32(clamp(first + i32(tap), 0, i32(geo.x.y) - 1));
    sum += unpack(horizontal[pos.y * geo.x.y + x]) * xKernel[table + tap + 1u];
  }
  output[pos.y * geo.size.z + pos.x] = pack(vec3<u32>(roundedQ12(sum)));
}

@vertex
fn draw(@builtin(vertex_index) at: u32) -> @builtin(position) vec4<f32> {
  let points = array(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  return vec4(points[at], 0.0, 1.0);
}

@fragment
fn pixel(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let code = unpack(display[u32(pos.y) * geo.size.z + u32(pos.x)]);
  return vec4(vec3<f32>(code) / 65535.0, 1.0);
}
