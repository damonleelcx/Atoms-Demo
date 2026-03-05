'use client';

import React, { useCallback, useRef, useState } from 'react';

interface Props {
  onResult: (blob: Blob) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function AudioInput({ onResult, disabled, placeholder = 'Hold to record' }: Props) {
  const [recording, setRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const start = useCallback(() => {
    if (disabled) return;
    chunks.current = [];
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const mr = new MediaRecorder(stream);
      mediaRecorder.current = mr;
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        onResult(blob);
      };
      mr.start();
      setRecording(true);
    });
  }, [disabled, onResult]);

  const stop = useCallback(() => {
    if (mediaRecorder.current && recording) {
      mediaRecorder.current.stop();
      mediaRecorder.current = null;
      setRecording(false);
    }
  }, [recording]);

  return (
    <button
      type="button"
      onMouseDown={start}
      onMouseUp={stop}
      onMouseLeave={stop}
      onTouchStart={start}
      onTouchEnd={stop}
      onTouchCancel={stop}
      disabled={disabled}
      className="audio-btn"
      title={placeholder}
    >
      {recording ? '🔴 Recording...' : '🎤 Hold to speak'}
    </button>
  );
}
