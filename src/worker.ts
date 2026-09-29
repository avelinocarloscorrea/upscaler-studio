import WebSR from '@websr/websr';

import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
  InitData,
  NetworkData,
  Resolution
} from './types/worker-messages';

// Processors
import pipelineProcessor from './processors/pipeline-processor';

// Worker state
let gpu: any | false;
let websr: WebSR;
let upscaled_canvas: OffscreenCanvas;
let original_canvas: OffscreenCanvas;
let resolution: Resolution;
let ctx: ImageBitmapRenderingContext | null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;
let currentBitmap: ImageBitmap | null = null;
let renderQueue: Promise<void> = Promise.resolve();

function enqueueRender<T>(operation: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(operation, operation);
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}


const gpuEnums = globalThis as typeof globalThis & {
  GPUBufferUsage?: { COPY_DST: number; MAP_READ: number };
  GPUMapMode?: { READ: number };
  GPUTextureUsage?: { COPY_SRC: number; RENDER_ATTACHMENT: number };
};

// Default weights
const weights = require('./weights/cnn-2x-m-rl.json');

/**
 * Check if WebGPU is supported in this environment
 */
async function isSupported(): Promise<void> {
  gpu = await WebSR.initWebGPU();

  postMessage({
    cmd: 'isSupported',
    data: gpu !== false
  } satisfies WorkerResponseMessage);
}

/**
 * Initialize the worker with canvases and create WebSR instance
 */
async function init(config: InitData): Promise<void> {
  if (websr) {
    try { await websr.destroy(); } catch {}
  }

  if (!gpu) {
    gpu = await WebSR.initWebGPU();
  }

  websr = new WebSR({
    network_name: config.networkName as any,
    weights: config.weights,
    resolution: config.resolution,
    gpu: gpu,
    debug: false,
    canvas: config.upscaled as any // OffscreenCanvas is valid but types may be strict
  });

  const gpuTextureUsage = gpuEnums.GPUTextureUsage;
  const copySrcUsage = (gpuTextureUsage?.COPY_SRC ?? 4) | (gpuTextureUsage?.RENDER_ATTACHMENT ?? 16);
  try {
    websr.context.context.configure({
      device: websr.context.device,
      format: (navigator as any).gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm',
      usage: copySrcUsage,
    });
  } catch (err) {
    console.warn('Could not configure WebGPU canvas usage:', err);
  }

  resolution = config.resolution;
  upscaled_canvas = config.upscaled;
  original_canvas = config.original;

  if (currentBitmap && currentBitmap !== config.bitmap) {
    try { currentBitmap.close(); } catch {}
  }
  currentBitmap = config.bitmap;

  ctx = original_canvas.getContext('bitmaprenderer');

  const bitmap2 = await createImageBitmap(config.bitmap, {
    resizeHeight: config.resolution.height * 2,
    resizeWidth: config.resolution.width * 2,
  });

  await websr.render(config.bitmap as any);
  await websr.context.device.queue.onSubmittedWorkDone();

  if (ctx) {
    ctx.transferFromImageBitmap(bitmap2);
  }
  postMessage({ cmd: 'ready' } satisfies WorkerResponseMessage);
}

/**
 * Switch to a different AI upscaling network
 */
async function switchNetwork(name: string, weights: any, bitmap: ImageBitmap): Promise<void> {
  if (currentBitmap && currentBitmap !== bitmap) {
    try { currentBitmap.close(); } catch {}
  }
  currentBitmap = bitmap;
  websr.switchNetwork(name as any, weights);

  // Keep the original and enhanced layers on the exact same selected video frame.
  const originalFrame = await createImageBitmap(bitmap, {
    resizeHeight: resolution.height * 2,
    resizeWidth: resolution.width * 2,
  });
  await websr.render(bitmap as any);
  await websr.context.device.queue.onSubmittedWorkDone();
  if (ctx) ctx.transferFromImageBitmap(originalFrame);
  else originalFrame.close();
}

async function exportUpscaledImage(targetResolution?: string): Promise<Blob> {
  if (currentBitmap) {
    await websr.render(currentBitmap as any);
  }

  const device = websr.context.device;
  const texture = websr.context.context.getCurrentTexture();
  const width = resolution.width * 2;
  const height = resolution.height * 2;
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const bufferUsage = (gpuEnums.GPUBufferUsage?.COPY_DST ?? 8) | (gpuEnums.GPUBufferUsage?.MAP_READ ?? 1);
  const readBuffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: bufferUsage,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await readBuffer.mapAsync(gpuEnums.GPUMapMode?.READ ?? 1);

  const source = new Uint8Array(readBuffer.getMappedRange());
  const pixels = new Uint8ClampedArray(width * height * 4);
  const isBgra = texture.format.startsWith('bgra');
  for (let row = 0; row < height; row++) {
    const sourceRow = row * bytesPerRow;
    const targetRow = row * width * 4;
    for (let column = 0; column < width; column++) {
      const sourcePixel = sourceRow + column * 4;
      const targetPixel = targetRow + column * 4;
      pixels[targetPixel] = source[sourcePixel + (isBgra ? 2 : 0)];
      pixels[targetPixel + 1] = source[sourcePixel + 1];
      pixels[targetPixel + 2] = source[sourcePixel + (isBgra ? 0 : 2)];
      pixels[targetPixel + 3] = source[sourcePixel + 3];
    }
  }
  readBuffer.unmap();
  readBuffer.destroy();

  const outputCanvas = new OffscreenCanvas(width, height);
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) throw new Error('Não foi possível criar a imagem PNG de saída.');
  outputContext.putImageData(new ImageData(pixels, width, height), 0, 0);

  if (targetResolution && targetResolution !== '2x') {
      const targetHeight = parseInt(targetResolution, 10);
      let targetWidth = Math.round((width / height) * targetHeight);
      if (targetWidth % 2 !== 0) targetWidth += 1;
      const resizeCanvas = new OffscreenCanvas(targetWidth, targetHeight);
      const resizeCtx = resizeCanvas.getContext('2d');
      if (resizeCtx) {
          resizeCtx.drawImage(outputCanvas, 0, 0, targetWidth, targetHeight);
          return resizeCanvas.convertToBlob({ type: 'image/png' });
      }
  }

  return outputCanvas.convertToBlob({ type: 'image/png' });
}






// Processing functions moved to processors/

/** Preserve useful details when a browser or GPU API rejects with a non-Error value. */
function describeWorkerError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
    try {
      const details = JSON.stringify(error);
      if (details && details !== '{}') return details;
    } catch {
      // Fall through to a readable string representation.
    }
  }
  return error == null ? 'O processamento falhou sem detalhes.' : `O processamento falhou: ${String(error)}`;
}

/**
 * Worker message handler with type-safe message routing
 */
self.onmessage = async function (event: MessageEvent<WorkerRequestMessage>) {
  if (!event.data.cmd) return;

  try {
    switch (event.data.cmd) {
    case 'init':
      await init(event.data.data);
      break;

    case 'isSupported':
      await isSupported();
      break;

    case 'pause':
      if (!pauseLock) {
        pauseLock = new Promise(resolve => { resolvePause = resolve; });
        postMessage({ cmd: 'paused' } satisfies WorkerResponseMessage);
      }
      break;

    case 'resume':
      if (pauseLock && resolvePause) {
        resolvePause();
        pauseLock = null;
        resolvePause = null;
        postMessage({ cmd: 'resumed' } satisfies WorkerResponseMessage);
      }
      break;

    case 'process':
      await pipelineProcessor({
        inputFile: event.data.inputFile,
        outputHandle: event.data.outputHandle,
        targetResolution: event.data.targetResolution,
        websr,
        upscaled_canvas,
        original_canvas,
        resolution,
        getPauseLock: () => pauseLock
      });
      break;

    case 'export-image': {
      const blob = await exportUpscaledImage(event.data.targetResolution);
      postMessage({ cmd: 'image-finished', data: blob } satisfies WorkerResponseMessage);
      break;
    }

    case 'preview-image': {
      const request = event.data;
      const blob = await enqueueRender(() => exportUpscaledImage(request.targetResolution));
      postMessage({ cmd: 'preview-image', data: { requestId: request.requestId, blob } } satisfies WorkerResponseMessage);
      break;
    }

    case 'network': {
      const request = event.data.data;
      await enqueueRender(() => switchNetwork(
        request.name,
        request.weights,
        request.bitmap
      ));
      postMessage({ cmd: 'network-ready', data: request.requestId } satisfies WorkerResponseMessage);
      break;
    }
    }
  } catch (error) {
    postMessage({
      cmd: 'error',
      data: describeWorkerError(error),
    } satisfies WorkerResponseMessage);
  }
};
