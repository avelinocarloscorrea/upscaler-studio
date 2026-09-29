import Alpine from 'alpinejs';
import type { WorkerRequestMessage, WorkerResponseMessage } from './types/worker-messages';

import "./index.css";

const MAX_FILE_BLOB_SIZE=1900*1024*1024; //Just under 2GB, max ArrayBufferSize
const THEME_KEY = 'upscaler-studio-theme';
const ACRYLIC_KEY = 'upscaler-studio-acrylic';
const PANEL_LEFT_KEY = 'upscaler-studio-hide-left';
const PANEL_RIGHT_KEY = 'upscaler-studio-hide-right';
const ACERVO_URL = 'https://www.esmeraldapaper.com.br/ferramentas/';

function readPreference(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

function savePreference(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { }
}

// Web Worker for video processing
const worker = new Worker(new URL('./worker.ts', import.meta.url));
let resolveWebGPUSupport!: (supported: boolean) => void;
const webGPUSupport = new Promise<boolean>((resolve) => { resolveWebGPUSupport = resolve; });

// Canvas and video elements
let upscaled_canvas: HTMLCanvasElement;
let original_canvas: HTMLCanvasElement;
let video: HTMLVideoElement;
let currentMediaFile: File;
let mediaKind: 'video' | 'image' = 'video';
let mediaWidth = 0;
let mediaHeight = 0;
let previewUrl: string | null = null;
let previewSeekVersion = 0;
let resolveWorkerReady!: () => void;
let workerReady = new Promise<void>((resolve) => { resolveWorkerReady = resolve; });

function resetWorkerReady(): void {
    workerReady = new Promise<void>((resolve) => { resolveWorkerReady = resolve; });
}

// Network selection
type NetworkSize = 'small' | 'medium' | 'large';
type ContentType = 'rl' | 'an' | '3d';

let size: NetworkSize = 'medium';
let content: ContentType = 'rl';

// Video data
let download_name: string;
let inputFile: File;

// Model weights grouped by processing profile and content type
type WeightsMap = {
    [K in NetworkSize]: {
        [C in ContentType]: any;
    };
};

const weights: WeightsMap = {
    'large': {
        'rl': require('./weights/cnn-2x-l-rl.json'),
        'an': require('./weights/cnn-2x-l-an.json'),
        '3d': require('./weights/cnn-2x-l-3d.json'),
    },
    'medium': {
        'rl': require('./weights/cnn-2x-m-rl.json'),
        'an': require('./weights/cnn-2x-m-an.json'),
        '3d': require('./weights/cnn-2x-m-3d.json'),
    },
    'small': {
        'rl': require('./weights/cnn-2x-s-rl.json'),
        'an': require('./weights/cnn-2x-s-an.json'),
        '3d': require('./weights/cnn-2x-s-3d.json'),
    }
};

// Network name mapping
const networks: Record<NetworkSize, { name: string }> = {
    'small': {
        name: "anime4k/cnn-2x-s",
    },
    'medium': {
        name: "anime4k/cnn-2x-m",
    },
    'large': {
        name: "anime4k/cnn-2x-l",
    }
};

// Declare global window functions for Alpine to call and File System Access API
declare global {
    interface Window {
        chooseFile: () => void;
        initRecording: () => Promise<void>;
        fullScreenPreview: (e?: Event) => Promise<void>;
        switchNetworkSize: (el: HTMLInputElement) => Promise<void>;
        switchNetworkStyle: (el: HTMLInputElement) => Promise<void>;
        switchTargetRes: (res: string) => void;
        showSaveFilePicker: (options?: any) => Promise<FileSystemFileHandle>;
        togglePause: () => void;
        togglePanel: (side: 'left' | 'right', forceHidden?: boolean) => void;
    }
}

let targetResolution = '2x';

document.addEventListener("DOMContentLoaded", bindMediaPicker, { once: true });
document.addEventListener("DOMContentLoaded", index);

/** Bind the browser-native picker before application startup can fail. */
function bindMediaPicker(): void {
    const input = document.getElementById('file-input') as HTMLInputElement | null;
    const button = document.getElementById('input-button');
    if (!input || !button) return;

    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.value = '';
        if (file) void loadMedia(file);
    });
}

//===================  Initial Load ===========================

/**
 * Main initialization function called on page load
 */
async function index(): Promise<void> {
    Alpine.store('state', 'init');
    Alpine.store('mediaKind', 'video');
    Alpine.store('outWidth', 0);
    Alpine.store('outHeight', 0);

    Alpine.start();

    const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    const savedTheme = readPreference(THEME_KEY);
    const theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system';
    const themeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="theme"]'));
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const applyTheme = (mode: string, persist = false) => {
        const selected = mode === 'light' || mode === 'dark' ? mode : 'system';
        const dark = selected === 'dark' || (selected === 'system' && themeMedia.matches);
        document.documentElement.dataset.theme = selected;
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        themeInputs.forEach((input) => { input.checked = input.value === selected; });
        if (themeColor) themeColor.content = dark ? '#1d2023' : '#fbfaf7';
        if (persist) savePreference(THEME_KEY, selected);
    };
    applyTheme(theme);
    themeInputs.forEach((input) => input.addEventListener('change', () => applyTheme(input.value, true)));
    themeMedia.addEventListener('change', () => {
        if (document.documentElement.dataset.theme === 'system') applyTheme('system');
    });

    const acrylicInputs = [document.getElementById('acrylic-toggle'), document.getElementById('menu-acrylic-toggle')]
        .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
    const acrylicEnabled = readPreference(ACRYLIC_KEY) === 'true';
    const setAcrylic = (enabled: boolean, persist = true) => {
        acrylicInputs.forEach((input) => { input.checked = enabled; });
        document.body.classList.toggle('acrylic', enabled);
        if (persist) savePreference(ACRYLIC_KEY, String(enabled));
    };
    setAcrylic(acrylicEnabled, false);
    acrylicInputs.forEach((input) => input.addEventListener('change', () => setAcrylic(input.checked)));

    const brandLink = document.getElementById('brandLink');
    if (brandLink instanceof HTMLAnchorElement) {
        brandLink.href = ACERVO_URL;
        brandLink.target = '_blank';
    }
    const app = document.getElementById('app') as HTMLDivElement;
    const menu = document.getElementById('menu') as HTMLDivElement;
    const moreButton = document.getElementById('b_more') as HTMLButtonElement;
    const closeMenu = (restoreFocus = false) => {
        menu.hidden = true;
        moreButton.setAttribute('aria-expanded', 'false');
        if (restoreFocus) moreButton.focus();
    };
    app.addEventListener('transitionend', (event) => {
        if (event.target === app && event.propertyName === 'grid-template-columns') {
            fitZoom = computeFitZoom();
            if (zoom <= fitZoom * 1.01) zoomFit();
        }
    });
    (['left', 'right'] as const).forEach((side) => {
        const key = side === 'left' ? PANEL_LEFT_KEY : PANEL_RIGHT_KEY;
        const button = document.getElementById(side === 'left' ? 'm_toggle_left' : 'm_toggle_right') as HTMLButtonElement;
        const hidden = readPreference(key) === 'true';
        app.classList.toggle(`hide-${side}`, hidden);
        updatePanelMenuLabel(side, hidden);
        button.addEventListener('click', () => {
            togglePanel(side);
            closeMenu();
        });
    });
    moreButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const opening = menu.hidden;
        menu.hidden = !opening;
        moreButton.setAttribute('aria-expanded', String(opening));
        if (opening) menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    document.addEventListener('pointerdown', (event) => {
        if (!menu.hidden && !menu.contains(event.target as Node) && !moreButton.contains(event.target as Node)) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (menu.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu(true);
            return;
        }
        const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], #menu-acrylic-toggle'))
            .filter((item) => item.offsetParent !== null);
        const currentIndex = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = (currentIndex + direction + items.length) % items.length;
            items[nextIndex]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
        }
    });
    document.getElementById('m_choose')?.addEventListener('click', () => { closeMenu(); void chooseFile(); });
    document.getElementById('m_appearance')?.addEventListener('click', () => {
        closeMenu();
        (document.getElementById('appearance-dialog') as HTMLDialogElement | null)?.showModal();
    });
    document.getElementById('m_privacy')?.addEventListener('click', () => {
        closeMenu();
        (document.getElementById('privacy-dialog') as HTMLDialogElement | null)?.showModal();
    });
    document.getElementById('m_about')?.addEventListener('click', () => {
        closeMenu();
        (document.getElementById('about-dialog') as HTMLDialogElement | null)?.showModal();
    });
    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => closeMenu()));
    document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((button) => {
        button.addEventListener('click', () => button.closest('dialog')?.close());
    });

    const rail = document.getElementById('rail');
    rail?.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-pane]');
        if (!button) return;

        const wasActive = button.classList.contains('on');

        if (wasActive) {
            togglePanel('left');
        } else {
            rail.querySelectorAll<HTMLButtonElement>('button[data-pane]').forEach((tab) => {
                const selected = tab === button;
                tab.classList.toggle('on', selected);
                tab.setAttribute('aria-selected', String(selected));
                document.querySelector<HTMLElement>(`[data-pane="${tab.dataset.pane}"][role="tabpanel"]`)?.toggleAttribute('hidden', !selected);
            });
            togglePanel('left', false);
        }
    });

    upscaled_canvas = document.getElementById("upscaled") as HTMLCanvasElement;
    original_canvas = document.getElementById('original') as HTMLCanvasElement;
    const compareSlider = document.getElementById('compare-slider') as HTMLInputElement;
    compareSlider.addEventListener('input', () => setComparePosition(Number(compareSlider.value)));
    setComparePosition(Number(compareSlider.value));
    document.addEventListener('fullscreenchange', () => requestAnimationFrame(fitComparison));

    worker.postMessage({ cmd: 'isSupported' } satisfies WorkerRequestMessage);

    window.chooseFile = chooseFile;
    window.initRecording = initRecording;
    window.fullScreenPreview = fullScreenPreview;
    window.togglePause = togglePause;
    window.addEventListener('dragover', (e: DragEvent) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            document.body.classList.add('dropping');
        }
    });
    window.addEventListener('dragleave', (e: DragEvent) => {
        if (e.relatedTarget === null) {
            document.body.classList.remove('dropping');
        }
    });
    window.addEventListener('drop', (e: DragEvent) => {
        document.body.classList.remove('dropping');
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void loadMedia(file);
    });

    window.switchNetworkSize = async (input: HTMLInputElement) => {
        if (input.value !== size) {
            size = input.value as NetworkSize;
            await updateNetwork();
        }
    };
    window.switchNetworkStyle = async (input: HTMLInputElement) => {
        if (input.value !== content) {
            content = input.value as ContentType;
            await updateNetwork();
        }
    };
    window.switchTargetRes = (res: string) => {
        targetResolution = res;
        refreshOutputSummary();
    };
}

/**
 * Show unsupported browser feature message
 */
function showUnsupported(text: string): void {
    Alpine.store('component', text);
    Alpine.store('state', 'unsupported');
}

/** Open the standard browser picker for consistent image and MP4 support. */
function chooseFile(): void {
    const input = document.getElementById('file-input') as HTMLInputElement;
    input.click();
}

async function loadMedia(file: File): Promise<void> {
    currentMediaFile = file;
    const imageExtension = /\.(png|jpe?g|webp|avif|bmp|gif)$/i.test(file.name);
    const isImage = (file.type.startsWith('image/') && file.type !== 'image/svg+xml') || (!file.type && imageExtension);

    if (!isImage && file.type !== 'video/mp4' && !/\.mp4$/i.test(file.name)) {
        showError('Formato não suportado. Escolha PNG, JPEG, WebP, AVIF, BMP, GIF ou vídeo MP4.');
        return;
    }
    if (!await webGPUSupport) {
        showUnsupported('WebGPU');
        return;
    }

    if (isImage) {
        resetWorkerReady();
        mediaKind = 'image';
        resetPreviewCanvas();
        inputFile = file;
        download_name = file.name.replace(/\.[^.]+$/, '') + '-upscaled.png';
        Alpine.store('filename', file.name);
        Alpine.store('download_name', download_name);
        Alpine.store('mediaKind', mediaKind);
        Alpine.store('state', 'loading');
        await setupImage(file);
        return;
    }

    if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) {
        Alpine.store('error', 'Este navegador não oferece WebCodecs para vídeo. Imagens continuam disponíveis; escolha uma imagem compatível.');
        Alpine.store('state', 'error');
        return;
    }

    mediaKind = 'video';
    resetWorkerReady();
    resetPreviewCanvas();
    inputFile = file;
    download_name = file.name.replace(/\.[^.]+$/, '') + '-upscaled.mp4';
    Alpine.store('filename', file.name);
    Alpine.store('download_name', download_name);
    Alpine.store('mediaKind', mediaKind);
    Alpine.store('state', 'loading');
    await setupPreview(file);
}

function resetPreviewCanvas(): void {
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    const outer = document.getElementById('image-compare-outer') as HTMLElement;
    const originalLayer = document.getElementById('compare-original') as HTMLElement;
    const upscaledLayer = document.getElementById('compare-after') as HTMLElement;
    outer.removeAttribute('style');
    original_canvas = document.createElement('canvas');
    original_canvas.id = 'original';
    upscaled_canvas = document.createElement('canvas');
    upscaled_canvas.id = 'upscaled';
    originalLayer.replaceChildren(original_canvas);
    upscaledLayer.replaceChildren(upscaled_canvas);
    setComparePosition(50);
    zoom = 1;
    fitZoom = 1;
    const zval = document.getElementById('zval');
    if (zval) zval.textContent = '100%';
}

function setComparePosition(position: number): void {
    const value = Math.max(0, Math.min(100, position));
    const slider = document.getElementById('compare-slider') as HTMLInputElement | null;
    const after = document.getElementById('compare-after');
    const divider = document.getElementById('compare-divider');
    if (slider && slider.value !== String(value)) slider.value = String(value);
    if (after) after.style.clipPath = `inset(0 0 0 ${value}%)`;
    if (divider) divider.style.left = `${value}%`;
}

function fitComparison(): void {
    fitZoom = computeFitZoom();
    zoomFit();
}

async function setupImage(file: File): Promise<void> {
    try {
        const bitmap = await createImageBitmap(file);
        const width = bitmap.width;
        const height = bitmap.height;
        if (width > 4096 || height > 4096) {
            bitmap.close();
            showError('A imagem precisa ter até 4096 px em cada lado para o upscale 2×.');
            return;
        }

        mediaWidth = width;
        mediaHeight = height;
        Alpine.store('width', width);
        Alpine.store('height', height);
        Alpine.store('target', 'blob');
        upscaled_canvas.width = width * 2;
        upscaled_canvas.height = height * 2;
        original_canvas.width = width * 2;
        original_canvas.height = height * 2;
        refreshOutputSummary();
        fitComparison();

        const upscaled = upscaled_canvas.transferControlToOffscreen();
        const original = original_canvas.transferControlToOffscreen();
        worker.postMessage({ cmd: 'init', data: {
            bitmap,
            upscaled,
            original,
            resolution: { width, height },
            networkName: networks[size].name,
            weights: weights[size][content],
        } }, [bitmap, upscaled, original]);

        content = 'rl';
        await workerReady;
        if (Alpine.store('state') !== 'loading') return;
        Alpine.store('state', 'preview');
    } catch (error) {
        showError(error instanceof Error ? error.message : 'Não foi possível abrir esta imagem.');
    }
}

//===================  Preview ===========================

/**
 * Load video file from FileSystemFileHandle
 */
async function loadVideo(fileHandle: FileSystemFileHandle): Promise<void> {
    await loadMedia(await fileHandle.getFile());
}

/**
 * Set up the preview UI with before/after comparison
 */
async function setupPreview(file: File): Promise<void> {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    previewUrl = URL.createObjectURL(file);
    video.src = previewUrl;
    video.onerror = () => showError('Não foi possível decodificar este MP4 neste navegador. Verifique o codec ou tente outro arquivo.');
    video.onloadeddata = () => { void startVideoPreview().catch((error) => showError(error instanceof Error ? error.message : 'Não foi possível preparar a prévia do vídeo.')); };
    video.load();
}

function formatPreviewTime(seconds: number): string {
    const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const minutes = Math.floor(safe / 60);
    const remaining = safe - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(2).padStart(5, '0')}`;
}

function configureFrameScrubber(duration: number, initialTime = 0): void {
    const slider = document.getElementById('preview-frame-slider') as HTMLInputElement | null;
    const current = document.getElementById('preview-current-time');
    const total = document.getElementById('preview-duration');
    if (!slider || !current || !total) return;
    slider.max = String(Math.max(duration, 0.001));
    slider.step = String(1 / Math.max(1, Number(video?.dataset.frameRate) || 30));
    slider.value = String(initialTime);
    current.textContent = formatPreviewTime(initialTime);
    total.textContent = formatPreviewTime(duration);
    slider.oninput = () => {
        current.textContent = formatPreviewTime(Number(slider.value));
        slider.setAttribute('aria-valuetext', formatPreviewTime(Number(slider.value)));
    };
    const seekToSlider = () => { void seekPreviewFrame(Number(slider.value)); };
    slider.onchange = seekToSlider;
    document.getElementById('preview-frame-prev')?.addEventListener('click', () => {
        slider.value = String(Math.max(0, Number(slider.value) - Number(slider.step)));
        slider.oninput?.(new Event('input'));
        seekToSlider();
    });
    document.getElementById('preview-frame-next')?.addEventListener('click', () => {
        slider.value = String(Math.min(Number(slider.max), Number(slider.value) + Number(slider.step)));
        slider.oninput?.(new Event('input'));
        seekToSlider();
    });
}

async function seekPreviewFrame(time: number): Promise<void> {
    if (!video || mediaKind !== 'video' || Alpine.store('state') !== 'preview') return;
    const request = ++previewSeekVersion;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = Math.max(0, Math.min(time, duration));
    if (Math.abs(video.currentTime - target) > 0.0005) {
        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                video.removeEventListener('seeked', onSeeked);
                reject(new Error('Não foi possível carregar esse fotograma. Tente escolher outro ponto do vídeo.'));
            }, 5000);
            const onSeeked = () => {
                window.clearTimeout(timeout);
                resolve();
            };
            video.addEventListener('seeked', onSeeked, { once: true });
            video.currentTime = target;
        });
    }
    if (request !== previewSeekVersion) return;
    await updateNetwork();
}

async function waitForVideoFrame(targetTime: number): Promise<void> {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                cleanup();
                reject(new Error('O navegador não conseguiu decodificar um quadro deste vídeo. Tente outro MP4.'));
            }, 10000);
            const cleanup = () => {
                window.clearTimeout(timeout);
                video.removeEventListener('loadeddata', onReady);
                video.removeEventListener('error', onError);
            };
            const onReady = () => { cleanup(); resolve(); };
            const onError = () => { cleanup(); reject(new Error('Não foi possível decodificar este vídeo neste navegador. Verifique o codec do MP4.')); };
            video.addEventListener('loadeddata', onReady, { once: true });
            video.addEventListener('error', onError, { once: true });
        });
    }

    if (Math.abs(video.currentTime - targetTime) > 0.01) {
        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                cleanup();
                reject(new Error('O vídeo demorou demais para localizar o quadro da prévia. Tente outro arquivo.'));
            }, 10000);
            const cleanup = () => {
                window.clearTimeout(timeout);
                video.removeEventListener('seeked', onSeeked);
                video.removeEventListener('error', onError);
            };
            const onSeeked = () => { cleanup(); resolve(); };
            const onError = () => { cleanup(); reject(new Error('Não foi possível localizar um quadro neste vídeo. Tente outro MP4.')); };
            video.addEventListener('seeked', onSeeked, { once: true });
            video.addEventListener('error', onError, { once: true });
            video.currentTime = targetTime;
        });
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        throw new Error('O navegador ainda não disponibilizou um quadro do vídeo. Tente novamente ou escolha outro MP4.');
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function capturePreviewBitmap(): Promise<ImageBitmap> {
    try {
        return await createImageBitmap(video);
    } catch {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context || !canvas.width || !canvas.height) {
            throw new Error('Não foi possível obter um quadro deste vídeo. Tente outro arquivo MP4.');
        }
        try {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            return await createImageBitmap(canvas);
        } catch {
            throw new Error('O navegador não conseguiu preparar o quadro da prévia. Verifique se o vídeo pode ser reproduzido e tente outro MP4.');
        }
    }
}

async function startVideoPreview(): Promise<void> {
    mediaWidth = video.videoWidth;
    mediaHeight = video.videoHeight;
    Alpine.store('width', mediaWidth);
    Alpine.store('height', mediaHeight);
    upscaled_canvas.width = mediaWidth * 2;
    upscaled_canvas.height = mediaHeight * 2;
    original_canvas.width = mediaWidth * 2;
    original_canvas.height = mediaHeight * 2;
    fitComparison();

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const initialPreviewTime = duration > 0.08 ? Math.min(duration * 0.2, duration - 0.04) : 0;
    await waitForVideoFrame(initialPreviewTime);
    configureFrameScrubber(duration, initialPreviewTime);

    const bitmap = await capturePreviewBitmap();
    const upscaled = upscaled_canvas.transferControlToOffscreen();
    const original = original_canvas.transferControlToOffscreen();
    content = 'rl';
    worker.postMessage({ cmd: 'init', data: {
        bitmap,
        upscaled,
        original,
        resolution: { width: mediaWidth, height: mediaHeight },
        networkName: networks[size].name,
        weights: weights[size][content],
    } }, [bitmap, upscaled, original]);
    await workerReady;
    if (Alpine.store('state') !== 'loading') return;

    const estimatedSize = (getBitrate() / 8 + 128 / 8) * (duration || 1);
    const quota = (await navigator.storage?.estimate?.())?.quota;
    if (estimatedSize > MAX_FILE_BLOB_SIZE && !window.showSaveFilePicker) {
        showError('Este vídeo excede o limite de memória deste navegador. Use um vídeo mais curto ou utilize Chrome ou Edge para salvar direto em disco.');
        return;
    }
    if (quota && estimatedSize > quota) {
        showError(`O arquivo estimado (${humanFileSize(estimatedSize)}) excede o limite de memória disponível (${humanFileSize(quota)}).`);
        return;
    }

    Alpine.store('style', content);
    refreshOutputSummary();
    Alpine.store('state', 'preview');
}

async function fullScreenPreview(): Promise<void> {
    const shell = document.getElementById('preview-shell');
    if (!shell || !document.fullscreenEnabled) return;
    if (document.fullscreenElement === shell) await document.exitFullscreen();
    else await shell.requestFullscreen();
}

function togglePause(): void {
    const state = Alpine.store('state');
    if (state === 'processing') worker.postMessage({ cmd: 'pause' } satisfies WorkerRequestMessage);
    else if (state === 'paused') worker.postMessage({ cmd: 'resume' } satisfies WorkerRequestMessage);
}


/**
 * Handle messages from the video processing worker
 */
worker.onmessage = function (event: MessageEvent<WorkerResponseMessage>) {
    if (event.data.cmd === 'isSupported') {
        const supported = event.data.data;
        resolveWebGPUSupport(supported);

        if (!supported) return showUnsupported("WebGPU");

    } else if (event.data.cmd === 'progress') {
        Alpine.store('progress', event.data.data);
        if (Alpine.store('state') !== 'paused') {
            Alpine.store('state', 'processing');
        }

    } else if (event.data.cmd === 'ready') {
        resolveWorkerReady();
    } else if (event.data.cmd === 'process') {
        // Processing started

    } else if (event.data.cmd === 'error') {
        resolveWebGPUSupport(false);
        resolveWorkerReady();
        showError(event.data.data);

    } else if (event.data.cmd === 'eta') {
        Alpine.store('eta', event.data.data);

    } else if (event.data.cmd === 'finished') {
        Alpine.store('state', 'complete');
        Alpine.store('download_url', event.data.data ? window.URL.createObjectURL(event.data.data) : null);
    } else if (event.data.cmd === 'image-finished') {
        Alpine.store('target', 'blob');
        Alpine.store('download_url', window.URL.createObjectURL(event.data.data));
        Alpine.store('state', 'complete');
    }
    else if (event.data.cmd === 'paused') {
        Alpine.store('state', 'paused');
    } else if (event.data.cmd === 'resumed') {
        Alpine.store('state', 'processing');
    }
};

worker.onerror = () => {
    resolveWebGPUSupport(false);
    resolveWorkerReady();
    showUnsupported('WebGPU');
};



/**
 * Switch to a different upscaling network
 */
async function updateNetwork(): Promise<void> {
    const bitmap = mediaKind === 'image'
        ? await createImageBitmap(currentMediaFile)
        : await createImageBitmap(video);

    worker.postMessage({
        cmd: 'network',
        data: {
            name: networks[size].name,
            bitmap,
            weights: weights[size][content]
        }
    } satisfies WorkerRequestMessage);
}

//===================  Process ===========================

/**
 * Start the video upscaling process
 */
async function initRecording(): Promise<void> {
    if (mediaKind === 'image') {
        Alpine.store('state', 'loading');
        worker.postMessage({ cmd: 'export-image', targetResolution } satisfies WorkerRequestMessage);
        return;
    }

    let bitrate = getBitrate();
    const estimated_size = (bitrate / 8) * video.duration + (128 / 8) * video.duration; // Assume 128 kbps audio

    let outputHandle: FileSystemFileHandle | undefined;

    if (estimated_size > MAX_FILE_BLOB_SIZE && window.showSaveFilePicker) {
        try {
            outputHandle = await showFilePicker();
        } catch (e) {
            console.warn("User aborted request");
            return Alpine.store('state', 'preview');
        }
    }

    if (estimated_size > MAX_FILE_BLOB_SIZE && !window.showSaveFilePicker) {
        return showError('Este vídeo excede o limite de memória deste navegador. Tente um vídeo mais curto ou use Chrome ou Edge para salvar direto em disco.');
    }

    Alpine.store('progress', 0);
    Alpine.store('eta', 'calculando...');
    Alpine.store('state', 'processing');
    worker.postMessage({
        cmd: "process",
        inputFile,
        outputHandle,
        targetResolution
    } satisfies WorkerRequestMessage);
}

/**
 * Display error message to user
 */
function showError(message: string): void {
    Alpine.store('state', 'error');
    Alpine.store('error', message);
}

function getOutputSize(): { width: number; height: number } {
    if (!mediaWidth || !mediaHeight) return { width: 0, height: 0 };
    if (targetResolution === '2x') {
        return { width: mediaWidth * 2, height: mediaHeight * 2 };
    }
    let height = parseInt(targetResolution, 10);
    let width = Math.round((mediaWidth / mediaHeight) * height);
    if (width % 2 !== 0) width += 1;
    if (height % 2 !== 0) height += 1;
    return { width, height };
}

function refreshOutputSummary(): void {
    const { width, height } = getOutputSize();
    Alpine.store('outWidth', width);
    Alpine.store('outHeight', height);
    if (mediaKind === 'image') {
        Alpine.store('size', humanFileSize(Math.max(1, width * height * 4)));
        return;
    }
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 1;
    const estimatedSize = (getBitrate() / 8 + 128 / 8) * duration;
    Alpine.store('size', humanFileSize(estimatedSize));
    Alpine.store('target', estimatedSize > MAX_FILE_BLOB_SIZE ? 'writer' : 'blob');
}

/**
 * Calculate target bitrate based on output resolution
 */
function getBitrate(): number {
    const { width, height } = getOutputSize();
    const area = width && height ? width * height : mediaWidth * mediaHeight * 4;
    return 5e6 * Math.sqrt(area / (1280 * 720));
}

/**
 * Format bytes into human-readable file size
 */
function humanFileSize(bytes: number, si: boolean = false, dp: number = 1): string {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }

    const units = si
        ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
        : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10 ** dp;

    do {
        bytes /= thresh;
        ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

    return bytes.toFixed(dp) + ' ' + units[u];
}

/**
 * Show native file picker for saving output video
 */
async function showFilePicker(): Promise<FileSystemFileHandle> {
    if (!window.showSaveFilePicker) throw new Error('O salvamento direto em disco não está disponível neste navegador.');
    const handle = await window.showSaveFilePicker({
        startIn: 'downloads',
        suggestedName: download_name,
        types: [{
            description: 'Arquivo de vídeo MP4',
            accept: { 'video/mp4': ['.mp4'] }
        }],
    });

    return handle;
}













// ==================== Zoom and Pan ====================
let zoom = 1.0;
let fitZoom = 1.0;

function computeFitZoom() {
    if (!mediaWidth || !mediaHeight) return 1.0;
    const shell = document.getElementById('preview-shell');
    const stage = document.getElementById('preview-stage');
    if (!stage) return 1.0;
    const fullscreen = document.fullscreenElement === shell;
    const padX = 24;
    const padY = 24;
    const maxWidth = Math.max(160, (fullscreen ? window.innerWidth : stage.clientWidth) - padX);
    const maxHeight = Math.max(140, (fullscreen ? window.innerHeight - 120 : stage.clientHeight) - padY);
    const scaleX = maxWidth / (mediaWidth * 2);
    const scaleY = maxHeight / (mediaHeight * 2);
    return Math.max(0.05, Math.min(scaleX, scaleY));
}

function applyZoom(z: number) {
    if (!mediaWidth || !mediaHeight) return;
    const next = Math.max(0.05, Math.min(z, 8));
    zoom = next;
    const outer = document.getElementById('image-compare-outer');
    if (outer) {
        const w = Math.max(1, Math.round(mediaWidth * 2 * zoom));
        const h = Math.max(1, Math.round(mediaHeight * 2 * zoom));
        outer.style.width = `${w}px`;
        outer.style.height = `${h}px`;
        outer.style.maxWidth = 'none';
        outer.style.maxHeight = 'none';
        outer.style.transform = 'none';
        outer.style.margin = zoom > fitZoom + 0.001 ? '0' : 'auto';
    }
    const zval = document.getElementById('zval');
    if (zval) zval.textContent = `${Math.max(1, Math.round(zoom * 100))}%`;
    const stage = document.getElementById('preview-stage');
    if (stage) stage.classList.toggle('can-pan', zoom > fitZoom + 0.001);
}

function zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const stage = document.getElementById('preview-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    zoomTo(clientX ?? rect.left + rect.width / 2, clientY ?? rect.top + rect.height / 2, factor);
}
function zoomIn() { zoomBy(1.25); }
function zoomOut() { zoomBy(1 / 1.25); }
function zoomFit() {
    fitZoom = computeFitZoom();
    applyZoom(fitZoom);
}
function zoom1x() { applyZoom(1); }
function zoomTo(clientX: number, clientY: number, factor: number): void {
    const stage = document.getElementById('preview-stage');
    const outer = document.getElementById('image-compare-outer');
    if (!stage || !outer || !mediaWidth) return;
    const imageRect = outer.getBoundingClientRect();
    const oldZoom = zoom || 0.01;
    const newZoom = Math.max(0.05, Math.min(oldZoom * factor, 8));
    if (newZoom === oldZoom) return;
    const sourceX = (clientX - imageRect.left) / oldZoom;
    const sourceY = (clientY - imageRect.top) / oldZoom;
    applyZoom(newZoom);
    const newRect = outer.getBoundingClientRect();
    stage.scrollLeft += newRect.left + sourceX * newZoom - clientX;
    stage.scrollTop += newRect.top + sourceY * newZoom - clientY;
}
function zoomAt(clientX: number, clientY: number, delta: number) {
    zoomTo(clientX, clientY, delta > 0 ? 0.9 : 1.1);
}

window.addEventListener('resize', () => {
    const previousFit = fitZoom;
    fitZoom = computeFitZoom();
    if (Math.abs(zoom - previousFit) < 0.02 || zoom <= fitZoom) zoomFit();
});

function bindZoomControls() {
    document.getElementById('b_zin')?.addEventListener('click', zoomIn);
    document.getElementById('b_zout')?.addEventListener('click', zoomOut);
    document.getElementById('b_fit')?.addEventListener('click', zoomFit);
    document.getElementById('b_1x')?.addEventListener('click', zoom1x);
    document.getElementById('zval')?.addEventListener('click', zoomFit);

    const stage = document.getElementById('preview-stage');
    if (!stage) return;

    let isPanning = false;
    let startX = 0, startY = 0, scrollL = 0, scrollT = 0;

    const nearCompareDivider = (clientX: number) => {
        const divider = document.getElementById('compare-divider');
        if (!divider) return false;
        const rect = divider.getBoundingClientRect();
        return Math.abs(clientX - (rect.left + rect.width / 2)) < 28;
    };

    stage.addEventListener('pointerdown', (e) => {
        const allowPan = e.button === 1 || (e.button === 0 && zoom > fitZoom + 0.001 && !nearCompareDivider(e.clientX));
        if (!allowPan) return;
        isPanning = true;
        startX = e.clientX;
        startY = e.clientY;
        scrollL = stage.scrollLeft;
        scrollT = stage.scrollTop;
        stage.classList.add('panning');
        stage.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    stage.addEventListener('pointermove', (e) => {
        if (!isPanning) return;
        stage.scrollLeft = scrollL - (e.clientX - startX);
        stage.scrollTop = scrollT - (e.clientY - startY);
    });

    const endPan = (e?: PointerEvent) => {
        if (!isPanning) return;
        isPanning = false;
        stage.classList.remove('panning');
        if (e) {
            try { stage.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        }
    };

    stage.addEventListener('pointerup', endPan);
    stage.addEventListener('pointercancel', () => endPan());

    stage.addEventListener('wheel', (e) => {
        // Trackpad pinch sets ctrlKey; also accept Alt+wheel
        if (e.ctrlKey || e.metaKey || e.altKey) {
            e.preventDefault();
            zoomAt(e.clientX, e.clientY, e.deltaY);
        }
    }, { passive: false });
}

bindZoomControls();

// ==================== Panel Toggle ====================
function updatePanelMenuLabel(side: 'left' | 'right', hidden: boolean): void {
    const button = document.getElementById(side === 'left' ? 'm_toggle_left' : 'm_toggle_right');
    if (!button) return;
    const sideName = side === 'left' ? 'esquerdo' : 'direito';
    const label = button.querySelector('span');
    if (label) label.textContent = `${hidden ? 'Mostrar' : 'Ocultar'} painel ${sideName}`;
    button.setAttribute('aria-pressed', String(hidden));
    document.getElementById(side === 'left' ? 'b_pl' : 'b_pr')?.setAttribute('aria-pressed', String(hidden));
}

function togglePanel(side: 'left' | 'right', forceHidden?: boolean) {
    const app = document.getElementById('app');
    if (!app) return;
    const key = side === 'left' ? PANEL_LEFT_KEY : PANEL_RIGHT_KEY;
    const isHidden = forceHidden ?? !app.classList.contains(`hide-${side}`);
    app.classList.toggle(`hide-${side}`, isHidden);
    savePreference(key, String(isHidden));
    updatePanelMenuLabel(side, isHidden);

    requestAnimationFrame(() => {
        fitZoom = computeFitZoom();
        if (zoom <= fitZoom * 1.01) zoomFit();
    });
}

document.getElementById('b_pl')?.addEventListener('click', () => togglePanel('left'));
document.getElementById('b_pr')?.addEventListener('click', () => togglePanel('right'));
document.getElementById('b_zen')?.addEventListener('click', () => {
    const app = document.getElementById('app');
    if (!app) return;
    const zen = !(app.classList.contains('hide-left') && app.classList.contains('hide-right'));
    togglePanel('left', zen);
    togglePanel('right', zen);
});

window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if ((e.target as HTMLElement | null)?.isContentEditable) return;
    if (e.key === '[') togglePanel('left');
    if (e.key === ']') togglePanel('right');
    if (e.key === 'f' || e.key === 'F') {
        const app = document.getElementById('app');
        if (app) {
            const zen = !(app.classList.contains('hide-left') && app.classList.contains('hide-right'));
            togglePanel('left', zen);
            togglePanel('right', zen);
        }
    }
    if (e.key === '+' || e.key === '=') zoomIn();
    if (e.key === '-') zoomOut();
    if (e.key === '0') zoomFit();
    if (e.key === '1') zoom1x();
    if (e.key === '.') zoomFit();
});

window.togglePanel = togglePanel;

