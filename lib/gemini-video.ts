// Gemini 2.5 video analysis helper.
// Uses the Files API to upload the video, then analyzes it with a structured
// prompt that returns JSON matching VideoAnalysis. The uploaded file auto-
// expires after 24h on Google's side — we don't keep it ourselves.

import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GOOGLE_AI_API_KEY;

// Lazily build clients so the module can be imported even when the key is
// missing at build time (the route checks before using).
function clients() {
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set');
  return {
    files: new GoogleAIFileManager(apiKey),
    genai: new GoogleGenerativeAI(apiKey),
  };
}

// Structured output we ask Gemini to return. Mirrored on the client side.
export interface VideoAnalysis {
  duration: number;                    // seconds, integer
  format: string;                      // e.g. "UGC 9:16 selfie"
  hook: {
    timing: string;                    // e.g. "0-2.5s"
    visual: string;
    audio: string;
    onScreen: string;
    stopScrollMechanism: string;
  };
  shots: Array<{
    t: string;                         // e.g. "0-2.5s"
    type: string;                      // close-up, POV, talking head…
    camera: string;                    // handheld, static, drone…
    subject: string;
    vo: string;                        // voice-over verbatim for this shot
    onScreen: string;                  // text on screen during this shot
  }>;
  voiceOverFull: string;               // full transcript verbatim
  onScreenTextTimeline: Array<{ t: string; text: string }>;
  pacing: string;                      // human description
  music: string;                       // mood description
  psychologicalAngle: string;          // one-liner
  cta: {
    timing: string;
    type: string;
    text: string;
  };
  narrativeStructure: string;          // hook → ... → cta description

  // 10-axis catalog tagging — so downstream SOPs can reuse the same vocabulary
  // for both Iterate Video (sibling generation) and Clone & Adapt (script
  // generation). All values must be ONE short phrase.
  axes: {
    Format: string;
    Concept: string;
    Angle: string;
    Message: string;
    Hook: string;
    Body: string;
    'Montage vidéo': string;
    Awareness: string;
    Acteur: string;
    Lieu: string;
  };
}

// Prompt sent to Gemini. We force JSON output via responseMimeType + an
// explicit schema description in the prompt itself (more reliable than
// responseSchema for nested unions).
const ANALYSIS_PROMPT = `You are an ad-analysis engine. Analyze the attached video ad and return a single valid JSON object — nothing else, no preamble, no markdown fences.

The JSON must match this exact shape (all fields required, no extras):

{
  "duration": <integer seconds>,
  "format": "<short description, e.g. 'UGC 9:16 selfie'>",
  "hook": {
    "timing": "<e.g. '0-2.5s'>",
    "visual": "<describe what's on screen>",
    "audio": "<describe voice-over / sounds>",
    "onScreen": "<verbatim on-screen text or '—'>",
    "stopScrollMechanism": "<one short phrase, e.g. 'curiosity gap + tactile visual'>"
  },
  "shots": [
    {
      "t": "<timestamp range>",
      "type": "<close-up | POV | talking head | b-roll | split-screen | …>",
      "camera": "<handheld | static | tracking | …>",
      "subject": "<what's in frame>",
      "vo": "<voice-over verbatim during this shot, '' if silent>",
      "onScreen": "<verbatim on-screen text during this shot, '' if none>"
    }
  ],
  "voiceOverFull": "<entire voice-over transcript, verbatim, with natural punctuation>",
  "onScreenTextTimeline": [
    { "t": "<timestamp range>", "text": "<verbatim text>" }
  ],
  "pacing": "<one sentence: e.g. 'Fast — cuts every 1.2-1.8s, accelerates on the proof beat'>",
  "music": "<one sentence: mood, tempo, presence>",
  "psychologicalAngle": "<one short phrase: dominant persuasion mechanism>",
  "cta": {
    "timing": "<timestamp range>",
    "type": "<discount | scarcity | guarantee | soft | …>",
    "text": "<verbatim CTA text or voice line>"
  },
  "narrativeStructure": "<one sentence: e.g. 'Hook curiosity → emotional reaction → before/after proof → discount CTA'>",
  "axes": {
    "Format": "<one short phrase from: UGC selfie | talking-head expert | demo | voice-over with b-roll | podcast clip | stranger interview | mockumentary | listicle | day-in-the-life | before/after reveal | founder direct-to-camera | screen recording | split-screen reaction>",
    "Concept": "<one short phrase, e.g. 'I tried it for 30 days', 'stranger asks 5 questions', 'founder explains why we made this'>",
    "Angle": "<one phrase from: scarcity | social proof | transformation | problem-solution | identity | ingredient/mechanism story | founder/origin story | ROI/value | contrarian myth-bust | status | peer comparison | fear-of-loss | aspirational future-state>",
    "Message": "<one-line core promise the viewer leaves with>",
    "Hook": "<one phrase from: curiosity gap | contrarian statement | stat shock | stranger-stop | problem amplification | declarative claim | reaction shot opener | before-state shock | qualifier callout | question-bait | visual-first cold open>",
    "Body": "<one phrase from: testimonial quote | demo loop | before/after walkthrough | problem→solution unfold | story arc | listicle | comparison side-by-side | ingredient/mechanism explanation | expert breakdown | social proof stack>",
    "Montage vidéo": "<one phrase: cut speed + dominant treatment, e.g. 'fast cuts (sub-1s), b-roll heavy, warm grade'>",
    "Awareness": "<one of: Unaware | Problem Aware | Solution Aware | Product Aware | Most Aware>",
    "Acteur": "<one phrase from: peer user | aspirational user | expert/professional | founder/CEO | employee insider | unexpected persona | micro-influencer | faceless POV | AI/animated avatar | multiple actors>",
    "Lieu": "<one phrase: physical setting, e.g. 'bathroom', 'kitchen', 'outdoor street', 'salon/clinic', 'studio neutral'>"
  }
}

Be concise inside each field. The voiceOverFull and verbatim fields must be word-for-word from the audio/screen — do not paraphrase those. For axes, pick the closest match from the catalog options listed; never invent new axis names or values outside the listed options (except Concept/Message/Lieu which are open-text).`;

const MODEL_ID = 'gemini-2.5-flash';

/**
 * Upload a video buffer to Gemini Files API and run structured analysis.
 * Throws on any failure — the route handler is responsible for catching.
 */
export async function analyzeVideo(
  buffer: Buffer,
  mimeType: string,
): Promise<VideoAnalysis> {
  const { files, genai } = clients();

  // 1) Upload to Files API. The SDK wants a path, not a buffer, so we write
  // a temp file. Easier than streaming on Vercel/Railway serverless.
  const tmpPath = `/tmp/upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fs = await import('node:fs/promises');
  await fs.writeFile(tmpPath, buffer);

  let uploaded;
  try {
    uploaded = await files.uploadFile(tmpPath, {
      mimeType,
      displayName: 'creative-suite-video',
    });
  } finally {
    // Always clean up the temp file regardless of upload outcome.
    fs.unlink(tmpPath).catch(() => {});
  }

  // 2) Wait until the file finishes processing on Google's side (videos go
  // through a transcoding step before they're queryable). Capped at 4 min
  // to avoid hanging the whole request indefinitely if Google stalls.
  let file = uploaded.file;
  console.log(`[analyze-video] uploaded "${file.name}" (${file.sizeBytes ?? '?'} bytes), waiting for processing…`);
  const POLL_DEADLINE = Date.now() + 4 * 60 * 1000;
  let pollCount = 0;
  while (file.state === FileState.PROCESSING) {
    if (Date.now() > POLL_DEADLINE) {
      throw new Error(`Gemini took longer than 4 minutes to transcode the video (still PROCESSING after ${pollCount} polls).`);
    }
    await new Promise((r) => setTimeout(r, 2500));
    file = await files.getFile(file.name);
    pollCount++;
    if (pollCount % 4 === 0) {
      console.log(`[analyze-video] still processing after ${pollCount * 2.5}s…`);
    }
  }
  if (file.state === FileState.FAILED) {
    throw new Error('Gemini failed to process the uploaded video');
  }
  console.log(`[analyze-video] file ready after ${pollCount} polls. Running analysis…`);

  // 3) Run analysis with JSON-mode output.
  const model = genai.getGenerativeModel({
    model: MODEL_ID,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });

  const result = await model.generateContent([
    { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
    { text: ANALYSIS_PROMPT },
  ]);

  const text = result.response.text();
  let analysis: VideoAnalysis;
  try {
    analysis = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON output: ${text.slice(0, 200)}…`);
  }

  // 4) Best-effort cleanup of the uploaded file (Files API auto-deletes after
  // 24h anyway, but we don't need it once analysis is done).
  files.deleteFile(file.name).catch(() => {});

  return analysis;
}
