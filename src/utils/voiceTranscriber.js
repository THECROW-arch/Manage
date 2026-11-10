let transcriberPromise = null;

/**
 * Lazily loads the Transformers library and initializes the Whisper
 * speech-recognition pipeline only when voice transcription is requested.
 * Resets the cached promise on failure so subsequent voice requests can retry.
 * @param {Function} [onProgress] - Optional callback for model download progress.
 * @returns {Promise<Function>} Initialized automatic-speech-recognition pipeline.
 */
export async function getLocalTranscriber(onProgress) {
    if (!transcriberPromise) {
        transcriberPromise = (async () => {
            try {
                const cdnUrl = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
                const transformers = await import(/* @vite-ignore */ cdnUrl);
                const { pipeline, env } = transformers;
                env.allowLocalModels = false;
                env.useBrowserCache = true;
                return await pipeline(
                    'automatic-speech-recognition',
                    'Xenova/whisper-base.en',
                    {
                        progress_callback: onProgress
                    }
                );
            } catch (err) {
                transcriberPromise = null;
                console.warn('Transformers.js failed to load dynamically:', err);
                throw new Error(
                    'Voice transcription model could not be initialized. Please check your internet connection.',
                    { cause: err }
                );
            }
        })();
    }
    return transcriberPromise;
}

/**
 * Merges recorded Float32 audio chunks and resamples them to 16kHz mono for Whisper.
 * @param {Array<Float32Array>} chunks - Recorded audio buffer chunks.
 * @param {number} inputSampleRate - Source AudioContext sample rate.
 * @returns {Float32Array} Resampled 16kHz mono PCM audio buffer.
 */
export function mergeAndResampleTo16kHz(chunks, inputSampleRate = 44100) {
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    const targetSampleRate = 16000;
    if (inputSampleRate === targetSampleRate) {
        return merged;
    }

    const ratio = inputSampleRate / targetSampleRate;
    const newLength = Math.round(merged.length / ratio);
    const resampled = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
        const srcIndex = i * ratio;
        const lower = Math.floor(srcIndex);
        const upper = Math.min(merged.length - 1, Math.ceil(srcIndex));
        const weight = srcIndex - lower;
        resampled[i] = merged[lower] * (1 - weight) + merged[upper] * weight;
    }

    return resampled;
}