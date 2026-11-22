// WebGL2 基础工具：上下文、程序编译、全屏三角、纹理/FBO 管理

export const createGl = (canvas: HTMLCanvasElement): WebGL2RenderingContext => {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  })
  if (!gl) throw new Error('当前浏览器不支持 WebGL2')
  return gl
}

export const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('着色器创建失败')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`着色器编译失败: ${log}`)
  }
  return shader
}

export const createProgram = (
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource)
  const program = gl.createProgram()
  if (!program) throw new Error('程序创建失败')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`程序链接失败: ${log}`)
  }
  return program
}

// 全屏三角的 VAO，覆盖裁剪空间
export const createFullscreenVao = (gl: WebGL2RenderingContext): WebGLVertexArrayObject => {
  const vao = gl.createVertexArray()
  if (!vao) throw new Error('VAO 创建失败')
  const vbo = gl.createBuffer()
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  )
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  return vao
}

export interface Fbo {
  framebuffer: WebGLFramebuffer
  texture: WebGLTexture
  width: number
  height: number
}

// 浮点颜色附件（RGBA16F），需要 EXT_color_buffer_float
export const createFloatFbo = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): Fbo => {
  const texture = gl.createTexture()
  if (!texture) throw new Error('纹理创建失败')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, width, height)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const framebuffer = gl.createFramebuffer()
  if (!framebuffer) throw new Error('FBO 创建失败')
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  )
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('浮点 FBO 不完整，检查 EXT_color_buffer_float 支持')
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { framebuffer, texture, width, height }
}

export const deleteFbo = (gl: WebGL2RenderingContext, fbo: Fbo): void => {
  gl.deleteFramebuffer(fbo.framebuffer)
  gl.deleteTexture(fbo.texture)
}

export const drawFullscreen = (gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject): void => {
  gl.bindVertexArray(vao)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindVertexArray(null)
}
