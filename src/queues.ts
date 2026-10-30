export const Q_CONTROL = 'control'; // jobs: discover, deliver, tag-topics, deep-dive
export const Q_PROCESS = 'process'; // jobs: process (download → transcribe → analyze); one at a time
export const Q_EMAIL = 'email'; // jobs: send (one subscriber, one meeting), send-dive (one subscriber, one deep dive); rate-limited
