// 着色器源码：顶点共用，片元按工序拆分
// 关键约定：工作纹理为线性光 RGBA16F，A 通道累计版块索引（用于色差定位）

export const VERT_FULLSCREEN = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

// 纸基初始化：线性光纸色写入 RGB，A=0（无版块）
export const FS_PAPER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3 u_paperLinear;
out vec4 outColor;
void main() {
  outColor = vec4(u_paperLinear, 0.0);
}
`

// 色版印制：Beer-Lambert 透明叠色
// mask 为已含晕化与纸纹颗粒的覆盖率；按纸伸缩与套准偏差偏移采样
export const FS_PRINT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_acc;      // 累计结果（线性光）
uniform sampler2D u_mask;     // R8 版块覆盖率
uniform vec3 u_absorbance;    // 每通道吸收系数 A
uniform float u_passes;       // 刷色遍数
uniform vec2 u_uvOffset;      // 套准偏差（UV）
uniform vec2 u_expansion;     // 纸张伸缩（UV 缩放修正）
uniform float u_plateIndex;   // 版块序号写入 A 通道
out vec4 outColor;

void main() {
  vec4 acc = texture(u_acc, v_uv);
  // 纸受潮纤维涨开（expansion>1），刻版图文相对纸边向内收：先按中心反向缩放，再叠加套准偏移
  vec2 sampleUv = (v_uv - 0.5) / u_expansion + 0.5 + u_uvOffset;
  float coverage = texture(u_mask, sampleUv).r;
  float effective = coverage * u_passes;
  vec3 transmittance = exp(-u_absorbance * effective);
  vec3 printed = acc.rgb * transmittance;
  // A 通道记录"最后一次落色"的版块索引，供色差问题定位
  float plateId = mix(acc.a, u_plateIndex, step(0.02, coverage));
  outColor = vec4(printed, plateId);
}
`

// 拱花：高度图叠加入总高度（R 通道），G 通道累计强度
export const FS_EMBOSS_ACC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_height;
uniform sampler2D u_mask;
uniform float u_strength;
uniform vec2 u_uvOffset;
uniform vec2 u_expansion;
out vec4 outColor;
void main() {
  vec4 acc = texture(u_height, v_uv);
  vec2 sampleUv = (v_uv - 0.5) / u_expansion + 0.5 + u_uvOffset;
  float h = texture(u_mask, sampleUv).r;
  outColor = vec4(acc.r + h * u_strength, max(acc.g, h), 0.0, 0.0);
}
`

// 拱花侧光：法线由高度差分得到，正面光（仰角 90 度）几乎无阴影
export const FS_EMBOSS_LIGHT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_acc;
uniform sampler2D u_height;
uniform vec2 u_texel;
uniform vec3 u_lightDir;    // 指向光源的单位向量
uniform float u_intensity;
uniform float u_ambient;
out vec4 outColor;
void main() {
  vec4 acc = texture(u_acc, v_uv);
  float hl = texture(u_height, v_uv - vec2(u_texel.x, 0.0)).r;
  float hr = texture(u_height, v_uv + vec2(u_texel.x, 0.0)).r;
  float hu = texture(u_height, v_uv + vec2(0.0, u_texel.y)).r;
  float hd = texture(u_height, v_uv - vec2(0.0, u_texel.y)).r;
  // 无凹凸区域（及邻域）严格保持纸色，只在压痕处施加侧光明暗
  float hasRelief = max(max(hl, hr), max(hu, hd));
  vec3 normal = normalize(vec3(hl - hr, hd - hu, 2.0));
  float diffuse = max(dot(normal, u_lightDir), 0.0);
  float shade = u_ambient + u_intensity * diffuse;
  vec3 lit = acc.rgb * shade;
  outColor = vec4(mix(acc.rgb, lit, step(0.0005, hasRelief)), acc.a);
}
`

// 线性光转 sRGB 输出到画布
export const FS_TONEMAP = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_acc;
out vec4 outColor;
vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
void main() {
  vec4 acc = texture(u_acc, v_uv);
  outColor = vec4(clamp(linearToSrgb(acc.rgb), 0.0, 1.0), 1.0);
}
`
