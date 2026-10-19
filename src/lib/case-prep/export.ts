// Brief export: Markdown download and a printable HTML page (browser "Save as
// PDF" handles Hindi and other Indian scripts, which jsPDF's fonts cannot).
// Document-derived text is untrusted, so every value is escaped in HTML.
import { PROVENANCE, factProvenance, formatFactDate, originProvenance } from './provenance';
import type { Brief, BriefBlock, Fact, Issue, Provision, StatuteSummary, Workspace } from './types';

export interface ExportInput {
  workspace: Pick<Workspace, 'title' | 'matter_type' | 'forum' | 'client_side'>;
  brief: Brief;
  facts: Fact[];
  issues: Issue[];
}

const DISCLAIMER = 'Prepared with AI assistance in eNyayaSetu. AI analysis is not legal advice. Facts marked source-verified quote the uploaded documents; verify every statutory provision on India Code before relying on it.';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusLine(brief: Brief): string {
  if (brief.status === 'approved') {
    return `Approved (revision ${brief.revision}${brief.approved_at ? `, ${new Date(brief.approved_at).toLocaleString('en-IN')}` : ''}). ${brief.approval_attestation || ''}`.trim();
  }
  return `DRAFT, NOT APPROVED (revision ${brief.revision}). This brief has not completed human review.`;
}

interface Footnote {
  n: number;
  text: string;
}

function collect(input: ExportInput) {
  const factById = new Map(input.facts.map((f) => [f.id, f]));
  const issueById = new Map(input.issues.map((i) => [i.id, i]));
  const footnotes: Footnote[] = [];
  const cite = (fact: Fact | undefined): number[] => {
    if (!fact) return [];
    return fact.citations.map((c) => {
      const n = footnotes.length + 1;
      footnotes.push({ n, text: `${c.document_name}, page ${c.page_number} (${c.passage_label}): "${c.quote}"` });
      return n;
    });
  };
  return { factById, issueById, footnotes, cite };
}

function blockLabel(block: BriefBlock, fact?: Fact): string {
  if (block.kind === 'context') return 'Matter details entered for this case file';
  const kind = block.kind === 'fact' && fact ? factProvenance(fact) : originProvenance(block.origin);
  return PROVENANCE[kind].label + (block.edited ? ', reworded by reviewer' : '');
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function briefToMarkdown(input: ExportInput): string {
  const { factById, issueById, footnotes, cite } = collect(input);
  const out: string[] = [];
  out.push(`# Case brief: ${input.workspace.title}`, '', `> ${statusLine(input.brief)}`, '');

  for (const section of input.brief.content.sections) {
    if (!section.blocks.length) continue;
    out.push(`## ${section.title}`, '');
    for (const b of section.blocks) {
      switch (b.kind) {
        case 'context':
        case 'note':
          out.push(`${b.text || ''}`, '', `_${blockLabel(b)}_`, '');
          break;
        case 'fact': {
          const fact = factById.get(b.fact_id || '');
          const refs = cite(fact).map((n) => `[^${n}]`).join('');
          out.push(`- ${b.text}${refs} _(${blockLabel(b, fact)})_`);
          break;
        }
        case 'analysis': {
          const issue = issueById.get(b.issue_id || '');
          out.push(`### ${b.title || issue?.title || 'Issue'}`, '', `_${blockLabel(b)}${issue ? `, ${issue.review_status}` : ''}_`, '', b.text || '', '');
          break;
        }
        case 'chronology':
          for (const id of b.fact_ids || []) {
            const f = factById.get(id);
            if (f) out.push(`- **${formatFactDate(f.event_date, f.date_precision)}**: ${f.statement}${cite(f).map((n) => `[^${n}]`).join('')}`);
          }
          out.push('');
          break;
        case 'statutes':
          for (const s of (b.items || []) as StatuteSummary[]) {
            out.push(`- ${s.act_label}: ${s.unit} ${s.sections.join(', ')} (as written in the documents)`);
          }
          out.push('');
          break;
        case 'suggested_provisions':
          for (const p of (b.items || []) as Provision[]) {
            out.push(`- ${p.act}, ${p.section}${p.relevance ? `: ${p.relevance}` : ''} _(AI suggestion, authority not verified${p.act_recognised ? '' : '; act not recognised'})_`);
          }
          out.push('');
          break;
        case 'gaps':
          for (const g of (b.items || []) as string[]) out.push(`- ${g}`);
          out.push('', '_AI analysis_', '');
          break;
        case 'unverified':
          for (const id of b.fact_ids || []) {
            const f = factById.get(id);
            if (f) out.push(`- ${f.statement} _(Unverified: ${f.unverified_reason || 'no matching source'})_`);
          }
          out.push('');
          break;
      }
    }
    out.push('');
  }

  if (footnotes.length) {
    out.push('## Sources', '');
    footnotes.forEach((f) => out.push(`[^${f.n}]: ${f.text}`));
    out.push('');
  }
  out.push('---', '', `_${DISCLAIMER}_`, '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------
// Printable HTML
// ---------------------------------------------------------------------------

export function briefToHtml(input: ExportInput): string {
  const { factById, issueById, footnotes, cite } = collect(input);
  const e = escapeHtml;
  const sup = (ns: number[]) => ns.map((n) => `<sup><a href="#fn${n}">${n}</a></sup>`).join('');
  const parts: string[] = [];

  for (const section of input.brief.content.sections) {
    if (!section.blocks.length) continue;
    parts.push(`<h2>${e(section.title)}</h2>`);
    for (const b of section.blocks) {
      switch (b.kind) {
        case 'context':
        case 'note':
          parts.push(`<div class="block ${b.kind}"><p class="pre">${e(b.text)}</p><p class="label">${e(blockLabel(b))}</p></div>`);
          break;
        case 'fact': {
          const fact = factById.get(b.fact_id || '');
          parts.push(`<div class="block fact ${fact ? factProvenance(fact) : ''}"><p>${e(b.text)}${sup(cite(fact))}</p><p class="label">${e(blockLabel(b, fact))}</p></div>`);
          break;
        }
        case 'analysis': {
          const issue = issueById.get(b.issue_id || '');
          parts.push(`<div class="block ai"><h3>${e(b.title || issue?.title || 'Issue')}</h3><p class="pre">${e(b.text)}</p><p class="label">${e(blockLabel(b))}</p></div>`);
          break;
        }
        case 'chronology':
          parts.push(`<table><tbody>${(b.fact_ids || []).map((id) => {
            const f = factById.get(id);
            return f ? `<tr><th>${e(formatFactDate(f.event_date, f.date_precision))}</th><td>${e(f.statement)}${sup(cite(f))}</td></tr>` : '';
          }).join('')}</tbody></table>`);
          break;
        case 'statutes':
          parts.push(`<ul>${((b.items || []) as StatuteSummary[]).map((s) => `<li>${e(s.act_label)}: ${e(s.unit)} ${e(s.sections.join(', '))}</li>`).join('')}</ul><p class="label">As written in the documents</p>`);
          break;
        case 'suggested_provisions':
          parts.push(`<ul class="ai-list">${((b.items || []) as Provision[]).map((p) => `<li>${e(p.act)}, ${e(p.section)}${p.relevance ? `: ${e(p.relevance)}` : ''} <span class="label">AI suggestion, authority not verified</span></li>`).join('')}</ul>`);
          break;
        case 'gaps':
          parts.push(`<ul class="ai-list">${((b.items || []) as string[]).map((g) => `<li>${e(g)}</li>`).join('')}</ul><p class="label">AI analysis</p>`);
          break;
        case 'unverified':
          parts.push(`<ul class="unverified-list">${(b.fact_ids || []).map((id) => {
            const f = factById.get(id);
            return f ? `<li>${e(f.statement)} <span class="label">Unverified</span></li>` : '';
          }).join('')}</ul>`);
          break;
      }
    }
  }

  const notes = footnotes.map((f) => `<li id="fn${f.n}">${e(f.text)}</li>`).join('');
  const draft = input.brief.status !== 'approved';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400;7..72,600&display=swap">
<title>${e(`Case brief: ${input.workspace.title}`)}</title>
<style>
  body { font-family: Literata, 'Noto Serif Devanagari', Georgia, serif; color: #14213d; max-width: 46rem; margin: 2.5rem auto; padding: 0 1.5rem; line-height: 1.65; font-size: 11.5pt; }
  h1 { font-size: 1.6rem; margin-bottom: .25rem; } h2 { font-size: 1.15rem; margin-top: 2rem; border-bottom: 1px solid #c9cfdb; padding-bottom: .25rem; } h3 { font-size: 1rem; margin: 0 0 .25rem; }
  .status { padding: .6rem .8rem; border: 1px solid ${draft ? '#b45309' : '#15803d'}; color: ${draft ? '#92400e' : '#166534'}; font-family: system-ui, sans-serif; font-size: 10pt; }
  .block { border-left: 3px solid #94a3b8; padding: .1rem 0 .1rem .8rem; margin: .7rem 0; } .block p { margin: 0; }
  .block.verified { border-color: #15803d; } .block.confirmed { border-color: #475569; border-left-style: dashed; } .block.ai { border-color: #6d28d9; } .block.note { border-color: #0f172a; }
  .label { font-family: system-ui, sans-serif; font-size: 8.5pt; color: #64748b; } .pre { white-space: pre-wrap; }
  table { border-collapse: collapse; } th { text-align: left; padding: .2rem 1rem .2rem 0; vertical-align: top; white-space: nowrap; font-weight: 600; } td { padding: .2rem 0; }
  sup a { color: #15803d; text-decoration: none; } ol.sources { font-size: 9.5pt; } footer { margin-top: 2.5rem; font-size: 8.5pt; color: #64748b; font-family: system-ui, sans-serif; }
  ${draft ? `body::before { content: 'DRAFT, NOT APPROVED'; position: fixed; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 4rem; color: rgba(180, 83, 9, .12); font-family: system-ui, sans-serif; font-weight: 700; pointer-events: none; white-space: nowrap; }` : ''}
</style></head><body>
<h1>${e(input.workspace.title)}</h1>
<p class="status">${e(statusLine(input.brief))}</p>
${parts.join('\n')}
${notes ? `<h2>Sources</h2><ol class="sources">${notes}</ol>` : ''}
<footer>${e(DISCLAIMER)}</footer>
</body></html>`;
}

export function downloadText(filename: string, text: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(title: string): string {
  return (title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-') || 'case-brief').slice(0, 80);
}
