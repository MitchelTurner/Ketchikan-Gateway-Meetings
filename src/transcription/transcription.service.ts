import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { config } from '../config';
import { loadRoster, transcriptionTerms } from '../enrichment/names';
import { MediaService } from '../media/media.service';

/** Local names a general speech model tends to mangle. */
const PLACES = ['Ketchikan', 'Saxman', 'Gravina', 'Revillagigedo', 'Tongass', 'Ward Cove', 'Herring Cove', 'Houghtaling', 'Schoenbar', 'KPU', 'Tlingit'];

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

  transcribe(audioPath: string): Promise<Segment[]> {
    return config.transcriptionProvider === 'openai' ? this.openai(audioPath) : this.assemblyai(audioPath);
  }

  /** AssemblyAI: takes the whole file, labels speakers. Best fit for 2–4 hour meetings. */
  private async assemblyai(audioPath: string): Promise<Segment[]> {
    const headers = { authorization: config.assemblyaiKey };
    const up = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body: await fs.readFile(audioPath),
    });
    if (!up.ok) throw new Error(`AssemblyAI upload ${up.status}: ${await up.text()}`);
    const { upload_url } = (await up.json()) as { upload_url: string };

    const terms = await this.nameTerms();
    const submit = (keyterms: string[]) =>
      fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          audio_url: upload_url,
          speaker_labels: true,
          punctuate: true,
          format_text: true,
          ...(keyterms.length ? { keyterms_prompt: keyterms } : {}),
        }),
      });
    let create = await submit(terms);
    if (!create.ok && create.status === 400 && terms.length) {
      // A rejected term list shouldn't cost the transcript.
      this.log.warn(`AssemblyAI rejected keyterms (${await create.text()}); retrying without them`);
      create = await submit([]);
    }
    if (!create.ok) throw new Error(`AssemblyAI create ${create.status}: ${await create.text()}`);
    const { id } = (await create.json()) as { id: string };
    this.log.log(`AssemblyAI job ${id} started with ${terms.length} name terms`);

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

  /** Official, then staff, spellings plus local place names, so the transcript gets them right in the first place. */
  private async nameTerms(): Promise<string[]> {
    const people = await loadRoster(config.userAgent).catch((err: Error) => {
      this.log.warn(`Roster fetch failed: ${err.message}`);
      return [];
    });
    return [...PLACES, ...transcriptionTerms(people, 150 - PLACES.length)];
  }

  /** OpenAI Whisper: 25 MB upload cap, so audio is sent in 20-minute chunks. No speaker labels. */
  private async openai(audioPath: string): Promise<Segment[]> {
    const chunks = await this.media.splitAudio(audioPath, 20 * 60);
    // Whisper reads only the last ~224 tokens of the prompt, so officials only.
    const names = (await this.nameTerms()).slice(PLACES.length, PLACES.length + 25).join(', ');
    const all: Segment[] = [];
    for (const { file, offsetSec } of chunks) {
      const form = new FormData();
      form.append('file', new Blob([await fs.readFile(file)], { type: 'audio/mpeg' }), path.basename(file));
      form.append('model', 'whisper-1');
      form.append('response_format', 'verbose_json');
      form.append('prompt', `Ketchikan Gateway Borough meeting. Assembly, Planning Commission, Saxman, Gravina, Revilla, Ward Cove, Tongass. ${names}.`);
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
