// A local stand-in for an OpenAI-compatible chat-completions provider.
// It answers like a model would for each prompt type, including the kinds of
// mistakes the server must catch: wrong passage labels, fabricated quotes,
// misread dates, case-law citations and links.
import http from 'http';

function reply(res, obj, usage = { prompt_tokens: 100, completion_tokens: 50 }) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(obj) } }], usage }));
}

export function factResponse() {
  return {
    document_type: 'FIR',
    document_language: 'English',
    facts: [
      {
        statement: 'The complainant Ramesh Kumar reported theft of his motorcycle.',
        fact_type: 'event', date_text: '12/08/2024', date_iso: '2024-12-08',
        parties: [{ name: 'Ramesh Kumar', role: 'complainant' }],
        citations: [{ passage: 'p1.1', quote: 'the complainant Ramesh Kumar reported theft of his motorcycle' }],
      },
      {
        statement: 'Witness Anita Devi saw the accused Suresh Sharma near the parking area.',
        fact_type: 'event',
        // Wrong passage label: the quote is really on page 2.
        citations: [{ passage: 'p1.1', quote: 'seen near the parking area by witness Anita Devi' }],
      },
      {
        statement: 'The accused confessed to stealing the motorcycle.',
        fact_type: 'admission',
        // Fabricated: not in the document.
        citations: [{ passage: 'p2.1', quote: 'the accused confessed to stealing the motorcycle' }],
      },
      {
        statement: 'The case was registered under section 379 IPC.',
        fact_type: 'legal_status',
        citations: [{ passage: 'p1.1', quote: 'Case  registered u/s 379  IPC' }],
      },
      {
        // Duplicate of the first fact.
        statement: 'The complainant Ramesh Kumar reported theft of his motorcycle.',
        fact_type: 'event',
        citations: [{ passage: 'p1.1', quote: 'reported theft of his motorcycle' }],
      },
    ],
  };
}

export function issueResponse() {
  return {
    issues: [
      {
        title: 'Whether the ingredients of theft are made out',
        issue_type: 'substantive',
        analysis: 'Dishonest intention and movement of property must be shown. Compare (2014) 8 SCC 273; see https://example.com/case.',
        fact_refs: ['F1', 'F2', 'F99'],
        provisions: [{ act: 'IPC', section: '379', relevance: 'Theft' }, { act: 'Imaginary Vehicles Act', section: '12', relevance: 'Made up' }],
        evidence_gaps: ['Registration certificate of the motorcycle', 'CCTV footage of the parking area'],
        counter_arguments: ['Identification by a single witness at night'],
      },
      { title: 'Which substantive code applies', issue_type: 'procedural', analysis: 'The incident date is after 1 July 2024.', fact_refs: ['F1'] },
    ],
  };
}

export async function startMockAI({ mode = 'ok' } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      requests.push({ headers: req.headers, body: parsed });
      if (mode === 'error') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"error":"boom"}');
        return;
      }
      const system = parsed.messages?.[0]?.content || '';
      if (system.includes('You extract facts')) return reply(res, factResponse());
      if (system.includes('spotting legal issues')) return reply(res, issueResponse());
      if (system.includes('You transcribe images')) return reply(res, { text: 'NOTICE dated 05/09/2024 u/s 138 of the Negotiable Instruments Act, 1881 demanding payment.' });
      res.writeHead(400);
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
