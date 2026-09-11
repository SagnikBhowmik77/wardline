import type { CorpusStats } from './api';
import { gradeInk, levelInk } from './ui';

const GRADES = ['A', 'B', 'C', 'D', 'F'];

/**
 * A different question from the scan view: not "how is my configuration", but
 * "what does agent configuration in the wild actually look like". Everything
 * here is aggregate - no repository is ever named beside its weaknesses.
 */
export function CorpusView({
  corpus,
  busy,
  onIngest,
}: {
  corpus: CorpusStats | null;
  busy: string | null;
  onIngest: () => void;
}): JSX.Element {
  if (!corpus) {
    return (
      <section className="card">
        <p className="blank">Loading corpus.</p>
      </section>
    );
  }

  const peak = Math.max(1, ...GRADES.map((g) => corpus.grades[g] ?? 0));

  return (
    <div className="bento halves enter">
      <section className="card hover">
        <p className="eyebrow">Real public configurations</p>

        <div className="tally">
          <span className="n">{corpus.size}</span>
          <span className="of">repositories analysed</span>
        </div>

        <div className="spread">
          {GRADES.map((grade) => {
            const n = corpus.grades[grade] ?? 0;
            return (
              <div className="col" key={grade}>
                <span className="cnt">{n}</span>
                <div
                  className="stack"
                  style={{ height: Math.max(3, (n / peak) * 62) + 'px', background: gradeInk(grade) }}
                />
              </div>
            );
          })}
        </div>
        <div className="spread" style={{ height: 'auto', marginBottom: 0 }}>
          {GRADES.map((grade) => (
            <div className="col" key={grade}>
              <div className="foot">{grade}</div>
            </div>
          ))}
        </div>

        <div className="placement">
          <div className="rank">Median {corpus.medians['overall']}</div>
          {corpus.worstCategory && (
            <div className="against">
              Weakest area across the corpus is {corpus.worstCategory}
            </div>
          )}
        </div>

        <div className="entry" style={{ marginTop: 20 }}>
          <button className="btn quiet" disabled={busy !== null} onClick={onIngest}>
            {busy === 'ingest' ? 'Ingesting' : 'Add 20 more repositories'}
          </button>
        </div>
        <p className="note tight">
          Discovery searches GitHub for repositories that ship agent configuration, fetches only
          those files, and stores findings without any credential material.
        </p>
      </section>

      <section className="card hover">
        <p className="eyebrow">What most configurations get wrong</p>

        {corpus.topRules.length === 0 ? (
          <p className="blank">Add repositories to build this list.</p>
        ) : (
          <table className="meters">
            <tbody>
              {corpus.topRules.map((rule) => (
                <tr key={rule.ruleId}>
                  <td>
                    <div className="what" style={{ fontSize: 12.5 }}>
                      {rule.title}
                    </div>
                    <div className="rid">{rule.ruleId}</div>
                  </td>
                  <td className="bar" style={{ width: 96 }}>
                    <div className="rail">
                      <div
                        className="lvl"
                        style={{ width: rule.share + '%', background: levelInk(100 - rule.share) }}
                      />
                    </div>
                  </td>
                  <td className="val">{rule.share}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
