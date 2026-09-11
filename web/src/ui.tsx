/**
 * Presentational pieces.
 *
 * Colour is reserved for meaning: severity, and whether a number is good. Every
 * other distinction is carried by type, weight and the single hairline rule.
 */

import { isUnrated } from './api';
import type { CategoryBenchmark, FindingRow, RuleGap, ScanRow } from './api';

const WIN_SEP = String.fromCharCode(92);

export function gradeInk(grade: string): string {
  if (grade === 'A' || grade === 'B') return 'var(--good-fg)';
  if (grade === 'C') return 'var(--med-fg)';
  if (grade === 'D') return 'var(--high-fg)';
  return 'var(--crit-fg)';
}

export function levelInk(score: number): string {
  if (score >= 80) return 'var(--good-fg)';
  if (score >= 60) return 'var(--med-fg)';
  return 'var(--crit-fg)';
}

/** Last two path segments, so a long Windows path still reads at a glance. */
export function shortSlug(slug: string): string {
  const parts = slug
    .split('/')
    .flatMap((part) => part.split(WIN_SEP))
    .filter(Boolean);

  if (parts.length <= 2) return slug;
  return parts.slice(-2).join('/');
}

/** A score, with a tick where the corpus sits, so the number carries context. */
export function Rail({ score, median }: { score: number; median?: number }): JSX.Element {
  return (
    <div className="rail">
      <div className="lvl" style={{ width: score + '%', background: levelInk(score) }} />
      {median !== undefined && (
        <div
          className="mid"
          style={{ left: 'calc(' + median + '% - 0.5px)' }}
          title={'corpus median ' + median}
        />
      )}
    </div>
  );
}

export function Meters({ rows }: { rows: CategoryBenchmark[] }): JSX.Element {
  return (
    <table className="meters">
      <tbody>
        {rows.map((row) => (
          <tr key={row.category}>
            <td className="name">{row.category}</td>
            <td className="bar">
              <Rail score={row.score} median={row.corpusMedian} />
            </td>
            <td className="val">{row.score}</td>
            <td className="say">{row.verdict}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Ledger({ gaps, mode }: { gaps: RuleGap[]; mode: 'yours' | 'avoided' }): JSX.Element {
  if (gaps.length === 0) {
    return <p className="blank">Nothing yet. Add repositories to the corpus.</p>;
  }

  return (
    <ul className="ledger">
      {gaps.map((gap) => (
        <li key={gap.ruleId}>
          <div className="body">
            <div className="what">{gap.title}</div>
            <div className="rid">{gap.ruleId}</div>
          </div>
          <div className="pct">
            {gap.corpusShare}%
            <em>{mode === 'yours' ? 'of repos' : 'have it'}</em>
          </div>
        </li>
      ))}
    </ul>
  );
}

const LEVELS = ['critical', 'high', 'medium', 'low', 'info'] as const;

export function Findings({
  findings,
  filter,
  onFilter,
}: {
  findings: FindingRow[];
  filter: string;
  onFilter: (next: string) => void;
}): JSX.Element {
  const shown = filter === 'all' ? findings : findings.filter((f) => f.severity === filter);

  return (
    <>
      <div className="chips">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => onFilter('all')}>
          all {findings.length}
        </button>
        {LEVELS.map((level) => {
          const n = findings.filter((f) => f.severity === level).length;
          if (n === 0) return null;
          return (
            <button
              key={level}
              className={filter === level ? 'on' : ''}
              onClick={() => onFilter(level)}
            >
              {level} {n}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="blank">Nothing at this level.</p>
      ) : (
        <table className="findings">
          <thead>
            <tr>
              <th className="c-sev">Severity</th>
              <th>Issue</th>
              <th className="c-rule">Rule</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 300).map((f) => (
              <tr key={f.id}>
                <td className="c-sev">
                  <span className={'pill ' + f.severity}>{f.severity}</span>
                </td>
                <td>
                  <div className="title">{f.title}</div>
                  <div className="where">
                    {f.rel_path}
                    {f.line ? ':' + f.line : ''}
                    {f.trust !== 'runtime' ? '  ' + f.trust : ''}
                  </div>
                  {f.evidence && <div className="proof">{f.evidence}</div>}
                </td>
                <td className="c-rule">{f.rule_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function Index({
  scans,
  selected,
  onSelect,
}: {
  scans: ScanRow[];
  selected: number | null;
  onSelect: (id: number) => void;
}): JSX.Element {
  if (scans.length === 0) return <p className="blank">No scans yet.</p>;

  return (
    <ul className="index">
      {scans.map((scan) => (
        <li key={scan.id}>
          <button className={selected === scan.id ? 'on' : ''} onClick={() => onSelect(scan.id)}>
            <span
              className="mark"
              style={{ color: isUnrated(scan) ? 'var(--ink-faint)' : gradeInk(scan.grade) }}
              title={isUnrated(scan) ? 'not enough configuration to rate' : undefined}
            >
              {isUnrated(scan) ? '–' : scan.grade}
            </span>
            <span className="who" title={scan.slug}>
              {shortSlug(scan.slug)}
            </span>
            <span className="kind">{scan.source}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
