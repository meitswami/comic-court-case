import { describe, expect, it } from 'vitest';
import {
  codeTransitionAlerts,
  findStatuteMentions,
  labelProvision,
  parseIndianDate,
  resolveFactDate,
  sanitiseAiText,
  summariseMentions,
} from '../../server/lib/case-prep/legal-rules.js';

const scan = (content) => findStatuteMentions([{ label: 'p1.1', page_number: 1, content }]).map((m) => [m.act_key, m.sections]);

describe('findStatuteMentions (source-verified statute references)', () => {
  it.each([
    ['FIR registered u/s 379/411 IPC at PS Kotwali.', [['IPC', ['379', '411']]]],
    ['under Sections 420, 467 and 471 of the Indian Penal Code, 1860', [['IPC', ['420', '467', '471']]]],
    ['complaint under Section 138 of the Negotiable Instruments Act, 1881', [['NI', ['138']]]],
    ['मुकदमा धारा 323, 504 व 506 भादवि में दर्ज', [['IPC', ['323', '504', '506']]]],
    ['bail u/s 439 Cr.P.C. was refused', [['CRPC', ['439']]]],
    ['notice under section 35(3) BNSS and u/s 303(2) BNS', [['BNSS', ['35(3)']], ['BNS', ['303(2)']]]],
    ['violates Article 21 of the Constitution of India', [['COI', ['21']]]],
    ['charged u/s 498A, 304B r/w 34 IPC', [['IPC', ['498A', '304B', '34']]]],
  ])('%s', (text, expected) => {
    expect(scan(text)).toEqual(expected);
  });

  it('does not invent references from look-alike text', () => {
    expect(scan('Rs. 500 paid as IPC fee')).toEqual([]);
    expect(scan('The accused was present in court.')).toEqual([]);
  });

  it('keeps CPC and CrPC apart', () => {
    expect(scan('Order 7 Rule 11 read with Section 151 CPC')).toEqual([['CPC', ['151']]]);
  });

  it('summarises mentions per act', () => {
    const mentions = findStatuteMentions([
      { label: 'p1.1', page_number: 1, content: 'u/s 379 IPC' },
      { label: 'p2.1', page_number: 2, content: 'u/s 411, 379 IPC' },
    ]);
    const [row] = summariseMentions(mentions);
    expect(row.sections).toEqual(['379', '411']);
    expect(row.occurrences).toHaveLength(2);
  });
});

describe('parseIndianDate', () => {
  it.each([
    ['12/08/2024', '2024-08-12', 'day'],
    ['12.08.2024', '2024-08-12', 'day'],
    ['12th August, 2024', '2024-08-12', 'day'],
    ['August 12, 2024', '2024-08-12', 'day'],
    ['12-Aug-2024', '2024-08-12', 'day'],
    ['on the 3rd day of January 2021', '2021-01-03', 'day'],
    ['दिनांक 05 अगस्त 2024', '2024-08-05', 'day'],
    ['१२/०८/२०२४', '2024-08-12', 'day'],
    ['March 2023', '2023-03-01', 'month'],
    ['2024', '2024-01-01', 'year'],
  ])('%s -> %s', (text, iso, precision) => {
    expect(parseIndianDate(text)).toEqual({ iso, precision });
  });

  it('rejects impossible dates', () => {
    expect(parseIndianDate('31/02/2024')).toBeNull();
    expect(parseIndianDate('not a date')).toBeNull();
  });
});

describe('resolveFactDate', () => {
  it('trusts the source wording (DD/MM) over the model and flags disagreement', () => {
    const r = resolveFactDate('05/04/2024', '2024-05-04');
    expect(r.event_date).toBe('2024-04-05');
    expect(r.date_flag).toMatch(/Check the original/);
  });

  it('does not let the model invent a day the source does not state', () => {
    const r = resolveFactDate('August 2024', '2024-08-17');
    expect(r).toMatchObject({ event_date: '2024-08-01', date_precision: 'month', date_flag: null });
  });

  it('flags dates that come only from the model', () => {
    expect(resolveFactDate('', '2024-01-02').date_flag).toMatch(/without source wording/);
  });
});

describe('codeTransitionAlerts', () => {
  const fact = (event_date, review_status = 'pending') => ({ event_date, fact_type: 'event', review_status });

  it('flags IPC cited for events on or after 1 July 2024', () => {
    const codes = codeTransitionAlerts([{ act_key: 'IPC' }], [fact('2024-08-12')]).map((a) => a.code);
    expect(codes).toContain('IPC_AFTER_BNS');
  });

  it('flags BNS cited for events before 1 July 2024', () => {
    const codes = codeTransitionAlerts([{ act_key: 'BNS' }], [fact('2023-05-01')]).map((a) => a.code);
    expect(codes).toEqual(['BNS_BEFORE_COMMENCEMENT']);
  });

  it('flags events that straddle the transition', () => {
    const codes = codeTransitionAlerts([{ act_key: 'IPC' }], [fact('2024-06-20'), fact('2024-07-03')]).map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(['IPC_AFTER_BNS', 'EVENTS_SPAN_TRANSITION']));
  });

  it('ignores rejected facts and stays quiet when consistent', () => {
    expect(codeTransitionAlerts([{ act_key: 'IPC' }], [fact('2024-08-12', 'rejected'), fact('2023-01-01')])).toEqual([]);
    expect(codeTransitionAlerts([{ act_key: 'BNS' }], [fact('2024-09-01')])).toEqual([]);
  });
});

describe('sanitiseAiText', () => {
  it('removes URLs and case-law citations the system cannot verify', () => {
    const r = sanitiseAiText('Per Arnesh Kumar v. State of Bihar (2014) 8 SCC 273, see https://example.com/judgment and AIR 1978 SC 597.');
    expect(r.text).not.toMatch(/SCC|AIR 1978|https?:|Arnesh/);
    expect(r.notes.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the matter's own caption and ordinary prose", () => {
    const r = sanitiseAiText('In State of Rajasthan v. Ramesh Kumar, theft under the IPC requires dishonest intention.', {
      allowedCaptions: ['State of Rajasthan v. Ramesh Kumar'],
    });
    expect(r.text).toContain('State of Rajasthan v. Ramesh Kumar');
    expect(r.notes).toEqual([]);
  });
});

describe('labelProvision', () => {
  it('normalises recognised acts but never marks authority as verified', () => {
    expect(labelProvision({ act: 'IPC', section: 'Section 379', relevance: 'theft' })).toMatchObject({
      act: 'Indian Penal Code, 1860', act_key: 'IPC', section: '379', act_recognised: true, authority_status: 'unverified',
    });
  });

  it('flags unrecognised acts', () => {
    expect(labelProvision({ act: 'Imaginary Protection Act', section: '9' })).toMatchObject({ act_recognised: false, authority_status: 'unverified' });
  });
});
