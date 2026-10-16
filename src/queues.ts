export const Q_CONTROL = 'control'; // jobs: discover, deliver
export const Q_PROCESS = 'process'; // jobs: process (download → transcribe → analyze); one at a time
export const Q_EMAIL = 'email'; // jobs: send (one subscriber, one meeting); rate-limited
