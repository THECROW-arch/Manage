import { pipeline, env } from '@huggingface/transformers';

// Ensure models load cleanly from Hugging Face CDN and cache in the browser
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriberPromise = null;

/**
 * Lazily loads and caches the upgraded Whisper Base speech-to-text model in the browser.
 * @param {Function} onProgress - Optional callback for first-time download progress.
 */
export async function getLocalTranscriber(onProgress) {
    if (!transcriberPromise) {
        transcriberPromise = pipeline(
            'automatic-speech-recognition',
            'Xenova/whisper-base.en',
            {
                progress_callback: onProgress
            }
        ).catch((err) => {
            transcriberPromise = null;
            throw err;
        });
    }
    return transcriberPromise;
}

/**
 * Merges raw Float32Array microphone chunks, resamples to 16kHz, removes DC offset,
 * and normalizes peak volume so Whisper hears every syllable clearly.
 * @param {Float32Array[]} chunks - Array of raw PCM audio chunks
 * @param {number} inputSampleRate - The AudioContext's native sample rate
 * @returns {Float32Array}
 */
export function mergeAndResampleTo16kHz(chunks, inputSampleRate) {
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    const targetSampleRate = 16000;
    let resampled = merged;

    if (inputSampleRate && inputSampleRate !== targetSampleRate) {
        const ratio = inputSampleRate / targetSampleRate;
        const newLength = Math.round(merged.length / ratio);
        resampled = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio;
            const lower = Math.floor(srcIndex);
            const upper = Math.min(lower + 1, merged.length - 1);
            const weight = srcIndex - lower;
            resampled[i] = merged[lower] * (1 - weight) + merged[upper] * weight;
        }
    }

    // 1. Remove DC offset (microphone hum) and find peak amplitude
    let sum = 0;
    for (let i = 0; i < resampled.length; i++) {
        sum += resampled[i];
    }
    const mean = resampled.length > 0 ? sum / resampled.length : 0;

    let maxPeak = 0;
    for (let i = 0; i < resampled.length; i++) {
        resampled[i] -= mean;
        const abs = Math.abs(resampled[i]);
        if (abs > maxPeak) maxPeak = abs;
    }

    // 2. Normalize volume to 0.95 peak so quiet speech is crystal clear
    if (maxPeak > 0.005 && maxPeak < 0.95) {
        const gain = 0.95 / maxPeak;
        for (let i = 0; i < resampled.length; i++) {
            resampled[i] *= gain;
        }
    }

    return resampled;
}