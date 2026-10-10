// Server functions
//
// These replace the Supabase Edge Functions the frontend used to call with
// `supabase.functions.invoke(name, { body })`. Each one is now
// POST /api/functions/<name> on this server.
//
// AI, voice and email keys come from Admin > Settings (or .env) - see
// server/lib/settings.js.

import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne } from '../lib/mysql.js';
import { hasAdminAccess } from '../lib/auth.js';
import { chat, extractJson, AIError } from '../lib/ai.js';
import { getSetting, setSetting, describeSettings, SETTING_KEYS } from '../lib/settings.js';
import { sendEmail, isEmailConfigured, escapeHtml, EmailError } from '../lib/email.js';
import { handleCreatePayment } from './payments.js';
import { getCashfreeConfig, testCredentials } from '../lib/cashfree.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

class FunctionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function fail(res, error, label) {
  if (error instanceof FunctionError || error instanceof AIError || error instanceof EmailError) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  console.error(`[Functions] ${label}:`, error);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

const handle = (label, fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    if (result !== undefined && !res.headersSent) res.json(result);
  } catch (error) {
    fail(res, error, label);
  }
};

async function requireAdmin(req) {
  if (!(await hasAdminAccess(req.userId, req.tfaVerified === true))) {
    throw new FunctionError('Admin access required', 403);
  }
}

// AI and voice calls cost money per request. Cap how fast one account can
// make them (in memory; resets on restart).
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 40;
const rateBuckets = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  let bucket = rateBuckets.get(req.userId);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(req.userId, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }
  return next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.start > RATE_WINDOW_MS) rateBuckets.delete(key);
  }
}, RATE_WINDOW_MS).unref();

const text = (value, max) => String(value === null || value === undefined ? '' : value).slice(0, max);

// ---------------------------------------------------------------------------
// AI judge
// ---------------------------------------------------------------------------

const JUDGE_ACTIONS = [
  'start_session',
  'respond_to_speech',
  'evaluate_hand_raise',
  'evaluate_date_extension',
  'analyze_evidence',
  'make_decision',
  'adjourn_session',
  'evaluate_witness_request',
];

function judgePrompts(body) {
  const { action, caseContext, currentSpeaker, message, handRaise, dateRequest, evidence, witnessRequest } = body;
  const language = ['en', 'hi', 'hinglish'].includes(body.language) ? body.language : 'en';
  const context = typeof caseContext === 'string'
    ? caseContext.slice(0, 5000)
    : JSON.stringify(caseContext || {}).slice(0, 5000);
  const reply = `Respond in ${language === 'hi' ? 'Hindi' : language === 'hinglish' ? 'Hinglish (Hindi and English in Roman script)' : 'English'}.`;

  switch (action) {
    case 'start_session':
      return {
        system: `You are an AI Judge in an Indian court, following the Bharatiya Nyaya Sanhita / Indian Penal Code, the Code of Criminal Procedure and other relevant Indian laws.

Your role:
- Conduct fair hearings efficiently to clear case backlogs
- Maintain court decorum and order
- Analyze evidence objectively
- Make decisions based on law and facts
- Be strict but fair

${reply}

Case Context:
${context}

Generate an opening statement to start the court session. Include:
1. Case number and title announcement
2. Parties present acknowledgment
3. Brief case summary
4. Call for prosecution to present their case

Keep it formal and authoritative.`,
        user: 'Begin the court session.',
      };
    case 'respond_to_speech':
      return {
        system: `You are an AI Judge presiding over an Indian court case.

Case Context:
${context}

A participant just spoke. Analyze their statement and respond appropriately as a judge would.

Guidelines:
- If it's relevant testimony, acknowledge and probe further if needed
- If it's irrelevant, redirect to the matter at hand
- If it contains important claims, ask for evidence
- Maintain authority and order
- Be concise but thorough

${reply}`,
        user: `${text(currentSpeaker || 'Unknown', 100)} said: "${text(message, 2000)}"

Respond as the judge.`,
      };
    case 'evaluate_hand_raise':
      return {
        system: `You are an AI Judge. Someone wants to speak in court.

Case Context:
${context}

Guidelines:
- Allow if the person might have relevant information
- Deny if it seems to delay proceedings unnecessarily
- Ask for brief reason if unclear
- Maintain court order

Respond with a JSON object: { "allowed": boolean, "response": "your response to the person" }`,
        user: `${text((handRaise && handRaise.participantName) || 'Unknown', 100)} (${text((handRaise && handRaise.role) || 'unknown', 50)}) wants to speak.
Reason: ${text((handRaise && handRaise.reason) || 'Not specified', 500)}

Should they be allowed to speak?`,
      };
    case 'evaluate_date_extension':
      return {
        system: `You are an AI Judge evaluating a date extension request.

Case Context:
${context}

CRITICAL MISSION: Your goal is to clear pending case backlogs. Extensions should only be granted for genuine, compelling reasons.

Consider:
1. Validity of the reason
2. Case seriousness (serious cases = stricter)
3. Previous extensions granted
4. Impact on justice delivery
5. Whether the reason is just a delay tactic

Respond with JSON: { "approved": boolean, "decision": "your detailed reasoning", "nextDate": "YYYY-MM-DD if approved" }`,
        user: `${text((dateRequest && dateRequest.requesterName) || 'Unknown', 100)} (${text((dateRequest && dateRequest.role) || 'unknown', 50)}) requests extension.
Reason: ${text((dateRequest && dateRequest.reason) || 'Not specified', 500)}
${dateRequest && dateRequest.requestedDate ? `Requested Date: ${text(dateRequest.requestedDate, 20)}` : ''}

Evaluate this request strictly. Remember: Our mission is to clear backlogs.`,
      };
    case 'analyze_evidence':
      return {
        system: `You are an AI Judge analyzing submitted evidence.

Case Context:
${context}

Analyze the evidence and provide:
1. Relevance to the case
2. Authenticity concerns if any
3. How it affects the case
4. Questions you might ask about it

${reply}`,
        user: `Evidence submitted by ${text((evidence && evidence.submitter) || 'Unknown', 100)}:
File: ${text((evidence && evidence.fileName) || 'Unknown', 200)}
Type: ${text((evidence && evidence.fileType) || 'Unknown', 50)}
OCR Text: ${text((evidence && evidence.ocrText) || 'Not available', 2000)}

Analyze this evidence and respond as the judge would in court.`,
      };
    case 'make_decision':
      return {
        system: `You are an AI Judge ready to deliver a decision/verdict.

Case Context:
${context}

Based on all arguments and evidence presented, deliver a fair judgment following Indian law.

Include:
1. Summary of key points from both sides
2. Evidence evaluation
3. Legal basis for decision
4. Your verdict/order
5. Any directions for parties

Be thorough but clear. This is a formal court judgment.

${reply}`,
        user: 'Based on the proceedings, deliver your judgment on this case.',
      };
    case 'adjourn_session':
      return {
        system: `You are an AI Judge adjourning the court session.

Case Context:
${context}

Provide a formal adjournment statement including:
1. Summary of today's proceedings
2. Pending matters for next hearing
3. Instructions for parties
4. Next hearing date if applicable

Be formal and clear.

${reply}`,
        user: 'Adjourn this court session.',
      };
    default:
      return {
        system: `You are an AI Judge evaluating a witness request.

Case Context:
${context}

Consider:
1. Is the witness relevant to the case?
2. Can this witness provide valuable testimony?
3. Is this a delay tactic?
4. Has similar testimony already been given?

Respond with JSON: { "summoned": boolean, "response": "your detailed reasoning for the decision" }`,
        user: `${text((witnessRequest && witnessRequest.requesterName) || 'Unknown', 100)} (${text((witnessRequest && witnessRequest.role) || 'unknown', 50)}) requests to call witness: ${text((witnessRequest && witnessRequest.witnessName) || 'Unknown', 100)}
Description: ${text((witnessRequest && witnessRequest.description) || 'Not provided', 500)}
Relevance: ${text((witnessRequest && witnessRequest.relevance) || 'Not specified', 500)}

Should this witness be summoned?`,
      };
  }
}

router.post('/ai-judge', authenticate, rateLimit, handle('ai-judge', async (req) => {
  const body = req.body || {};
  if (!JUDGE_ACTIONS.includes(body.action)) throw new FunctionError('Invalid action');
  if (typeof body.message === 'string' && body.message.length > 5000) throw new FunctionError('Message too long');

  const prompts = judgePrompts(body);
  const answer = await chat(
    [
      { role: 'system', content: prompts.system },
      { role: 'user', content: prompts.user },
    ],
    { temperature: 0.7, log: { userId: req.userId, action: `ai_judge_${body.action}` } }
  );

  let response = answer;
  if (['evaluate_hand_raise', 'evaluate_date_extension', 'evaluate_witness_request'].includes(body.action)) {
    response = extractJson(answer) || answer;
  }
  return { response, action: body.action, timestamp: new Date().toISOString() };
}));

// ---------------------------------------------------------------------------
// Case intake chat
// ---------------------------------------------------------------------------

router.post('/case-intake-chat', authenticate, rateLimit, handle('case-intake-chat', async (req) => {
  const { messages, caseContext, step } = req.body || {};
  const history = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  const system = `You are an AI legal assistant for eNyayaSetu, a virtual Indian court system. You help users file and understand their cases.

Your role is to guide users through the case intake process in a conversational, empathetic manner.

Current step: ${text(step, 50)}

Guidelines:
- Be polite, empathetic, and professional
- Use simple language, explain legal terms when used
- Ask one question at a time
- Acknowledge user responses before asking next question
- Reference Indian laws, IPC/BNS sections, CrPC/BNSS procedures when relevant
- If user seems distressed, offer reassurance

Case context so far: ${JSON.stringify(caseContext || {}).slice(0, 6000)}

Based on the step, guide the conversation:
- "initial": Greet and ask to upload FIR/SIR/FR report
- "document_uploaded": Acknowledge the document, summarize what you understood, ask if they are the person involved or someone else
- "relation_check": If other person, ask about relationship and current status of involved person
- "details": Ask for additional details about the case via voice or text
- "status_check": Ask about current case status and last hearing date
- "processing": Estimate processing time (5-30 mins based on complexity), ask for callback number
- "complete": Confirm all details, thank user, explain next steps

Keep responses concise (under 150 words). Use Hindi words with English when appropriate for Indian context.`;

  const reply = await chat([{ role: 'system', content: system }, ...history], {
    log: { userId: req.userId, action: 'case_intake_chat' },
  });
  return { reply: reply || 'I apologize, I could not process that. Please try again.' };
}));

// ---------------------------------------------------------------------------
// Duplicate case check (only within the caller's own cases)
// ---------------------------------------------------------------------------

router.post('/check-duplicate-case', authenticate, handle('check-duplicate-case', async (req) => {
  const { caseNumber, parties } = req.body || {};
  const fields = 'id, case_number, title, category, status, created_at';

  if (typeof caseNumber === 'string' && caseNumber.trim() && caseNumber.length <= 100) {
    const exact = await query(
      `SELECT ${fields} FROM cases WHERE user_id = ? AND case_number LIKE ? LIMIT 5`,
      [req.userId, `%${caseNumber.trim()}%`]
    );
    if (exact.length > 0) {
      return {
        isDuplicate: true,
        matchType: 'exact_case_number',
        matchedCases: exact,
        message: `We found an existing case with number ${exact[0].case_number} in our system.`,
      };
    }
  }

  const names = [parties && parties.complainant, parties && parties.accused]
    .filter((n) => typeof n === 'string' && n.trim() && n.length <= 200)
    .map((n) => n.trim());

  if (names.length > 0) {
    const clauses = [];
    const params = [req.userId];
    for (const name of names) {
      clauses.push('(plaintiff LIKE ? OR defendant LIKE ? OR title LIKE ?)');
      params.push(`%${name}%`, `%${name}%`, `%${name}%`);
    }
    const matches = await query(
      `SELECT ${fields} FROM cases WHERE user_id = ? AND (${clauses.join(' OR ')}) LIMIT 10`,
      params
    );
    if (matches.length > 0) {
      return {
        isDuplicate: true,
        matchType: 'party_names',
        matchedCases: matches,
        message: `We found ${matches.length} existing case(s) involving similar parties.`,
      };
    }
  }

  return { isDuplicate: false, matchType: null, matchedCases: [], message: 'No duplicate cases found.' };
}));

// ---------------------------------------------------------------------------
// OCR (JSON { imageBase64, mimeType, fileName } or a multipart "file")
// ---------------------------------------------------------------------------

router.post('/ocr-document', authenticate, rateLimit, upload.single('file'), handle('ocr-document', async (req) => {
  let base64 = req.body && req.body.imageBase64;
  let mimeType = (req.body && req.body.mimeType) || 'image/jpeg';
  if (req.file) {
    base64 = req.file.buffer.toString('base64');
    mimeType = req.file.mimetype || mimeType;
  }
  if (!base64 || typeof base64 !== 'string') throw new FunctionError('No document provided');
  if (!/^(image\/(png|jpe?g|webp|gif)|application\/pdf)$/i.test(mimeType)) {
    throw new FunctionError('Only images and PDF files can be read.');
  }

  const system = `You are an expert OCR and document analysis system specializing in Indian legal documents.
Your task is to:
1. Extract ALL text from the document image accurately
2. Identify the document type (FIR, SIR, FR, Chargesheet, Court Order, etc.)
3. Extract key details: case number, date, parties involved, allegations, sections invoked
4. Summarize the key facts of the case

Provide output in this JSON format:
{
  "extracted_text": "full OCR text here",
  "document_type": "FIR/SIR/FR/Chargesheet/Other",
  "case_number": "if found",
  "date": "if found",
  "parties": {
    "complainant": "name if found",
    "accused": "name if found"
  },
  "sections_invoked": ["IPC sections if any"],
  "summary": "brief 2-3 sentence summary",
  "key_facts": ["fact 1", "fact 2"]
}`;

  const answer = await chat(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Please perform OCR and analysis on this ${mimeType.includes('pdf') ? 'PDF document' : 'image'}. Extract all text and identify key legal details.`,
          },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      },
    ],
    { log: { userId: req.userId, action: 'ocr_document' } }
  );

  const parsed = extractJson(answer) || {
    extracted_text: answer,
    document_type: 'Unknown',
    summary: answer.substring(0, 200),
  };
  // `text` is what the courtroom evidence upload reads.
  return { ...parsed, text: parsed.extracted_text || '' };
}));

// ---------------------------------------------------------------------------
// Evidence analysis and court chat
// ---------------------------------------------------------------------------

router.post('/analyze-evidence', authenticate, rateLimit, handle('analyze-evidence', async (req) => {
  const { fileName, fileType, description, providedBy } = req.body || {};
  const analysis = await chat(
    [
      {
        role: 'system',
        content: `You are a legal evidence analyst specializing in Indian law. Analyze the provided evidence metadata and provide:
1. Type of evidence classification
2. Potential relevance to court proceedings
3. Admissibility considerations under the Indian Evidence Act / Bharatiya Sakshya Adhiniyam
4. Key points the lawyer should note

Keep response concise (under 200 words).`,
      },
      {
        role: 'user',
        content: `Evidence Details:
- File Name: ${text(fileName, 200)}
- File Type: ${text(fileType, 100)}
- Description: ${text(description || 'No description provided', 1000)}
- Provided By: ${text(providedBy, 50)}

Analyze this evidence for court proceedings.`,
      },
    ],
    { log: { userId: req.userId, action: 'analyze_evidence' } }
  );
  return { analysis: analysis || 'Analysis not available' };
}));

router.post('/court-chat', authenticate, rateLimit, handle('court-chat', async (req) => {
  const { prompt, caseContext } = req.body || {};
  const language = (req.body && req.body.language) || 'en';
  const role = (req.body && req.body.role) || 'judge';
  if (!prompt || typeof prompt !== 'string') throw new FunctionError('Prompt is required');

  const languages = {
    en: 'Respond in English.',
    hi: 'Respond in Hindi (Devanagari script).',
    hinglish: 'Respond in Hinglish (mix of Hindi and English, using Roman script).',
  };
  const roles = {
    judge: 'You are a wise and fair judge in an Indian court. Speak with authority and impartiality.',
    prosecutor: 'You are the Public Prosecutor presenting the case against the defendant. Be formal and assertive.',
    lawyer: 'You are the defense lawyer protecting your client. Be professional and persuasive.',
    accused: 'You are the defendant in this case. Be respectful but maintain your innocence.',
    ai: 'You are a legal AI assistant providing helpful information about the case.',
  };

  const system = `You are part of an E-Courtroom simulation system. ${roles[role] || 'You are a legal expert.'}

${languages[language] || languages.en}

Case Context: ${text(caseContext || 'A legal proceeding is in progress.', 5000)}

Guidelines:
- Keep responses concise and courtroom-appropriate (2-4 sentences)
- Maintain the formality expected in a court of law
- If asked about legal procedures, provide accurate information
- Stay in character as the specified role
- Be respectful and follow courtroom decorum`;

  const response = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: prompt.slice(0, 4000) },
    ],
    { log: { userId: req.userId, action: `court_chat_${text(role, 30)}` } }
  );
  return { response: response || 'No response generated.', role };
}));

// ---------------------------------------------------------------------------
// Voice (ElevenLabs)
// ---------------------------------------------------------------------------

async function elevenLabsKey() {
  const key = await getSetting('ELEVENLABS_API_KEY');
  if (!key) {
    throw new FunctionError(
      'Voice is not configured yet. A Super Admin needs to add an ElevenLabs API key in Admin > Settings.',
      503
    );
  }
  return key;
}

const VOICES = {
  judge: 'onwK4e9ZLuTAKqWW03F9',
  prosecutor: 'cjVigY5qzO86Huf0OWal',
  lawyer: 'TX3LPaxmHKxFdv7VOQHJ',
  accused: 'JBFqnCBsd6RMkjVDRZzb',
  clerk: 'EXAVITQu4vr4xnSDxMaL',
  ai: 'CwhRBWXzGAHq8TQ4Fs17',
};

router.post('/voice-transcribe', authenticate, rateLimit, handle('voice-transcribe', async (req) => {
  const audio = req.body && req.body.audio;
  if (!audio || typeof audio !== 'string') throw new FunctionError('No audio data provided');
  const key = await elevenLabsKey();

  const form = new FormData();
  form.append('file', new Blob([Buffer.from(audio, 'base64')], { type: 'audio/webm' }), 'audio.webm');
  form.append('model_id', 'scribe_v1');

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    console.error('[ElevenLabs STT]', response.status, (await response.text()).slice(0, 300));
    throw new FunctionError('Speech could not be transcribed. Please try again.', 502);
  }
  const result = await response.json();
  return { text: result.text || '' };
}));

router.post('/text-to-speech', authenticate, rateLimit, handle('text-to-speech', async (req) => {
  const body = req.body || {};
  if (!body.text || typeof body.text !== 'string') throw new FunctionError('Text is required');
  const key = await elevenLabsKey();
  const voiceId = VOICES[body.speaker] || VOICES.judge;
  const speed = Math.min(1.2, Math.max(0.7, Number(body.speechRate) || 1.0));

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: body.text.slice(0, 5000),
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
        speed,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    console.error('[ElevenLabs TTS]', response.status, (await response.text()).slice(0, 300));
    throw new FunctionError('Speech could not be generated.', 502);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { audioContent: buffer.toString('base64') };
}));

router.post('/elevenlabs-scribe-token', authenticate, rateLimit, handle('elevenlabs-scribe-token', async () => {
  const key = await elevenLabsKey();
  const response = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    console.error('[ElevenLabs token]', response.status, (await response.text()).slice(0, 300));
    throw new FunctionError('Failed to get a transcription token.', 502);
  }
  const data = await response.json();
  return { token: data.token };
}));

// ---------------------------------------------------------------------------
// Email (admin)
// ---------------------------------------------------------------------------

router.post('/send-verification-email', authenticate, handle('send-verification-email', async (req) => {
  await requireAdmin(req);
  const { action, apiKey, email, recipientName, verificationStatus, caseNumber, adminNotes } = req.body || {};

  if (action === 'check-config') {
    return { configured: await isEmailConfigured() };
  }

  if (action === 'save-config') {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim().startsWith('re_')) {
      throw new FunctionError('Invalid Resend API key format. It should start with "re_"');
    }
    await setSetting('RESEND_API_KEY', apiKey.trim(), req.userId);
    return { success: true, message: 'Resend API key saved.' };
  }

  if (action === 'test') {
    if (!email) throw new FunctionError('Email address required');
    const sent = await sendEmail({
      to: email,
      subject: 'Test Email from eNyayaSetu',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #333;">Email Configuration Successful</h1>
          <p>This is a test email from eNyayaSetu. Your email notifications are now configured correctly.</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">eNyayaSetu - Digital Justice Platform</p>
        </div>`,
    });
    return { success: true, emailId: sent.id };
  }

  if (action === 'send-verification-status') {
    if (!email || !recipientName || !verificationStatus) throw new FunctionError('Missing required fields');
    const approved = verificationStatus === 'approved';
    const color = approved ? '#22c55e' : '#ef4444';
    const label = approved ? 'Approved' : 'Rejected';
    const sent = await sendEmail({
      to: email,
      subject: `Identity Verification ${label} - eNyayaSetu`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 8px;">
          <div style="background: white; padding: 30px; border-radius: 8px;">
            <h1 style="color: #333; margin-bottom: 20px;">Identity Verification Update</h1>
            <p style="font-size: 16px; color: #333;">Dear <strong>${escapeHtml(recipientName)}</strong>,</p>
            <div style="border-left: 4px solid ${color}; padding: 15px; margin: 20px 0; border-radius: 4px; background: #f9fafb;">
              <p style="margin: 0; font-size: 18px;">
                Your identity verification has been <strong style="color: ${color};">${label}</strong>
              </p>
            </div>
            ${caseNumber ? `<p style="color: #666;"><strong>Case Reference:</strong> ${escapeHtml(caseNumber)}</p>` : ''}
            ${adminNotes ? `
              <div style="background: #f3f4f6; padding: 15px; border-radius: 4px; margin: 20px 0;">
                <p style="margin: 0; color: #666;"><strong>Admin Notes:</strong></p>
                <p style="margin: 5px 0 0 0; color: #333;">${escapeHtml(adminNotes)}</p>
              </div>` : ''}
            ${approved
              ? '<p style="color: #333;">You now have access to the case details. Please log in to your eNyayaSetu account to view the information.</p>'
              : '<p style="color: #333;">If you believe this decision was made in error, please submit a new verification request with the correct documents.</p>'}
            <hr style="border: 1px solid #eee; margin: 30px 0 20px;">
            <p style="color: #999; font-size: 12px;">This is an automated message from eNyayaSetu. Please do not reply to this email.</p>
          </div>
        </div>`,
    });
    return { success: true, emailId: sent.id };
  }

  throw new FunctionError('Invalid action');
}));

// ---------------------------------------------------------------------------
// Integration settings (admin): AI, voice and email keys
// ---------------------------------------------------------------------------

router.post('/admin-settings', authenticate, handle('admin-settings', async (req) => {
  await requireAdmin(req);
  const { action, values } = req.body || {};

  if (action === 'save') {
    if (!values || typeof values !== 'object') throw new FunctionError('Nothing to save');
    for (const [key, value] of Object.entries(values)) {
      if (!Object.prototype.hasOwnProperty.call(SETTING_KEYS, key)) continue;
      // An empty secret field means "leave it as it is".
      if (SETTING_KEYS[key].secret && (value === '' || value === null || value === undefined)) continue;
      await setSetting(key, value, req.userId);
    }
  } else if (action === 'clear') {
    const key = req.body && req.body.key;
    if (!Object.prototype.hasOwnProperty.call(SETTING_KEYS, key)) throw new FunctionError('Unknown setting');
    await setSetting(key, '', req.userId);
  } else if (action === 'test-ai') {
    const answer = await chat([{ role: 'user', content: 'Reply with the single word: OK' }], {});
    return { success: true, reply: text(answer, 100) };
  } else if (action === 'test-cashfree') {
    const config = await getCashfreeConfig();
    if (!config) throw new FunctionError('Save the Cashfree App ID and Secret Key first.');
    return testCredentials(config);
  } else if (action && action !== 'get') {
    throw new FunctionError('Invalid action');
  }

  return { success: true, settings: await describeSettings() };
}));

// ---------------------------------------------------------------------------
// Actual-lawyer OTP
// ---------------------------------------------------------------------------

const otpSentAt = new Map();

async function ownedSession(sessionId, userId) {
  if (!sessionId) throw new FunctionError('Session ID required');
  const session = await queryOne(
    `SELECT cs.*, c.user_id AS case_owner, c.title AS case_title
     FROM court_sessions cs JOIN cases c ON c.id = cs.case_id
     WHERE cs.id = ?`,
    [sessionId]
  );
  if (!session) throw new FunctionError('Session not found', 404);
  if (session.case_owner !== userId) throw new FunctionError('Only the case owner can do this.', 403);
  if (session.lawyer_type !== 'actual_lawyer') throw new FunctionError('This hearing does not use an Actual Lawyer.');
  return session;
}

router.post('/send-lawyer-otp', authenticate, handle('send-lawyer-otp', async (req) => {
  const { session_id: sessionId, lawyer_id: lawyerId, lawyer_email: lawyerEmail } = req.body || {};
  const session = await ownedSession(sessionId, req.userId);

  const emailTo = String(lawyerEmail || session.actual_lawyer_email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
    throw new FunctionError("Please enter the lawyer's email address.");
  }
  if (!(await isEmailConfigured())) {
    throw new FunctionError(
      'The OTP cannot be emailed yet: a Super Admin needs to add a Resend API key in Admin > Settings.',
      503
    );
  }

  // One email per minute per session.
  const lastSent = otpSentAt.get(sessionId) || 0;
  if (Date.now() - lastSent < 60 * 1000) {
    throw new FunctionError('An OTP was just sent. Please wait a minute before requesting another.', 429);
  }
  otpSentAt.set(sessionId, Date.now());

  const otp = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await query(
    `UPDATE court_sessions
     SET actual_lawyer_otp = ?, actual_lawyer_otp_expires_at = ?,
         actual_lawyer_id = COALESCE(?, actual_lawyer_id), actual_lawyer_email = ?
     WHERE id = ?`,
    [otp, expiresAt, lawyerId ? text(lawyerId, 255) : null, emailTo, sessionId]
  );

  await sendEmail({
    to: emailTo,
    subject: 'Your eNyayaSetu hearing verification code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">Hearing verification code</h2>
        <p>You have been named as the lawyer for the hearing of <strong>${escapeHtml(session.case_title || 'a case')}</strong> on eNyayaSetu.</p>
        <p style="font-size: 32px; letter-spacing: 6px; font-weight: bold; margin: 24px 0;">${otp}</p>
        <p>Share this code with your client to start the hearing. It is valid for 15 minutes.</p>
        <p style="color: #666; font-size: 12px;">If you were not expecting this, you can ignore this email.</p>
      </div>`,
  });

  return { success: true, message: 'OTP sent to the lawyer email', otp_expires_at: expiresAt.toISOString() };
}));

// Wrong guesses per session; after 5 the code is thrown away.
const otpFailures = new Map();

router.post('/verify-lawyer-otp', authenticate, handle('verify-lawyer-otp', async (req) => {
  const { session_id: sessionId, otp } = req.body || {};
  const session = await ownedSession(sessionId, req.userId);

  if (!session.actual_lawyer_otp || !session.actual_lawyer_otp_expires_at) {
    throw new FunctionError('Please request an OTP first.');
  }
  if (new Date(session.actual_lawyer_otp_expires_at) < new Date()) {
    throw new FunctionError('OTP has expired. Please request a new one.');
  }
  const given = Buffer.from(String(otp || '').trim());
  const expected = Buffer.from(String(session.actual_lawyer_otp));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    const failures = (otpFailures.get(sessionId) || 0) + 1;
    if (failures >= 5) {
      otpFailures.delete(sessionId);
      await query(
        'UPDATE court_sessions SET actual_lawyer_otp = NULL, actual_lawyer_otp_expires_at = NULL WHERE id = ?',
        [sessionId]
      );
      throw new FunctionError('Too many wrong attempts. Please request a new OTP.', 429);
    }
    otpFailures.set(sessionId, failures);
    throw new FunctionError('Invalid OTP');
  }
  otpFailures.delete(sessionId);

  await query(
    `UPDATE court_sessions
     SET hearing_started = 1, status = 'in_progress', started_at = NOW(),
         actual_lawyer_otp = NULL, actual_lawyer_otp_expires_at = NULL
     WHERE id = ?`,
    [sessionId]
  );
  return { success: true };
}));

// ---------------------------------------------------------------------------
// Payments (used by the hearing checkout)
// ---------------------------------------------------------------------------

router.post('/create-payment', authenticate, handleCreatePayment);

router.use((req, res) => {
  res.status(404).json({ error: 'Unknown function' });
});

export default router;
