/**
 * Anime4K WebGL 2.0 (GLSL ES 3.00) Shaders
 *
 * Implements high-performance anime upscaling and restoration passes:
 * - Vertex: Fullscreen quad rendering with configurable coordinate orientation.
 * - Passthrough: Direct copy (Mode: 'off').
 * - Fast Mode: 3x3 adaptive luma & edge gradient sharpening with strict anti-ringing (Mobile/iGPU friendly).
 * - Ultra Mode: Bilateral restorative filter + directional line push / thinning + anti-ringing (Desktop GPU).
 */

/**
 * Fullscreen Quad Vertex Shader (GLSL ES 3.00)
 */
export const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;

uniform int u_flipY;

out vec2 v_texCoord;

void main() {
    float y = (a_position.y + 1.0) * 0.5;
    if (u_flipY == 1) {
        y = 1.0 - y;
    }
    v_texCoord = vec2((a_position.x + 1.0) * 0.5, y);
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Passthrough Fragment Shader (GLSL ES 3.00) - Direct Video Copy
 */
export const PASSTHROUGH_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_texture;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    fragColor = texture(u_texture, v_texCoord);
}
`;

/**
 * Fast Mode Fragment Shader (GLSL ES 3.00)
 *
 * 3x3 kernel-based Anime4K adaptive luma & edge gradient sharpening with anti-ringing limiting.
 * Extremely lightweight and battery-friendly on mobile and integrated GPUs.
 */
export const FAST_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform float u_strength;

in vec2 v_texCoord;
out vec4 fragColor;

// Rec.709 Luminance
float getLuma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec2 dx = vec2(u_texelSize.x, 0.0);
    vec2 dy = vec2(0.0, u_texelSize.y);

    // 3x3 neighborhood samples
    vec4 c00 = texture(u_texture, v_texCoord - dx - dy);
    vec4 c10 = texture(u_texture, v_texCoord - dy);
    vec4 c20 = texture(u_texture, v_texCoord + dx - dy);

    vec4 c01 = texture(u_texture, v_texCoord - dx);
    vec4 c11 = texture(u_texture, v_texCoord);
    vec4 c21 = texture(u_texture, v_texCoord + dx);

    vec4 c02 = texture(u_texture, v_texCoord - dx + dy);
    vec4 c12 = texture(u_texture, v_texCoord + dy);
    vec4 c22 = texture(u_texture, v_texCoord + dx + dy);

    // Luminance calculation
    float l00 = getLuma(c00.rgb);
    float l10 = getLuma(c10.rgb);
    float l20 = getLuma(c20.rgb);
    float l01 = getLuma(c01.rgb);
    float l11 = getLuma(c11.rgb);
    float l21 = getLuma(c21.rgb);
    float l02 = getLuma(c02.rgb);
    float l12 = getLuma(c12.rgb);
    float l22 = getLuma(c22.rgb);

    // Sobel edge gradient magnitude
    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float grad = length(vec2(gx, gy));

    // Adaptive edge weight: sharpen distinct lines without amplifying noise in flat regions
    float edgeWeight = clamp(grad * 3.5, 0.0, 1.0);

    // Laplacian high-pass edge filter
    vec3 laplacian = 4.0 * c11.rgb - (c10.rgb + c01.rgb + c21.rgb + c12.rgb);
    vec3 sharpened = c11.rgb + laplacian * (u_strength * 0.35 * edgeWeight);

    // Anti-Ringing Clamping: strictly limits result to immediate neighborhood min & max colors
    vec3 minColor = min(c11.rgb, min(min(c10.rgb, c01.rgb), min(c21.rgb, c12.rgb)));
    vec3 maxColor = max(c11.rgb, max(max(c10.rgb, c01.rgb), max(c21.rgb, c12.rgb)));

    vec3 finalColor = clamp(sharpened, minColor, maxColor);
    fragColor = vec4(finalColor, c11.a);
}
`;

/**
 * Ultra Mode Fragment Shader (GLSL ES 3.00)
 *
 * High-definition Anime4K line reconstruct + directional edge push / thinning +
 * bilateral restorative filter for pristine, razor-sharp anime contours and clean cel-shading flats.
 */
export const ULTRA_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform float u_strength;

in vec2 v_texCoord;
out vec4 fragColor;

// Rec.709 Luminance
float getLuma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec2 dx = vec2(u_texelSize.x, 0.0);
    vec2 dy = vec2(0.0, u_texelSize.y);

    // 3x3 Neighborhood texture fetches
    vec4 c00 = texture(u_texture, v_texCoord - dx - dy);
    vec4 c10 = texture(u_texture, v_texCoord - dy);
    vec4 c20 = texture(u_texture, v_texCoord + dx - dy);

    vec4 c01 = texture(u_texture, v_texCoord - dx);
    vec4 c11 = texture(u_texture, v_texCoord);
    vec4 c21 = texture(u_texture, v_texCoord + dx);

    vec4 c02 = texture(u_texture, v_texCoord - dx + dy);
    vec4 c12 = texture(u_texture, v_texCoord + dy);
    vec4 c22 = texture(u_texture, v_texCoord + dx + dy);

    // Sample luminance values
    float l00 = getLuma(c00.rgb);
    float l10 = getLuma(c10.rgb);
    float l20 = getLuma(c20.rgb);
    float l01 = getLuma(c01.rgb);
    float l11 = getLuma(c11.rgb);
    float l21 = getLuma(c21.rgb);
    float l02 = getLuma(c02.rgb);
    float l12 = getLuma(c12.rgb);
    float l22 = getLuma(c22.rgb);

    // Sobel gradient vector
    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    vec2 gradVec = vec2(gx, gy);
    float gradLen = length(gradVec);

    // Bilateral Restorative Filter
    // Smooths compression noise and macroblocks in flat anime areas while retaining boundaries.
    const float invSigmaR2 = 1.0 / (2.0 * 0.12 * 0.12);

    vec3 bilateralColor = c11.rgb;
    float totalWeight = 1.0;

    // Cross neighbors (dist^2 = 1.0, spatial weight = exp(-1.0 / 2.0) = 0.6065)
    float ws1 = 0.6065;
    float w10 = ws1 * exp(-pow(l10 - l11, 2.0) * invSigmaR2);
    float w01 = ws1 * exp(-pow(l01 - l11, 2.0) * invSigmaR2);
    float w21 = ws1 * exp(-pow(l21 - l11, 2.0) * invSigmaR2);
    float w12 = ws1 * exp(-pow(l12 - l11, 2.0) * invSigmaR2);

    // Diagonal neighbors (dist^2 = 2.0, spatial weight = exp(-2.0 / 2.0) = 0.3679)
    float ws2 = 0.3679;
    float w00 = ws2 * exp(-pow(l00 - l11, 2.0) * invSigmaR2);
    float w20 = ws2 * exp(-pow(l20 - l11, 2.0) * invSigmaR2);
    float w02 = ws2 * exp(-pow(l02 - l11, 2.0) * invSigmaR2);
    float w22 = ws2 * exp(-pow(l22 - l11, 2.0) * invSigmaR2);

    bilateralColor += c10.rgb * w10 + c01.rgb * w01 + c21.rgb * w21 + c12.rgb * w12;
    bilateralColor += c00.rgb * w00 + c20.rgb * w20 + c02.rgb * w02 + c22.rgb * w22;
    totalWeight += (w10 + w01 + w21 + w12 + w00 + w20 + w02 + w22);
    bilateralColor /= totalWeight;

    // Directional Edge Push / Line Reconstruction:
    // Pushes coordinate samples along gradient towards the line center to thin blurred contours.
    vec3 reconstructed = bilateralColor;
    if (gradLen > 0.025) {
        vec2 dir = gradVec / gradLen;
        vec2 pushOffset = -dir * (u_texelSize * u_strength * 0.75 * clamp(gradLen * 3.0, 0.0, 1.25));
        vec4 pushedSample = texture(u_texture, v_texCoord + pushOffset);

        float edgeFactor = clamp(gradLen * 3.0, 0.0, 1.0);
        reconstructed = mix(bilateralColor, pushedSample.rgb, edgeFactor * 0.60);

        // High frequency edge Laplacian sharpening
        vec3 laplacian = 4.0 * c11.rgb - (c10.rgb + c01.rgb + c21.rgb + c12.rgb);
        reconstructed += laplacian * (u_strength * 0.35 * edgeFactor);
    }

    // Anti-Ringing Clamping (Anime4K guarantee):
    // Limits values between neighborhood min/max to eliminate overshoot and halo artifacts.
    vec3 minRgb = min(c11.rgb, min(min(min(c00.rgb, c10.rgb), min(c20.rgb, c01.rgb)), min(min(c21.rgb, c02.rgb), min(c12.rgb, c22.rgb))));
    vec3 maxRgb = max(c11.rgb, max(max(max(c00.rgb, c10.rgb), max(c20.rgb, c01.rgb)), max(max(c21.rgb, c02.rgb), max(c12.rgb, c22.rgb))));

    vec3 finalColor = clamp(reconstructed, minRgb, maxRgb);
    fragColor = vec4(finalColor, c11.a);
}
`;

/**
 * Compiles a WebGL shader from GLSL ES 3.00 source code.
 */
export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error(`Failed to allocate WebGL shader of type ${type}`);
  }

  gl.shaderSource(shader, source.trim());
  gl.compileShader(shader);

  const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!success) {
    const info = gl.getShaderInfoLog(shader) || 'Unknown compilation error';
    gl.deleteShader(shader);
    throw new Error(`GLSL compilation failed: ${info}`);
  }

  return shader;
}

/**
 * Creates and links a WebGL 2.0 program from vertex and fragment shader sources.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error('Failed to allocate WebGL program');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  // Shaders can be detached and flagged for deletion once linked into the program
  gl.detachShader(program, vertexShader);
  gl.detachShader(program, fragmentShader);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  const success = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!success) {
    const info = gl.getProgramInfoLog(program) || 'Unknown linker error';
    gl.deleteProgram(program);
    throw new Error(`GLSL program linking failed: ${info}`);
  }

  return program;
}
