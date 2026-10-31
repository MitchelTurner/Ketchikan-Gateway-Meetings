import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { config } from '../config';
import { MediaService } from '../media/media.service';

export interface Segment {
  start: number; // seconds
  end: number;
  speaker?: string;
  text: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class TranscriptionService {
  private log = new Logger(TranscriptionService.name);
  constructor(private media: MediaService) {}

  get providerName() {
    return config.transcriptionProvider;
  }

  /** vocabulary: names and local terms to listen for, so they come back spelled right. */
  transcribe(audioPath: string, vocabulary: string[] = []): Promise<Segment[]> {
    return config.transcriptionProvider === 'openai' ? this.openai(audioPath, vocabulary) : this.assemblyai(audioPath, vocabulary);
  }

  /** AssemblyAI: takes the whole file, labels speakers. Best fit for 2–4 hour meetings. */
  private async assemblyai(audioPath: string, vocabulary: string[]): Promise<Segment[]> {
    const headers = { authorization: config.assemblyaiKey };
    const up = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body: await fs.readFile(audioPath),
    });
    if (!up.ok) throw new Error(`AssemblyAI upload ${up.status}: ${await up.text()}`);
    const { upload_url } = (await up.json()) as { upload_url: string };

    const create = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: upload_url,
        speaker_labels: true,
        punctuate: true,
        format_text: true,
        ...(vocabulary.length ? { word_boost: vocabulary, boost_param: 'high' } : {}),
      }),
    });
    if (!create.ok) throw new Error(`AssemblyAI create ${create.status}: ${await create.text()}`);
    const { id } = (await create.json()) as { id: string };
    this.log.log(`AssemblyAI job ${id} started`);

    const deadline = Date.now() + 3 * 60 * 60_000;
    while (Date.now() < deadline) {
      await sleep(15_000);
      const r = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers });
      const j = (await r.json()) as any;
      if (j.status === 'completed') {
        return (j.utterances ?? []).map((u: any) => ({
          start: u.start / 1000,
          end: u.end / 1000,
          speaker: `Speaker ${u.speaker}`,
          text: u.text,
        }));
      }
      if (j.status === 'error') throw new Error(`AssemblyAI error: ${j.error}`);
    }
    throw new Error('AssemblyAI timed out');
  }

  /** OpenAI Whisper: 25 MB upload cap, so audio is sent in 20-minute chunks. No speaker labels. */
  private async openai(audioPath: string, vocabulary: string[]): Promise<Segment[]> {
    // Whisper reads only the last ~224 tokens of the prompt.
    const prompt = `Ketchikan Gateway Borough or City of Ketchikan meeting. Assembly, City Council, Planning Commission, Port and Harbors, School Board, Saxman, Gravina, Revilla, Ward Cove, Tongass. ${vocabulary.join(', ')}`.slice(0, 800);
    const chunks = await this.media.splitAudio(audioPath, 20 * 60);
    const all: Segment[] = [];
    for (const { file, offsetSec } of chunks) {
      const form = new FormData();
      form.append('file', new Blob([await fs.readFile(file)], { type: 'audio/mpeg' }), path.basename(file));
      form.append('model', 'whisper-1');
      form.append('response_format', 'verbose_json');
      form.append('prompt', prompt);
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${config.openaiKey}` },
        body: form,
      });
      if (!r.ok) throw new Error(`OpenAI transcription ${r.status}: ${await r.text()}`);
      const j = (await r.json()) as any;
      for (const s of j.segments ?? []) {
        all.push({ start: s.start + offsetSec, end: s.end + offsetSec, text: String(s.text).trim() });
      }
    }
    return all;
  }
}

/** "[1:02:15] Speaker A: ..." lines, merging consecutive segments from the same speaker. */
export function formatTranscript(segments: Segment[]): string {
  const merged: Segment[] = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end < 5 && last.text.length < 1200) {
      last.end = s.end;
      last.text = `${last.text} ${s.text}`;
    } else {
      merged.push({ ...s });
    }
  }
  return merged
    .map((m) => `[${Math.floor(m.start)}s] ${m.speaker ? `${m.speaker}: ` : ''}${m.text}`)
    .join('\n');
}
