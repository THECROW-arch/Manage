import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { processAIAgentTurn } from '../utils/aiAgentEngine';
import { getLocalTranscriber, mergeAndResampleTo16kHz } from '../utils/voiceTranscriber';

const DEFAULT_WELCOME_MESSAGE = {
    id: 'welcome',
    role: 'assistant',
    text: 'Hi! I am **Sterling**, your MANAGED AI Assistant. I can analyze your live budget, tell you how many expenses you have, check if you can afford a purchase, or log expenses and adjust categories directly for you.',
    suggestions: [
        'How many expenses do I have this month?',
        'Audit my budget',
        'How much can I spend per day?',
        'When will I reach my Savings goal?'
    ]
};

const getChatStorageKey = (uid) => (uid ? `managed_ai_chat_history_${uid}` : null);

const loadAccountChatHistory = (uid) => {
    const key = getChatStorageKey(uid);
    if (!key) return [DEFAULT_WELCOME_MESSAGE];
    try {
        const saved = localStorage.getItem(key);
        const parsed = saved ? JSON.parse(saved) : null;
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : [DEFAULT_WELCOME_MESSAGE];
    } catch {
        return [DEFAULT_WELCOME_MESSAGE];
    }
};

export default function AIAssistantDrawer(props) {
    const { userId } = props;
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);

    const [messages, setMessages] = useState(() => loadAccountChatHistory(userId));
    const msgIdCounterRef = useRef(1);

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const isRecordingRef = useRef(false);
    const isStartingMicRef = useRef(false);
    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const audioChunksRef = useRef([]);

    const releaseMic = useCallback(() => {
        isRecordingRef.current = false;
        isStartingMicRef.current = false;
        audioChunksRef.current = [];
        if (processorRef.current) {
            try { processorRef.current.disconnect(); } catch { /* ignore */ }
            processorRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => {});
            audioContextRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => {
                try { track.stop(); } catch { /* ignore */ }
            });
            mediaStreamRef.current = null;
        }
    }, []);

    // Persist chat history only under the authenticated user's key
    useEffect(() => {
        const key = getChatStorageKey(userId);
        if (!key) return;
        try {
            localStorage.setItem(key, JSON.stringify(messages.slice(-40)));
        } catch (e) {
            console.warn('Failed to persist AI chat history:', e);
        }
    }, [messages, userId]);

    useEffect(() => {
        if (!isOpen) {
            releaseMic();
        } else {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            inputRef.current?.focus();
        }
    }, [isOpen, releaseMic]);

    useEffect(() => {
        if (isOpen) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen]);

    useEffect(() => {
        return () => {
            releaseMic();
        };
    }, [releaseMic]);

    const handleCloseDrawer = () => {
        releaseMic();
        setIsRecording(false);
        setIsTranscribing(false);
        setIsOpen(false);
    };

    const handleSendPrompt = async (promptText) => {
        const cleanPrompt = (promptText ?? input).trim();
        if (!cleanPrompt || isProcessing) return;

        const nextUserMsgId = `u_${++msgIdCounterRef.current}`;
        const userMsg = { id: nextUserMsgId, role: 'user', text: cleanPrompt };
        setMessages(prev => [...prev, userMsg]);
        if (promptText === undefined) setInput('');
        setIsProcessing(true);

        try {
            const response = await processAIAgentTurn(cleanPrompt, props);
            const nextAiMsgId = `a_${++msgIdCounterRef.current}`;
            setMessages(prev => [
                ...prev,
                {
                    id: nextAiMsgId,
                    role: 'assistant',
                    text: response.reply,
                    actionBadge: response.actionBadge,
                    suggestions: response.suggestions
                }
            ]);
        } catch (err) {
            console.error('AI Assistant error:', err);
            const nextErrMsgId = `e_${++msgIdCounterRef.current}`;
            setMessages(prev => [
                ...prev,
                {
                    id: nextErrMsgId,
                    role: 'assistant',
                    text: 'Something went wrong while processing that request. Please try again.'
                }
            ]);
        } finally {
            setIsProcessing(false);
        }
    };

    const toggleAssistantVoice = async () => {
        if (isTranscribing) return;

        if (isRecordingRef.current || isRecording || isStartingMicRef.current) {
            const sampleRate = audioContextRef.current?.sampleRate || 16000;
            const chunks = [...audioChunksRef.current];
            releaseMic();
            setIsRecording(false);

            if (chunks.length === 0) return;

            try {
                const audioData = mergeAndResampleTo16kHz(chunks, sampleRate);
                if (audioData.length < 4800) return;

                setIsTranscribing(true);
                const transcriber = await getLocalTranscriber();
                const output = await transcriber(audioData, { temperature: 0 });
                const transcript = (output?.text || '').trim();
                if (transcript) {
                    await handleSendPrompt(transcript);
                }
            } catch (err) {
                console.error('Assistant voice error:', err);
            } finally {
                setIsTranscribing(false);
            }
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

        try {
            isStartingMicRef.current = true;
            setIsRecording(true);
            audioChunksRef.current = [];

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            if (!isStartingMicRef.current) {
                stream.getTracks().forEach(track => track.stop());
                setIsRecording(false);
                return;
            }

            mediaStreamRef.current = stream;

            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioCtx();
            audioContextRef.current = audioCtx;

            const source = audioCtx.createMediaStreamSource(stream);
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
                if (!isRecordingRef.current) return;
                audioChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
            };

            source.connect(processor);
            processor.connect(audioCtx.destination);
            isRecordingRef.current = true;
            isStartingMicRef.current = false;
        } catch (err) {
            console.error('Mic start failed:', err);
            releaseMic();
            setIsRecording(false);
        }
    };

    const renderFormattedText = (raw) => {
        return raw.split('\n').map((line, i) => {
            const parts = line.split(/(\*\*.*?\*\*|\*.*?\*)/g);
            return (
                <p key={i} className={line.trim() === '' ? 'h-2' : 'leading-relaxed'}>
                    {parts.map((part, idx) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                            return <strong key={idx} className="font-bold text-gray-900 dark:text-white">{part.slice(2, -2)}</strong>;
                        }
                        if (part.startsWith('*') && part.endsWith('*')) {
                            return <em key={idx} className="italic opacity-90">{part.slice(1, -1)}</em>;
                        }
                        return part;
                    })}
                </p>
            );
        });
    };

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    if (isOpen) handleCloseDrawer();
                    else setIsOpen(true);
                }}
                aria-label={t('toggle_ai_assistant', 'Toggle MANAGED AI Assistant')}
                className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xl transition-all focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                </svg>
                <span>{isOpen ? t('close_ai', 'Close AI') : t('ai_assistant', 'AI Agent')}</span>
            </button>

            {isOpen && (
                <div
                    role="dialog"
                    aria-label="MANAGED AI Financial Assistant"
                    onKeyDown={(e) => { if (e.key === 'Escape') handleCloseDrawer(); }}
                    className="fixed bottom-20 right-6 z-50 w-[92vw] sm:w-[400px] h-[540px] max-h-[80vh] bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in"
                >
                    <div className="px-4 py-3 bg-emerald-700 text-white flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
                            <div>
                                <h3 className="text-xs font-black uppercase tracking-wider">Sterling • MANAGED AI</h3>
                                <p className="text-[10px] text-emerald-100">Personal Financial Advisor & Action Agent</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setMessages([DEFAULT_WELCOME_MESSAGE])}
                                title="Clear conversation history"
                                className="px-2 py-0.5 rounded bg-emerald-800 hover:bg-emerald-900 text-[10px] font-bold text-emerald-100 transition-colors"
                            >
                                Clear
                            </button>
                            <button
                                type="button"
                                onClick={handleCloseDrawer}
                                aria-label="Close AI Assistant"
                                className="p-1 rounded hover:bg-emerald-800 text-white transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-gray-50/60 dark:bg-zinc-950/60">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                {msg.actionBadge && (
                                    <span className="mb-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30">
                                        ✓ {msg.actionBadge}
                                    </span>
                                )}
                                <div
                                    className={`max-w-[88%] px-3.5 py-2.5 rounded-xl text-xs ${
                                        msg.role === 'user'
                                            ? 'bg-emerald-700 text-white rounded-br-none'
                                            : 'bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 border border-gray-200 dark:border-zinc-800 rounded-bl-none shadow-sm'
                                    }`}
                                >
                                    {renderFormattedText(msg.text)}
                                </div>

                                {msg.suggestions && msg.suggestions.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {msg.suggestions.map((sug, i) => (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => handleSendPrompt(sug)}
                                                className="text-[11px] px-2.5 py-1 rounded-full bg-white dark:bg-zinc-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 font-medium transition-colors"
                                            >
                                                {sug}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        {isProcessing && (
                            <div className="text-xs text-gray-500 dark:text-zinc-400 italic px-2">
                                Analyzing your ledger...
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleSendPrompt();
                        }}
                        className="p-3 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-800 flex items-center gap-2"
                    >
                        <button
                            type="button"
                            onClick={toggleAssistantVoice}
                            disabled={isTranscribing}
                            aria-label={isRecording ? 'Stop voice command' : 'Speak to AI Assistant'}
                            title={isRecording ? 'Click to stop recording' : 'Speak a command'}
                            className={`px-2.5 py-2 rounded-lg text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-emerald-600/30 ${
                                isRecording
                                    ? 'bg-rose-600 hover:bg-rose-700 text-white animate-pulse'
                                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 hover:bg-emerald-50 dark:hover:bg-zinc-700'
                            }`}
                        >
                            {isTranscribing ? '⏳' : isRecording ? 'Stop' : '🎤'}
                        </button>
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={isRecording ? 'Recording... Click Stop when done' : 'Ask or command (e.g. "How many expenses?")'}
                            aria-label="Message MANAGED AI Assistant"
                            className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30"
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isProcessing}
                            className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white font-bold text-xs transition-colors"
                        >
                            Send
                        </button>
                    </form>
                </div>
            )}
        </>
    );
}