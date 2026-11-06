import { useState, useRef, useCallback, useEffect } from 'react';
import { getStoredApiKeys } from '../../services/provider-factory';
import { fetchExhibitionSettings, invokeKosenAiProxy } from './supabase';

export interface SpeechRecognitionHookResult {
  isSupported: boolean;
  isListening: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  interimTranscript: string;
  error: string | null;
  modelUsed: string;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
}

/**
 * Converts a Blob to a base64 encoded string (without the data: URL prefix).
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Transcribes audio bytes using Gemini API (model: gemini-3.5-transcribe).
 * Prioritizes Supabase Edge Function Proxy (server-side API Key) so browser doesn't need to hold the secret.
 */
export async function transcribeWithGeminiLLM(
  audioBlob: Blob,
  modelName = 'gemini-3.5-transcribe'
): Promise<string> {
  const base64Data = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || 'audio/webm';

  // 1. Try Supabase Edge Function AI Proxy first (No client-side API Key required)
  try {
    const proxyRes = await invokeKosenAiProxy<{ text: string }>('transcribe', {
      model: modelName,
      audioBase64: base64Data,
      mimeType,
    });
    if (proxyRes?.text && proxyRes.text.trim()) {
      return proxyRes.text.trim();
    }
  } catch (proxyErr) {
    console.warn('Supabase Edge Function transcribe failed, checking local API key fallback:', proxyErr);
  }

  // 2. Direct client fallback if client has a local API key configured
  const keys = getStoredApiKeys();
  const apiKey = keys.gemini || keys.openrouter || '';
  if (!apiKey) {
    throw new Error(
      '音声認識を実行できませんでした（Supabase Edge Function または API Key を確認してください）'
    );
  }

  // 2a. Try Gemini Interactions API
  try {
    const interactionsRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          model: modelName,
          input: [
            {
              type: 'audio',
              data: base64Data,
              mime_type: mimeType,
            },
          ],
        }),
      }
    );

    if (interactionsRes.ok) {
      const data = await interactionsRes.json();
      const outputText = data.output_text || data.interaction?.outputText || data.text;
      if (typeof outputText === 'string' && outputText.trim()) {
        return outputText.trim();
      }
    }
  } catch (err) {
    console.warn('Gemini interactions transcribe failed, attempting generateContent fallback:', err);
  }

  // 2b. Fallback to generateContent API endpoint
  const generateRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              {
                text: 'この日本語音声を正確に文字起こししてください。文字起こししたテキストのみを出力してください。',
              },
            ],
          },
        ],
      }),
    }
  );

  if (!generateRes.ok) {
    const errJson = await generateRes.json().catch(() => ({}));
    throw new Error(
      errJson.error?.message || `文字起こしAPIエラー (${generateRes.status})`
    );
  }

  const genData = await generateRes.json();
  const candidateText =
    genData.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return candidateText.trim();
}

export function useSpeechInput(
  onTranscript: (text: string) => void,
  customModel?: string
): SpeechRecognitionHookResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState(customModel || 'gemini-3.5-transcribe');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Web Speech API fallback reference in case getUserMedia is blocked or unsupported
  const legacyRecognitionRef = useRef<any>(null);

  const isMediaRecorderSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window.MediaRecorder !== 'undefined'
    );

  const SpeechRecognitionImpl =
    typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;

  const isSupported = Boolean(isMediaRecorderSupported || SpeechRecognitionImpl);

  // Sync configured transcribe model from settings if not explicitly provided
  useEffect(() => {
    if (!customModel) {
      fetchExhibitionSettings()
        .then((s) => {
          if (s.transcribeModel) {
            setModelUsed(s.transcribeModel);
          }
        })
        .catch(() => {});
    }
  }, [customModel]);

  const cleanupAudio = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  const stopListening = useCallback(() => {
    setIsRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (legacyRecognitionRef.current) {
      try {
        legacyRecognitionRef.current.stop();
      } catch {}
    }
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    setInterimTranscript('');
    audioChunksRef.current = [];

    // If MediaRecorder is supported, record audio and send to Supabase Edge Function (gemini-3.5-transcribe)
    if (isMediaRecorderSupported) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;

        // Choose best supported mime type
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';
        }

        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        recorder.onstop = async () => {
          setIsRecording(false);
          const tracks = streamRef.current?.getTracks();
          tracks?.forEach((t) => t.stop());

          const combinedBlob = new Blob(audioChunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          });

          if (combinedBlob.size < 100) {
            // Audio was too short or empty
            return;
          }

          setIsTranscribing(true);
          setInterimTranscript(`LLMモデル (${modelUsed}) で文字起こし中...`);

          try {
            const transcript = await transcribeWithGeminiLLM(combinedBlob, modelUsed);
            if (transcript) {
              onTranscript(transcript);
            }
          } catch (err: any) {
            setError(`文字起こし失敗: ${err?.message || 'エラーが発生しました'}`);
          } finally {
            setIsTranscribing(false);
            setInterimTranscript('');
          }
        };

        recorder.start(250);
        setIsRecording(true);
        return;
      } catch (mediaErr: any) {
        console.warn('MediaRecorder error, falling back to Web Speech API:', mediaErr);
      }
    }

    // Fallback: Web Speech API (or simulated prompt input if neither works)
    if (SpeechRecognitionImpl) {
      try {
        const recognition = new SpeechRecognitionImpl();
        recognition.lang = 'ja-JP';
        recognition.continuous = false;
        recognition.interimResults = true;

        recognition.onstart = () => {
          setIsRecording(true);
        };

        recognition.onresult = (event: any) => {
          let finalChunk = '';
          let interimChunk = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalChunk += transcript;
            } else {
              interimChunk += transcript;
            }
          }
          setInterimTranscript(interimChunk);
          if (finalChunk) {
            onTranscript(finalChunk);
          }
        };

        recognition.onerror = (event: any) => {
          if (event.error !== 'no-speech' && event.error !== 'aborted') {
            setError(`音声認識エラー: ${event.error}`);
          }
          setIsRecording(false);
        };

        recognition.onend = () => {
          setIsRecording(false);
          setInterimTranscript('');
        };

        legacyRecognitionRef.current = recognition;
        recognition.start();
        return;
      } catch (recErr: any) {
        setError(recErr?.message || '音声入力を開始できませんでした。');
        setIsRecording(false);
      }
    } else {
      setError(
        'マイク機能が許可されていないか、対応ブラウザではありません。キーボードから入力してください。'
      );
    }
  }, [
    isMediaRecorderSupported,
    SpeechRecognitionImpl,
    modelUsed,
    onTranscript,
  ]);

  const toggleListening = useCallback(() => {
    if (isRecording || isTranscribing) {
      stopListening();
    } else {
      startListening();
    }
  }, [isRecording, isTranscribing, startListening, stopListening]);

  useEffect(() => {
    return () => {
      cleanupAudio();
      if (legacyRecognitionRef.current) {
        try {
          legacyRecognitionRef.current.abort();
        } catch {}
      }
    };
  }, [cleanupAudio]);

  const isListening = isRecording || isTranscribing;

  return {
    isSupported,
    isListening,
    isRecording,
    isTranscribing,
    interimTranscript,
    error,
    modelUsed,
    startListening,
    stopListening,
    toggleListening,
  };
}
