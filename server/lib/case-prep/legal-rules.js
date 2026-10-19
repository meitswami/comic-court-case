// Deterministic India-specific rules for the case-preparation workspace.
//
// Nothing here calls a model. These rules:
//  - recognise statute references that appear verbatim in uploaded documents
//    (English and common Hindi forms), so they can be shown as source material;
//  - label AI-suggested provisions honestly (authority never verified here);
//  - flag the 1 July 2024 IPC/CrPC/Evidence Act -> BNS/BNSS/BSA transition;
//  - parse Indian date formats (DD/MM/YYYY convention);
//  - strip case-law citations and URLs from AI text, because no authoritative
//    case-law source is configured and such references cannot be checked.

import { normalizeForMatch } from './text.js';

export const NEW_CRIMINAL_CODES_DATE = '2024-07-01';
export const INDIA_CODE_URL = 'https://www.indiacode.nic.in/';

// key, label, aliases (matched case-insensitively), optional transition data.
export const KNOWN_ACTS = [
  { key: 'IPC', label: 'Indian Penal Code, 1860', aliases: ['Indian Penal Code', 'I.P.C.', 'I.P.C', 'IPC', 'भारतीय दंड संहिता', 'भा.द.वि.', 'भा.द.वि', 'भादवि', 'भादंवि', 'भा.दं.सं.', 'भा.द.सं.'], replacedBy: 'BNS' },
  { key: 'BNS', label: 'Bharatiya Nyaya Sanhita, 2023', aliases: ['Bharatiya Nyaya Sanhita', 'B.N.S.', 'BNS', 'भारतीय न्याय संहिता', 'बीएनएस'], replaces: 'IPC' },
  { key: 'CRPC', label: 'Code of Criminal Procedure, 1973', aliases: ['Code of Criminal Procedure', 'Criminal Procedure Code', 'Cr.P.C.', 'Cr. P.C.', 'Cr.P.C', 'CrPC', 'Cr PC', 'दंड प्रक्रिया संहिता', 'द.प्र.सं.', 'दप्रसं'], replacedBy: 'BNSS' },
  { key: 'BNSS', label: 'Bharatiya Nagarik Suraksha Sanhita, 2023', aliases: ['Bharatiya Nagarik Suraksha Sanhita', 'B.N.S.S.', 'BNSS', 'भारतीय नागरिक सुरक्षा संहिता', 'बीएनएसएस'], replaces: 'CRPC' },
  { key: 'IEA', label: 'Indian Evidence Act, 1872', aliases: ['Indian Evidence Act', 'Evidence Act'], replacedBy: 'BSA' },
  { key: 'BSA', label: 'Bharatiya Sakshya Adhiniyam, 2023', aliases: ['Bharatiya Sakshya Adhiniyam', 'B.S.A.', 'BSA'], replaces: 'IEA' },
  { key: 'CPC', label: 'Code of Civil Procedure, 1908', aliases: ['Code of Civil Procedure', 'Civil Procedure Code', 'C.P.C.', 'CPC'] },
  { key: 'NI', label: 'Negotiable Instruments Act, 1881', aliases: ['Negotiable Instruments Act', 'N.I. Act', 'NI Act', 'N.I.Act'] },
  { key: 'ICA', label: 'Indian Contract Act, 1872', aliases: ['Indian Contract Act', 'Contract Act'] },
  { key: 'SRA', label: 'Specific Relief Act, 1963', aliases: ['Specific Relief Act'] },
  { key: 'TPA', label: 'Transfer of Property Act, 1882', aliases: ['Transfer of Property Act', 'T.P. Act', 'TP Act'] },
  { key: 'LIM', label: 'Limitation Act, 1963', aliases: ['Limitation Act'] },
  { key: 'CPA', label: 'Consumer Protection Act, 2019', aliases: ['Consumer Protection Act'] },
  { key: 'PWDVA', label: 'Protection of Women from Domestic Violence Act, 2005', aliases: ['Protection of Women from Domestic Violence Act', 'Domestic Violence Act', 'PWDV Act', 'D.V. Act', 'DV Act'] },
  { key: 'POCSO', label: 'Protection of Children from Sexual Offences Act, 2012', aliases: ['Protection of Children from Sexual Offences Act', 'POCSO Act', 'POCSO', 'पॉक्सो'] },
  { key: 'ITA', label: 'Information Technology Act, 2000', aliases: ['Information Technology Act', 'I.T. Act', 'IT Act'] },
  { key: 'DPA', label: 'Dowry Prohibition Act, 1961', aliases: ['Dowry Prohibition Act', 'D.P. Act', 'दहेज प्रतिषेध अधिनियम'] },
  { key: 'ARMS', label: 'Arms Act, 1959', aliases: ['Arms Act', 'आयुध अधिनियम', 'आर्म्स एक्ट'] },
  { key: 'NDPS', label: 'Narcotic Drugs and Psychotropic Substances Act, 1985', aliases: ['Narcotic Drugs and Psychotropic Substances Act', 'N.D.P.S. Act', 'NDPS Act', 'NDPS'] },
  { key: 'MVA', label: 'Motor Vehicles Act, 1988', aliases: ['Motor Vehicles Act', 'M.V. Act', 'MV Act'] },
  { key: 'ACA', label: 'Arbitration and Conciliation Act, 1996', aliases: ['Arbitration and Conciliation Act', 'Arbitration Act'] },
  { key: 'HMA', label: 'Hindu Marriage Act, 1955', aliases: ['Hindu Marriage Act', 'H.M. Act', 'HMA'] },
  { key: 'PCA', label: 'Prevention of Corruption Act, 1988', aliases: ['Prevention of Corruption Act', 'P.C. Act', 'PC Act'] },
  { key: 'SCST', label: 'Scheduled Castes and the Scheduled Tribes (Prevention of Atrocities) Act, 1989', aliases: ['Scheduled Castes and the Scheduled Tribes (Prevention of Atrocities) Act', 'Prevention of Atrocities Act', 'SC/ST Act', 'SC & ST Act', 'Atrocities Act'] },
  { key: 'RTI', label: 'Right to Information Act, 2005', aliases: ['Right to Information Act', 'RTI Act'] },
  { key: 'COMP', label: 'Companies Act, 2013', aliases: ['Companies Act'] },
  { key: 'IBC', label: 'Insolvency and Bankruptcy Code, 2016', aliases: ['Insolvency and Bankruptcy Code', 'I.B.C.', 'IBC'] },
  { key: 'IDA', label: 'Industrial Disputes Act, 1947', aliases: ['Industrial Disputes Act', 'I.D. Act', 'ID Act'] },
  { key: 'COI', label: 'Constitution of India', aliases: ['Constitution of India', 'Constitution', 'भारत का संविधान', 'संविधान'], unit: 'Article' },
];

const ACT_BY_KEY = new Map(KNOWN_ACTS.map((a) => [a.key, a]));

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// Longest aliases first so "Cr.P.C." wins over "C.P.C." etc.
const ALIAS_ENTRIES = KNOWN_ACTS.flatMap((act) => act.aliases.map((alias) => ({ alias, act })))
  .sort((a, b) => b.alias.length - a.alias.length);

function aliasPattern(entries) {
  return entries
    .map(({ alias }) => {
      const esc = escapeRegex(alias).replace(/\\\. ?/g, '\\.\\s?').replace(/ /g, '\\s+');
      // Latin aliases need word boundaries; Devanagari aliases do not.
      return /^[A-Za-z]/.test(alias) ? `(?<![A-Za-z])${esc}(?![A-Za-z])` : esc;
    })
    .join('|');
}

const SECTION_ALIASES = ALIAS_ENTRIES.filter((e) => e.act.unit !== 'Article');
const ARTICLE_ALIASES = ALIAS_ENTRIES.filter((e) => e.act.unit === 'Article');

const SECTION_NUM = '\\d{1,4}[A-Z]{0,2}(?:\\s?\\(\\d{1,2}\\))?(?:\\s?\\([a-z]{1,3}\\))?';
// Devanagari separators cannot use \\b (it is ASCII-only in JS regexes).
const SECTION_SEP = '\\s*(?:,|/|&|\\band\\b|\\br/w\\b|\\bread\\s+with\\b|तथा|और|एवं|(?<=\\s)व(?=\\s))\\s*';
const SECTION_LIST = `${SECTION_NUM}(?:${SECTION_SEP}${SECTION_NUM})*`;
const SECTION_WORD = '(?<![A-Za-z])(?:u/s\\.?|u/ss\\.?|under\\s+sections?|sections?|secs?\\.?|ss\\.|s\\.|धारा(?:ओं)?|धाराएं|धाराएँ)';

const SECTION_RE = new RegExp(
  `${SECTION_WORD}\\s*(${SECTION_LIST})\\s*(?:of\\s+(?:the\\s+)?|,\\s*|के\\s+तहत\\s+)?(${aliasPattern(SECTION_ALIASES)})`,
  'giu'
);
const ARTICLE_RE = new RegExp(
  `(?:Art\\.?|Articles?|अनुच्छेद)\\s*(${SECTION_LIST})\\s*(?:of\\s+(?:the\\s+)?)?(${aliasPattern(ARTICLE_ALIASES)})`,
  'giu'
);

function toAsciiDigits(s) {
  return s.replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d)));
}

export function resolveAct(name) {
  if (!name || typeof name !== 'string') return null;
  const target = normalizeForMatch(name).replace(/[.,]/g, '').replace(/\b(18|19|20)\d{2}\b/g, '').trim();
  if (!target) return null;
  for (const { alias, act } of ALIAS_ENTRIES) {
    const a = normalizeForMatch(alias).replace(/[.,]/g, '').trim();
    if (a === target || (a.length > 6 && target.startsWith(a))) return act;
  }
  return null;
}

function splitSections(list) {
  return toAsciiDigits(list)
    .split(new RegExp(SECTION_SEP, 'iu'))
    .map((s) => s.replace(/\s+/g, '').trim())
    .filter(Boolean);
}

/**
 * Scan passages for statute references written in the document itself.
 * Returns [{ act_key, act_label, unit, sections, passage_label, page_number, snippet }].
 */
export function findStatuteMentions(passages) {
  const mentions = [];
  for (const passage of passages) {
    const text = passage.content;
    for (const [re, unit] of [[SECTION_RE, 'Section'], [ARTICLE_RE, 'Article']]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const act = resolveAct(m[2]);
        if (!act) continue;
        const sections = splitSections(m[1]);
        if (!sections.length) continue;
        mentions.push({
          act_key: act.key,
          act_label: act.label,
          unit,
          sections,
          passage_label: passage.label,
          page_number: passage.page_number,
          snippet: text.slice(m.index, m.index + m[0].length),
        });
      }
    }
  }
  return mentions;
}

/** Merge mention lists into one row per act with the union of sections. */
export function summariseMentions(mentions) {
  const byAct = new Map();
  for (const m of mentions) {
    const row = byAct.get(m.act_key) || { act_key: m.act_key, act_label: m.act_label, unit: m.unit, sections: new Set(), occurrences: [] };
    m.sections.forEach((s) => row.sections.add(s));
    row.occurrences.push(m);
    byAct.set(m.act_key, row);
  }
  return [...byAct.values()].map((r) => ({
    ...r,
    sections: [...r.sections].sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b)),
  }));
}

/**
 * Label an AI-suggested provision. Authority is never verified here:
 * there is no authoritative statute retrieval configured.
 */
export function labelProvision(raw) {
  const act = resolveAct(raw?.act);
  const section = typeof raw?.section === 'string' || typeof raw?.section === 'number'
    ? toAsciiDigits(String(raw.section)).replace(/^(section|sec\.?|s\.|article|art\.?)\s*/i, '').trim().slice(0, 40)
    : '';
  return {
    act: act ? act.label : String(raw?.act ?? '').slice(0, 200),
    act_key: act ? act.key : null,
    section,
    relevance: sanitiseAiText(String(raw?.relevance ?? '')).text.slice(0, 600),
    act_recognised: Boolean(act),
    authority_status: 'unverified',
    verify_at: INDIA_CODE_URL,
  };
}

// ---------------------------------------------------------------------------
// Dates (Indian convention: day first)
// ---------------------------------------------------------------------------

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  जनवरी: 1, फरवरी: 2, फ़रवरी: 2, मार्च: 3, अप्रैल: 4, मई: 5, जून: 6, जुलाई: 7, अगस्त: 8, सितंबर: 9, सितम्बर: 9, अक्टूबर: 10, नवंबर: 11, नवम्बर: 11, दिसंबर: 12, दिसम्बर: 12,
};

function pad(n) {
  return String(n).padStart(2, '0');
}

function validDay(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validYear(y) {
  return y >= 1800 && y <= 2100;
}

/**
 * Parse a date as written in an Indian legal document.
 * Returns { iso, precision } where iso is YYYY-MM-DD (month/year precision
 * uses the first day) or null when the text is not a recognisable date.
 */
export function parseIndianDate(text) {
  if (!text || typeof text !== 'string') return null;
  const s = toAsciiDigits(text).trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');

  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return validYear(y) && validDay(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, precision: 'day' } : null;
  }

  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) {
    const [d, mo, y] = [+m[1], +m[2], +m[3]];
    return validYear(y) && validDay(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, precision: 'day' } : null;
  }

  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  m = s.match(new RegExp(`(?:^|\\s)(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*(?:day\\s+of\\s+)?(${monthNames})\\.?[\\s.-]+(\\d{4})`));
  if (m) {
    const [d, mo, y] = [+m[1], MONTHS[m[2]], +m[3]];
    return validYear(y) && validDay(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, precision: 'day' } : null;
  }

  m = s.match(new RegExp(`(?:^|\\s)(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(\\d{4})`));
  if (m) {
    const [mo, d, y] = [MONTHS[m[1]], +m[2], +m[3]];
    return validYear(y) && validDay(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, precision: 'day' } : null;
  }

  m = s.match(new RegExp(`(?:^|\\s)(${monthNames})\\.?\\s+(\\d{4})`));
  if (m) {
    const [mo, y] = [MONTHS[m[1]], +m[2]];
    return validYear(y) ? { iso: `${y}-${pad(mo)}-01`, precision: 'month' } : null;
  }

  m = s.match(/^(?:in\s+|year\s+)?(\d{4})$/);
  if (m && validYear(+m[1])) return { iso: `${m[1]}-01-01`, precision: 'year' };

  return null;
}

/**
 * Reconcile the model's ISO date with a deterministic parse of the source
 * text. The source text wins; disagreements are flagged for a human.
 */
export function resolveFactDate(dateText, modelIso) {
  const parsed = parseIndianDate(dateText);
  const model = typeof modelIso === 'string' ? modelIso.trim() : '';
  const modelDay = /^\d{4}-\d{2}-\d{2}$/.test(model) && validDay(+model.slice(0, 4), +model.slice(5, 7), +model.slice(8, 10)) ? model : null;

  if (parsed) {
    const flag = modelDay && parsed.precision === 'day' && modelDay !== parsed.iso
      ? `AI read this date as ${modelDay}; source text parses as ${parsed.iso} (DD/MM/YYYY). Check the original.`
      : null;
    return { event_date: parsed.iso, date_precision: parsed.precision, date_flag: flag };
  }
  if (modelDay) {
    return {
      event_date: modelDay,
      date_precision: 'day',
      date_flag: dateText ? 'Date taken from AI reading; the source wording could not be parsed automatically.' : 'AI supplied a date without source wording.',
    };
  }
  return { event_date: null, date_precision: 'unknown', date_flag: null };
}

// ---------------------------------------------------------------------------
// Code transition check (1 July 2024)
// ---------------------------------------------------------------------------

/**
 * @param {Array<{act_key, document_id, document_name}>} mentions  statute mentions found in documents
 * @param {Array<{event_date, fact_type, review_status}>} facts
 */
export function codeTransitionAlerts(mentions, facts) {
  const alerts = [];
  const incidentDates = facts
    .filter((f) => f.event_date && f.review_status !== 'rejected' && ['event', 'allegation'].includes(f.fact_type))
    .map((f) => (typeof f.event_date === 'string' ? f.event_date.slice(0, 10) : toIsoDate(f.event_date)))
    .filter(Boolean)
    .sort();
  if (!incidentDates.length) return alerts;

  const earliest = incidentDates[0];
  const latest = incidentDates[incidentDates.length - 1];
  const cited = new Set(mentions.map((m) => m.act_key));

  if (cited.has('IPC') && latest >= NEW_CRIMINAL_CODES_DATE) {
    alerts.push({
      code: 'IPC_AFTER_BNS',
      severity: 'high',
      title: 'IPC cited for events on or after 1 July 2024',
      message: `The documents cite the Indian Penal Code, but the extracted events run up to ${latest}. The Bharatiya Nyaya Sanhita, 2023 replaced the IPC from 1 July 2024. Verify which code governs each alleged offence.`,
    });
  }
  if (cited.has('BNS') && latest < NEW_CRIMINAL_CODES_DATE) {
    alerts.push({
      code: 'BNS_BEFORE_COMMENCEMENT',
      severity: 'high',
      title: 'BNS cited for events before 1 July 2024',
      message: `The documents cite the Bharatiya Nyaya Sanhita, but every extracted event is dated before 1 July 2024 (latest ${latest}). Offences committed before that date are generally governed by the IPC. Verify the charging provisions.`,
    });
  }
  if (cited.has('CRPC') && latest >= NEW_CRIMINAL_CODES_DATE) {
    alerts.push({
      code: 'CRPC_AFTER_BNSS',
      severity: 'medium',
      title: 'CrPC cited alongside post-1 July 2024 events',
      message: 'The BNSS replaced the CrPC from 1 July 2024, subject to its transitional (savings) provisions for matters already pending. Verify which procedural code applies at each stage.',
    });
  }
  if (earliest < NEW_CRIMINAL_CODES_DATE && latest >= NEW_CRIMINAL_CODES_DATE && (cited.has('IPC') || cited.has('BNS'))) {
    alerts.push({
      code: 'EVENTS_SPAN_TRANSITION',
      severity: 'medium',
      title: 'Events span the 1 July 2024 transition',
      message: `Extracted events run from ${earliest} to ${latest}. Different substantive codes may apply to different acts; map each alleged act to the code in force on its date.`,
    });
  }
  return alerts;
}

function toIsoDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

// ---------------------------------------------------------------------------
// Sanitising AI text
// ---------------------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/[^\s)\]]+|\bwww\.[^\s)\]]+/gi;
const REPORTER_RE = new RegExp(
  [
    'AIR\\s+\\d{4}\\s+[A-Z][A-Za-z.]*\\s+\\d+',
    '\\(\\d{4}\\)\\s*\\d+\\s+S\\.?\\s?C\\.?\\s?C\\.?(?:\\s*\\(Cri\\))?\\s+\\d+',
    '\\d{4}\\s+SCC\\s+OnLine\\s+[A-Za-z]+\\s+\\d+',
    '\\[\\d{4}\\]\\s*\\d+\\s+S\\.?C\\.?R\\.?\\s+\\d+',
    '\\d{4}\\s+Cri\\.?\\s?L\\.?\\s?J\\.?\\s+\\d+',
    '\\d{4}\\s+INSC\\s+\\d+',
  ].join('|'),
  'g'
);
const PARTY = "[A-Z][A-Za-z&']*\\.?(?:\\s+(?:of|the|and|&)?\\s*[A-Z][A-Za-z&']*\\.?){0,6}";
const CASE_NAME_RE = new RegExp(`\\b${PARTY}\\s+(?:v\\.|vs\\.?|versus)\\s+(?:the\\s+)?${PARTY}`, 'g');
const LEADING_STOPWORDS = /^(?:See|Also|In|As|The|Per|Cf|Following|Refer|Under|Thus|Hence|Therefore)\s+/;

function captionKey(s) {
  return normalizeForMatch(s).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
}

/**
 * Remove URLs and case-law references from model output. They cannot be
 * verified against an authoritative source in this deployment.
 */
export function sanitiseAiText(input, { allowedCaptions = [] } = {}) {
  let text = String(input ?? '');
  const notes = [];
  if (URL_RE.test(text)) {
    text = text.replace(URL_RE, '[link removed]');
    notes.push('A web link in the AI output was removed; links are never generated as authorities.');
  }
  REPORTER_RE.lastIndex = 0;
  if (REPORTER_RE.test(text)) {
    text = text.replace(REPORTER_RE, '[case citation removed]');
    notes.push('A case-law citation was removed because it could not be verified against an authoritative source.');
  }
  const allowed = allowedCaptions.map(captionKey).filter(Boolean);
  let removedCaseName = false;
  text = text.replace(CASE_NAME_RE, (match) => {
    const lead = match.match(LEADING_STOPWORDS);
    const prefix = lead ? lead[0] : '';
    const body = match.slice(prefix.length);
    const key = captionKey(body);
    if (allowed.some((a) => a.includes(key) || key.includes(a))) return match;
    removedCaseName = true;
    return `${prefix}[case reference removed]`;
  });
  if (removedCaseName) {
    notes.push('A reference to a reported case was removed; verify any precedent independently.');
  }
  URL_RE.lastIndex = 0;
  return { text, notes };
}

export function getAct(key) {
  return ACT_BY_KEY.get(key) || null;
}
