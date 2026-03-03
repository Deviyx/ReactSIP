import { useState, useEffect } from 'react';

export const useCallTimer = (startTime) => {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let timer;
    if (startTime) {
      timer = setInterval(() => {
        const now = new Date();
        const callStartTime = new Date(startTime);
        setDuration(Math.floor((now - callStartTime) / 1000));
      }, 1000);
    }

    return () => {
      clearInterval(timer);
    };
  }, [startTime]);

  const formatTime = (totalSeconds) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours > 0 ? String(hours).padStart(2, '0') + ':' : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  return formatTime(duration);
};
